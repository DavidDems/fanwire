"""Tests for GET /events/games/{game_id}'s GameDetailOut (EVENTS-005).

The detail embeds both teams (id, name, abbreviation), each side's line score
as stored, and a box score per team built from PlayerGameStats: the players
who played (starters first, then by seconds played, most first, then by
player id), each with every counting stat and computed shooting percentages;
the players who did not play with their reason; and totals summed from the
played rows, never adjusted to the final score. A fraction from 0 to 1,
three places, null when nothing was attempted. Built in a fixed number of
queries, never one per player. Spec: .ai/tasks/EVENTS-005/.
"""

from __future__ import annotations

from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_session
from app.events.models import Game, Player, PlayerGameStats, Team
from app.events.routes import router

COUNTING_STATS = (
    "field_goals_made",
    "field_goals_attempted",
    "three_pointers_made",
    "three_pointers_attempted",
    "free_throws_made",
    "free_throws_attempted",
    "offensive_rebounds",
    "defensive_rebounds",
    "rebounds",
    "assists",
    "steals",
    "blocks",
    "turnovers",
    "personal_fouls",
    "points",
)
PERCENTAGES = ("field_goal_pct", "three_point_pct", "free_throw_pct")


@pytest.fixture()
def engine(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def session_factory(engine):
    return make_session_factory(engine)


@pytest.fixture()
def client(session_factory):
    app = FastAPI()
    app.include_router(router)

    def _get_session_override():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = _get_session_override
    return TestClient(app)


@pytest.fixture()
def matchup(session_factory):
    """Boston at home to the Lakers, 2024 Finals Game 5 style. Returns
    (game_id, home_team_id, away_team_id)."""
    with session_factory() as session:
        home = Team(
            nba_team_id=1610612738,
            name="Boston Celtics",
            abbreviation="BOS",
            conference="East",
            division="Atlantic",
        )
        away = Team(
            nba_team_id=1610612747,
            name="Los Angeles Lakers",
            abbreviation="LAL",
            conference="West",
            division="Pacific",
        )
        session.add_all([home, away])
        session.flush()
        game = Game(
            nba_game_id=42300405,
            home_team_id=home.id,
            away_team_id=away.id,
            date=datetime(2024, 6, 17, 20, 30),
            season="2023-24",
            home_score=106,
            away_score=88,
            venue="TD Garden",
            game_type="playoffs",
            label="NBA Finals",
            sub_label="Game 5",
            series_game_number=5,
            home_line_score=[28, 39, 26, 13],
            away_line_score=[18, 28, 28, 14],
        )
        session.add(game)
        session.commit()
        return game.id, home.id, away.id


_next_person_id = iter(range(1, 10_000))


def _add_player(session, first: str | None, last: str | None) -> Player:
    player = Player(nba_person_id=next(_next_person_id), first_name=first, last_name=last)
    session.add(player)
    session.flush()
    return player


def _add_line(session, *, game_id, team_id, player, **overrides) -> PlayerGameStats:
    values = {stat: 0 for stat in COUNTING_STATS}
    values.update(
        {
            "game_id": game_id,
            "team_id": team_id,
            "player_id": player.id,
            "starter": False,
            "starting_position": None,
            "seconds_played": 600,
            "plus_minus": 0,
            "dnp_reason": None,
        }
    )
    values.update(overrides)
    line = PlayerGameStats(**values)
    session.add(line)
    session.flush()
    return line


def _detail(client, game_id) -> dict:
    response = client.get(f"/events/games/{game_id}")
    assert response.status_code == 200, response.text
    return response.json()


# ----------------------------------------------------------------- game header


def test_detail_carries_the_game_and_both_teams(client, matchup):
    game_id, home_id, away_id = matchup

    body = _detail(client, game_id)

    assert body["id"] == game_id
    assert body["nba_game_id"] == 42300405
    assert body["date"].startswith("2024-06-17T20:30")
    assert body["season"] == "2023-24"
    assert body["game_type"] == "playoffs"
    assert body["label"] == "NBA Finals"
    assert body["sub_label"] == "Game 5"
    assert body["series_game_number"] == 5
    assert body["venue"] == "TD Garden"
    assert body["home_score"] == 106
    assert body["away_score"] == 88
    assert body["home_team"] == {"id": home_id, "name": "Boston Celtics", "abbreviation": "BOS"}
    assert body["away_team"] == {
        "id": away_id,
        "name": "Los Angeles Lakers",
        "abbreviation": "LAL",
    }


def test_detail_carries_each_sides_line_score_as_stored(client, session_factory, matchup):
    game_id, _, _ = matchup
    with session_factory() as session:
        game = session.get(Game, game_id)
        # Triple overtime: the third figure is "third overtime and later",
        # returned as stored, not split or padded.
        game.home_line_score = [25, 25, 25, 25, 10, 8, 12]
        game.away_line_score = [30, 20, 25, 25, 10, 8, 5]
        session.commit()

    body = _detail(client, game_id)

    assert body["home_line_score"] == [25, 25, 25, 25, 10, 8, 12]
    assert body["away_line_score"] == [30, 20, 25, 25, 10, 8, 5]


def test_line_score_is_null_when_not_stored(client, session_factory, matchup):
    game_id, _, _ = matchup
    with session_factory() as session:
        game = session.get(Game, game_id)
        game.home_line_score = None
        game.away_line_score = None
        session.commit()

    body = _detail(client, game_id)

    assert body["home_line_score"] is None
    assert body["away_line_score"] is None


def test_unknown_game_is_404(client, matchup):
    response = client.get("/events/games/987654321")

    assert response.status_code == 404


# ------------------------------------------------------------------- box score


def test_player_row_carries_every_stat_and_computed_percentages(client, session_factory, matchup):
    game_id, home_id, _ = matchup
    with session_factory() as session:
        tatum = _add_player(session, "Jayson", "Tatum")
        line = _add_line(
            session,
            game_id=game_id,
            team_id=home_id,
            player=tatum,
            starter=True,
            starting_position="F",
            seconds_played=2718,
            field_goals_made=11,
            field_goals_attempted=23,
            three_pointers_made=2,
            three_pointers_attempted=7,
            free_throws_made=7,
            free_throws_attempted=9,
            offensive_rebounds=1,
            defensive_rebounds=7,
            rebounds=8,
            assists=11,
            steals=1,
            blocks=0,
            turnovers=4,
            personal_fouls=2,
            points=31,
            plus_minus=19,
        )
        session.commit()
        tatum_id = tatum.id
        line_id = line.id

    rows = _detail(client, game_id)["home_box_score"]["players"]

    assert rows == [
        {
            "line_id": line_id,
            "player_id": tatum_id,
            "first_name": "Jayson",
            "last_name": "Tatum",
            "starter": True,
            "starting_position": "F",
            "seconds_played": 2718,
            "field_goals_made": 11,
            "field_goals_attempted": 23,
            "field_goal_pct": 0.478,
            "three_pointers_made": 2,
            "three_pointers_attempted": 7,
            "three_point_pct": 0.286,
            "free_throws_made": 7,
            "free_throws_attempted": 9,
            "free_throw_pct": 0.778,
            "offensive_rebounds": 1,
            "defensive_rebounds": 7,
            "rebounds": 8,
            "assists": 11,
            "steals": 1,
            "blocks": 0,
            "turnovers": 4,
            "personal_fouls": 2,
            "points": 31,
            "plus_minus": 19,
        }
    ]


def test_percentage_is_null_when_nothing_was_attempted(client, session_factory, matchup):
    game_id, home_id, _ = matchup
    with session_factory() as session:
        player = _add_player(session, "Luke", "Kornet")
        _add_line(
            session,
            game_id=game_id,
            team_id=home_id,
            player=player,
            field_goals_made=2,
            field_goals_attempted=2,
            points=4,
        )
        session.commit()

    (row,) = _detail(client, game_id)["home_box_score"]["players"]

    assert row["field_goal_pct"] == 1.0
    assert row["three_point_pct"] is None
    assert row["free_throw_pct"] is None


def test_rows_go_to_their_own_teams_side(client, session_factory, matchup):
    game_id, home_id, away_id = matchup
    with session_factory() as session:
        home_player = _add_player(session, "Jrue", "Holiday")
        away_player = _add_player(session, "LeBron", "James")
        _add_line(session, game_id=game_id, team_id=home_id, player=home_player)
        _add_line(session, game_id=game_id, team_id=away_id, player=away_player)
        session.commit()
        home_player_id, away_player_id = home_player.id, away_player.id

    body = _detail(client, game_id)

    assert [r["player_id"] for r in body["home_box_score"]["players"]] == [home_player_id]
    assert [r["player_id"] for r in body["away_box_score"]["players"]] == [away_player_id]


def test_played_rows_are_starters_first_then_by_seconds_then_player_id(
    client, session_factory, matchup
):
    game_id, home_id, _ = matchup
    with session_factory() as session:
        players = {name: _add_player(session, name, "X") for name in "ABCDEFG"}
        lines = {
            # A bench player with more minutes than any starter still follows them.
            "A": {"starter": False, "seconds_played": 2900},
            "B": {"starter": True, "starting_position": "G", "seconds_played": 1800},
            "C": {"starter": True, "starting_position": "C", "seconds_played": 2400},
            "D": {"starter": False, "seconds_played": 300},
            # E and F tie on seconds: the lower player id comes first.
            "E": {"starter": False, "seconds_played": 900},
            "F": {"starter": False, "seconds_played": 900},
            # Played zero seconds is still "played" (minutes are not null).
            "G": {"starter": False, "seconds_played": 0},
        }
        for name in "GFEDCBA":
            _add_line(
                session,
                game_id=game_id,
                team_id=home_id,
                player=players[name],
                **lines[name],
            )
        session.commit()
        ids = {name: player.id for name, player in players.items()}

    rows = _detail(client, game_id)["home_box_score"]["players"]

    tie = sorted([ids["E"], ids["F"]])
    assert [r["player_id"] for r in rows] == [
        ids["C"],
        ids["B"],
        ids["A"],
        *tie,
        ids["D"],
        ids["G"],
    ]


def test_players_who_did_not_play_are_listed_apart_with_their_reason(
    client, session_factory, matchup
):
    game_id, home_id, _ = matchup
    with session_factory() as session:
        played = _add_player(session, "Derrick", "White")
        injured = _add_player(session, "Kristaps", "Porzingis")
        coach = _add_player(session, "Neemias", "Queta")
        _add_line(session, game_id=game_id, team_id=home_id, player=played, points=14)
        _add_line(
            session,
            game_id=game_id,
            team_id=home_id,
            player=injured,
            seconds_played=None,
            dnp_reason="DNP - Injury/Illness",
        )
        _add_line(
            session,
            game_id=game_id,
            team_id=home_id,
            player=coach,
            seconds_played=None,
            dnp_reason=None,
        )
        session.commit()
        played_id, injured_id, coach_id = played.id, injured.id, coach.id

    box = _detail(client, game_id)["home_box_score"]

    assert [r["player_id"] for r in box["players"]] == [played_id]
    dnp = sorted(box["did_not_play"], key=lambda r: r["player_id"])
    assert dnp == sorted(
        [
            {
                "player_id": injured_id,
                "first_name": "Kristaps",
                "last_name": "Porzingis",
                "dnp_reason": "DNP - Injury/Illness",
            },
            {
                "player_id": coach_id,
                "first_name": "Neemias",
                "last_name": "Queta",
                "dnp_reason": None,
            },
        ],
        key=lambda r: r["player_id"],
    )


def test_totals_are_sums_of_the_played_rows_with_computed_percentages(
    client, session_factory, matchup
):
    game_id, home_id, away_id = matchup
    with session_factory() as session:
        one = _add_player(session, "Jaylen", "Brown")
        two = _add_player(session, "Al", "Horford")
        dnp = _add_player(session, "Xavier", "Tillman")
        other_side = _add_player(session, "Anthony", "Davis")
        _add_line(
            session,
            game_id=game_id,
            team_id=home_id,
            player=one,
            seconds_played=2500,
            field_goals_made=8,
            field_goals_attempted=15,
            three_pointers_made=1,
            three_pointers_attempted=4,
            free_throws_made=4,
            free_throws_attempted=5,
            offensive_rebounds=2,
            defensive_rebounds=4,
            rebounds=6,
            assists=5,
            steals=2,
            blocks=1,
            turnovers=3,
            personal_fouls=1,
            points=21,
            plus_minus=12,
        )
        _add_line(
            session,
            game_id=game_id,
            team_id=home_id,
            player=two,
            seconds_played=1900,
            field_goals_made=3,
            field_goals_attempted=6,
            three_pointers_made=2,
            three_pointers_attempted=5,
            free_throws_made=0,
            free_throws_attempted=0,
            offensive_rebounds=1,
            defensive_rebounds=5,
            rebounds=6,
            assists=2,
            steals=0,
            blocks=2,
            turnovers=1,
            personal_fouls=3,
            points=8,
            plus_minus=7,
        )
        # A DNP row with (impossible) stats proves totals only read played rows.
        _add_line(
            session,
            game_id=game_id,
            team_id=home_id,
            player=dnp,
            seconds_played=None,
            points=50,
            field_goals_attempted=40,
        )
        _add_line(
            session,
            game_id=game_id,
            team_id=away_id,
            player=other_side,
            points=30,
            field_goals_made=12,
            field_goals_attempted=20,
        )
        session.commit()

    body = _detail(client, game_id)
    totals = body["home_box_score"]["totals"]

    assert totals["seconds_played"] == 4400
    assert totals["field_goals_made"] == 11
    assert totals["field_goals_attempted"] == 21
    assert totals["field_goal_pct"] == 0.524
    assert totals["three_pointers_made"] == 3
    assert totals["three_pointers_attempted"] == 9
    assert totals["three_point_pct"] == 0.333
    assert totals["free_throws_made"] == 4
    assert totals["free_throws_attempted"] == 5
    assert totals["free_throw_pct"] == 0.8
    assert totals["offensive_rebounds"] == 3
    assert totals["defensive_rebounds"] == 9
    assert totals["rebounds"] == 12
    assert totals["assists"] == 7
    assert totals["steals"] == 2
    assert totals["blocks"] == 3
    assert totals["turnovers"] == 4
    assert totals["personal_fouls"] == 4
    # 29, not the final score of 106: totals are never adjusted to match it.
    assert totals["points"] == 29
    assert body["home_score"] == 106
    assert body["away_box_score"]["totals"]["points"] == 30


def test_game_without_box_score_answers_with_empty_lists_and_zero_totals(client, matchup):
    game_id, _, _ = matchup

    body = _detail(client, game_id)

    for side in ("home_box_score", "away_box_score"):
        box = body[side]
        assert box["players"] == []
        assert box["did_not_play"] == []
        assert box["totals"]["seconds_played"] == 0
        for stat in COUNTING_STATS:
            assert box["totals"][stat] == 0, stat
        for pct in PERCENTAGES:
            assert box["totals"][pct] is None, pct


# --------------------------------------------------------------------- queries


def _count_statements(engine, client, game_id) -> int:
    statements: list[str] = []

    def _record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", _record)
    try:
        _detail(client, game_id)
    finally:
        event.remove(engine, "before_cursor_execute", _record)
    return len(statements)


def test_detail_is_a_fixed_number_of_queries_whatever_the_box_score(
    engine, client, session_factory, matchup
):
    game_id, home_id, away_id = matchup
    with session_factory() as session:
        for team_id in (home_id, away_id):
            _add_line(
                session,
                game_id=game_id,
                team_id=team_id,
                player=_add_player(session, "First", "Player"),
            )
        session.commit()

    small = _count_statements(engine, client, game_id)

    with session_factory() as session:
        for team_id in (home_id, away_id):
            for n in range(12):
                _add_line(
                    session,
                    game_id=game_id,
                    team_id=team_id,
                    player=_add_player(session, f"P{n}", "Bench"),
                    seconds_played=None if n >= 10 else 100 + n,
                    dnp_reason="DNP - Coach's Decision" if n >= 10 else None,
                )
        session.commit()

    large = _count_statements(engine, client, game_id)

    assert large == small
    assert large <= 3
