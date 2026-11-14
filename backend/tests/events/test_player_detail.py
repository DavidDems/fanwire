"""Tests for GET /events/players/{player_id}: attributes, career lines and
season rows (EVENTS-006). Spec: .ai/tasks/EVENTS-006/.

Pinned contract (the response field names the spec leaves to the unit):

- The stored attributes under the model's own names: `id`, `first_name`,
  `last_name`, `birth_date` (ISO date), `height_inches`, `weight_lbs`,
  `country`, `school`, `jersey`, `position`, `draft_year`, `draft_round`,
  `draft_number`, `first_season`, `last_season`.
- `career_regular` and `career_playoffs`: one *line* each.
- `seasons`: a list of season rows, newest season first, each a *line* plus
  `season` ("YYYY-YY"), `game_type` ("regular" or "playoffs") and `teams`
  (abbreviations in the order first played that season).
- A *line* has `games_played`, `games_started`, `seconds_played`; the totals
  under BoxScorePlayerOut's names (`field_goals_made`,
  `field_goals_attempted`, `three_pointers_made`, `three_pointers_attempted`,
  `free_throws_made`, `free_throws_attempted`, `offensive_rebounds`,
  `defensive_rebounds`, `rebounds`, `assists`, `steals`, `blocks`,
  `turnovers`, `personal_fouls`, `points`); the percentages under
  ShootingOut's names (`field_goal_pct`, `three_point_pct`, `free_throw_pct`);
  and the per-game averages `points_per_game`, `rebounds_per_game`,
  `assists_per_game`, `steals_per_game`, `blocks_per_game`,
  `turnovers_per_game`, `three_pointers_made_per_game`, `minutes_per_game`.
  Averages are rounded to one place; null when no game was played.
  Percentages are a fraction from 0 to 1, three places, computed from the
  totals by the box score's own rule, null at zero attempts.
- Only played rows of `regular` and `playoffs` games count; play-in and
  cup-final games are in no line and no season row.

The expected figures below are worked by hand from the fixture.
"""

from __future__ import annotations

import ast
from datetime import date
from pathlib import Path

import pytest

from app.db import Base, make_session_factory
from tests.events.players_support import (
    AVERAGES,
    COUNTING_STATS,
    PERCENTAGES,
    add_game,
    add_line,
    add_long_career,
    add_player,
    add_team,
    make_client,
    make_players_engine,
    recorded_statements,
)

EVENTS_APP_DIR = Path(__file__).resolve().parents[2] / "app" / "events"


@pytest.fixture()
def engine(postgres_url):
    engine = make_players_engine(postgres_url)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def session_factory(engine):
    return make_session_factory(engine)


@pytest.fixture()
def client(session_factory):
    return make_client(session_factory)


def _detail(client, player_id: int) -> dict:
    response = client.get(f"/events/players/{player_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _stats(**values: int) -> dict[str, int]:
    """Counting stats in COUNTING_STATS order, from short names."""
    short = {
        "fgm": "field_goals_made",
        "fga": "field_goals_attempted",
        "tpm": "three_pointers_made",
        "tpa": "three_pointers_attempted",
        "ftm": "free_throws_made",
        "fta": "free_throws_attempted",
        "oreb": "offensive_rebounds",
        "dreb": "defensive_rebounds",
        "reb": "rebounds",
        "ast": "assists",
        "stl": "steals",
        "blk": "blocks",
        "tov": "turnovers",
        "pf": "personal_fouls",
        "pts": "points",
    }
    return {short[key]: value for key, value in values.items()}


def _line(row: dict) -> dict:
    keys = ("games_played", "games_started", "seconds_played", *COUNTING_STATS)
    return {key: row[key] for key in (*keys, *PERCENTAGES, *AVERAGES)}


@pytest.fixture()
def siakam(session_factory):
    """Pascal Siakam: TOR in 2022-23 (two played, one DNP, one play-in),
    traded TOR -> IND in 2023-24 (three regular, a cup-final, two playoff
    games), only a DNP in 2024-25. Games are written out of date order.
    Returns the player id."""
    with session_factory() as session:
        # IND is created before TOR: id order and alphabetical order both
        # put IND first, so "TOR, IND" can only come from first appearance.
        ind, tor, bos = add_team(session, "IND"), add_team(session, "TOR"), add_team(session, "BOS")
        player = add_player(
            session,
            "Pascal",
            "Siakam",
            birth_date=date(1994, 4, 2),
            height_inches=80,
            weight_lbs=230,
            country="Cameroon",
            school="New Mexico State",
            jersey="43",
            position="F",
            draft_year=2016,
            draft_round=1,
            draft_number=27,
            first_season="2016-17",
            last_season="2025-26",
        )

        def game(team, when, season, game_type="regular", home=True):
            return (
                add_game(
                    session,
                    home=team if home else bos,
                    away=bos if home else team,
                    when=when,
                    season=season,
                    game_type=game_type,
                ),
                team,
            )

        lines = [
            # 2023-24 playoffs, IND
            (
                game(ind, date(2024, 4, 23), "2023-24", "playoffs"),
                {"seconds_played": 2300, "starter": True, "plus_minus": -2}
                | _stats(fgm=8, fga=17, tpm=0, tpa=1, ftm=3, fta=3, oreb=1, dreb=6, reb=7)
                | _stats(ast=4, stl=2, blk=0, tov=1, pf=4, pts=19),
            ),
            (
                game(ind, date(2024, 4, 21), "2023-24", "playoffs", home=False),
                {"seconds_played": 2500, "starter": True, "plus_minus": 7}
                | _stats(fgm=9, fga=19, tpm=1, tpa=4, ftm=3, fta=4, oreb=2, dreb=7, reb=9)
                | _stats(ast=3, stl=1, blk=1, tov=3, pf=3, pts=22),
            ),
            # 2022-23 regular, TOR
            (
                game(tor, date(2022, 10, 21), "2022-23", home=False),
                {"seconds_played": 2160, "starter": True, "plus_minus": -4}
                | _stats(fgm=10, fga=18, tpm=2, tpa=5, ftm=3, fta=3, oreb=2, dreb=7, reb=9)
                | _stats(ast=6, stl=0, blk=0, tov=3, pf=2, pts=25),
            ),
            (
                game(tor, date(2022, 10, 19), "2022-23"),
                {"seconds_played": 2100, "starter": True, "plus_minus": 5}
                | _stats(fgm=8, fga=16, tpm=1, tpa=4, ftm=3, fta=4, oreb=1, dreb=5, reb=6)
                | _stats(ast=4, stl=1, blk=1, tov=2, pf=3, pts=20),
            ),
            # A DNP row with (impossible) stats: only played rows count.
            (
                game(tor, date(2022, 10, 23), "2022-23"),
                {"seconds_played": None, "dnp_reason": "DNP - Injury/Illness", "starter": True}
                | _stats(fgm=15, fga=30, pts=40, reb=20),
            ),
            # Play-in: in no line.
            (
                game(tor, date(2023, 4, 12), "2022-23", "play-in"),
                {"seconds_played": 2400, "starter": True}
                | _stats(fgm=12, fga=20, tpm=3, tpa=6, pts=30, reb=10, ast=5),
            ),
            # 2023-24 regular: TOR, then traded to IND.
            (
                game(ind, date(2024, 2, 1), "2023-24", home=False),
                {"seconds_played": 2000, "starter": True, "plus_minus": -3}
                | _stats(fgm=7, fga=14, tpm=1, tpa=3, ftm=3, fta=4, oreb=0, dreb=5, reb=5)
                | _stats(ast=4, stl=0, blk=1, tov=2, pf=1, pts=18),
            ),
            (
                game(ind, date(2024, 1, 20), "2023-24"),
                {"seconds_played": 2400, "starter": True, "plus_minus": 10}
                | _stats(fgm=9, fga=15, tpm=0, tpa=2, ftm=3, fta=5, oreb=2, dreb=6, reb=8)
                | _stats(ast=5, stl=1, blk=2, tov=2, pf=4, pts=21),
            ),
            (
                game(tor, date(2023, 11, 1), "2023-24"),
                {"seconds_played": 1800, "starter": False, "plus_minus": 0}
                | _stats(fgm=6, fga=12, tpm=1, tpa=3, ftm=2, fta=2, oreb=1, dreb=4, reb=5)
                | _stats(ast=3, stl=2, blk=0, tov=1, pf=2, pts=15),
            ),
            # Cup final, before any regular 2023-24 game and for IND: in no
            # line, and not the first team of 2023-24.
            (
                game(ind, date(2023, 10, 28), "2023-24", "cup-final"),
                {"seconds_played": 2600, "starter": True}
                | _stats(fgm=13, fga=21, tpm=2, tpa=4, ftm=5, fta=6, pts=33, reb=12),
            ),
            # 2024-25: only a DNP, so no season row.
            (
                game(ind, date(2024, 10, 23), "2024-25"),
                {"seconds_played": None, "dnp_reason": "DNP - Coach's Decision"},
            ),
        ]
        for (played_game, team), values in lines:
            add_line(session, game=played_game, team=team, player=player, **values)
        session.commit()
        return player.id


# --------------------------------------------------------------- attributes


def test_detail_carries_the_stored_attributes(client, siakam):
    body = _detail(client, siakam)

    expected = {
        "id": siakam,
        "first_name": "Pascal",
        "last_name": "Siakam",
        "birth_date": "1994-04-02",
        "height_inches": 80,
        "weight_lbs": 230,
        "country": "Cameroon",
        "school": "New Mexico State",
        "jersey": "43",
        "position": "F",
        "draft_year": 2016,
        "draft_round": 1,
        "draft_number": 27,
        "first_season": "2016-17",
        "last_season": "2025-26",
    }
    assert {key: body[key] for key in expected} == expected


def test_attributes_left_blank_are_null(client, session_factory):
    with session_factory() as session:
        player = add_player(session, None, "Nenê")
        session.commit()
        player_id = player.id

    body = _detail(client, player_id)

    for key in (
        "first_name",
        "birth_date",
        "height_inches",
        "weight_lbs",
        "country",
        "school",
        "jersey",
        "position",
        "draft_year",
        "draft_round",
        "draft_number",
        "first_season",
        "last_season",
    ):
        assert body[key] is None, key
    assert body["last_name"] == "Nenê"


def test_unknown_player_is_404(client, siakam):
    assert client.get(f"/events/players/{siakam}").status_code == 200

    response = client.get(f"/events/players/{siakam + 1000}")

    assert response.status_code == 404


def test_non_integer_player_id_is_422(client, siakam):
    response = client.get("/events/players/abc")

    assert response.status_code == 422


# ------------------------------------------------------------- career lines


def test_regular_season_career_line(client, siakam):
    line = _line(_detail(client, siakam)["career_regular"])

    # Played regular rows: 2022-10-19, 2022-10-21, 2023-11-01, 2024-01-20,
    # 2024-02-01. Not the DNP, the play-in, the cup final or the playoffs.
    assert line == {
        "games_played": 5,
        "games_started": 4,
        "seconds_played": 10460,
        "field_goals_made": 40,
        "field_goals_attempted": 75,
        "three_pointers_made": 5,
        "three_pointers_attempted": 17,
        "free_throws_made": 14,
        "free_throws_attempted": 18,
        "offensive_rebounds": 6,
        "defensive_rebounds": 27,
        "rebounds": 33,
        "assists": 22,
        "steals": 4,
        "blocks": 4,
        "turnovers": 10,
        "personal_fouls": 12,
        "points": 99,
        "field_goal_pct": 0.533,
        "three_point_pct": 0.294,
        "free_throw_pct": 0.778,
        "points_per_game": 19.8,
        "rebounds_per_game": 6.6,
        "assists_per_game": 4.4,
        "steals_per_game": 0.8,
        "blocks_per_game": 0.8,
        "turnovers_per_game": 2.0,
        "three_pointers_made_per_game": 1.0,
        # 10460 s = 174.33 min over 5 games.
        "minutes_per_game": 34.9,
    }


def test_playoff_career_line(client, siakam):
    line = _line(_detail(client, siakam)["career_playoffs"])

    assert line == {
        "games_played": 2,
        "games_started": 2,
        "seconds_played": 4800,
        "field_goals_made": 17,
        "field_goals_attempted": 36,
        "three_pointers_made": 1,
        "three_pointers_attempted": 5,
        "free_throws_made": 6,
        "free_throws_attempted": 7,
        "offensive_rebounds": 3,
        "defensive_rebounds": 13,
        "rebounds": 16,
        "assists": 7,
        "steals": 3,
        "blocks": 1,
        "turnovers": 4,
        "personal_fouls": 7,
        "points": 41,
        "field_goal_pct": 0.472,
        "three_point_pct": 0.2,
        "free_throw_pct": 0.857,
        "points_per_game": 20.5,
        "rebounds_per_game": 8.0,
        "assists_per_game": 3.5,
        "steals_per_game": 1.5,
        "blocks_per_game": 0.5,
        "turnovers_per_game": 2.0,
        "three_pointers_made_per_game": 0.5,
        "minutes_per_game": 40.0,
    }


def test_no_playoff_games_gives_a_line_of_zeros_with_null_averages(client, session_factory):
    with session_factory() as session:
        team, opponent = add_team(session, "SAC"), add_team(session, "POR")
        player = add_player(session, "Regular", "Only")
        game = add_game(session, home=team, away=opponent, when=date(2024, 1, 1), season="2023-24")
        add_line(session, game=game, team=team, player=player, points=12)
        # A playoff DNP is still no playoff game played.
        playoff = add_game(
            session,
            home=team,
            away=opponent,
            when=date(2024, 4, 20),
            season="2023-24",
            game_type="playoffs",
        )
        add_line(session, game=playoff, team=team, player=player, seconds_played=None)
        session.commit()
        player_id = player.id

    body = _detail(client, player_id)
    playoffs = body["career_playoffs"]

    assert playoffs["games_played"] == 0
    assert playoffs["games_started"] == 0
    assert playoffs["seconds_played"] == 0
    for stat in COUNTING_STATS:
        assert playoffs[stat] == 0, stat
    for key in (*AVERAGES, *PERCENTAGES):
        assert playoffs[key] is None, key
    assert body["career_regular"]["points"] == 12


def test_player_without_games_has_two_empty_lines_and_no_seasons(client, session_factory):
    with session_factory() as session:
        player = add_player(session, "No", "Games")
        session.commit()
        player_id = player.id

    body = _detail(client, player_id)

    for key in ("career_regular", "career_playoffs"):
        assert body[key]["games_played"] == 0, key
        assert body[key]["points_per_game"] is None, key
        assert body[key]["field_goal_pct"] is None, key
    assert body["seasons"] == []


# --------------------------------------------------------------- season rows


def test_one_row_per_season_and_game_type_played_newest_first(client, siakam):
    seasons = _detail(client, siakam)["seasons"]

    keys = [(row["season"], row["game_type"]) for row in seasons]
    # No 2024-25 (DNP only), no play-in or cup-final rows.
    assert sorted(keys) == sorted(
        [("2023-24", "regular"), ("2023-24", "playoffs"), ("2022-23", "regular")]
    )
    order = [row["season"] for row in seasons]
    assert order == sorted(order, reverse=True)


def _season(seasons: list[dict], season: str, game_type: str) -> dict:
    (row,) = [r for r in seasons if r["season"] == season and r["game_type"] == game_type]
    return row


def test_traded_season_lists_teams_in_order_first_played_and_sums_across_them(client, siakam):
    row = _season(_detail(client, siakam)["seasons"], "2023-24", "regular")

    assert row["teams"] == ["TOR", "IND"]
    assert _line(row) == {
        "games_played": 3,
        "games_started": 2,
        "seconds_played": 6200,
        "field_goals_made": 22,
        "field_goals_attempted": 41,
        "three_pointers_made": 2,
        "three_pointers_attempted": 8,
        "free_throws_made": 8,
        "free_throws_attempted": 11,
        "offensive_rebounds": 3,
        "defensive_rebounds": 15,
        "rebounds": 18,
        "assists": 12,
        "steals": 3,
        "blocks": 3,
        "turnovers": 5,
        "personal_fouls": 7,
        "points": 54,
        "field_goal_pct": 0.537,
        "three_point_pct": 0.25,
        "free_throw_pct": 0.727,
        "points_per_game": 18.0,
        "rebounds_per_game": 6.0,
        "assists_per_game": 4.0,
        "steals_per_game": 1.0,
        "blocks_per_game": 1.0,
        "turnovers_per_game": 1.7,
        "three_pointers_made_per_game": 0.7,
        "minutes_per_game": 34.4,
    }


def test_playoff_season_row(client, siakam):
    row = _season(_detail(client, siakam)["seasons"], "2023-24", "playoffs")

    assert row["teams"] == ["IND"]
    assert _line(row) == _line(_detail(client, siakam)["career_playoffs"])


def test_season_row_counts_only_played_rows(client, siakam):
    row = _season(_detail(client, siakam)["seasons"], "2022-23", "regular")

    assert row["teams"] == ["TOR"]
    assert _line(row) == {
        "games_played": 2,
        "games_started": 2,
        "seconds_played": 4260,
        "field_goals_made": 18,
        "field_goals_attempted": 34,
        "three_pointers_made": 3,
        "three_pointers_attempted": 9,
        "free_throws_made": 6,
        "free_throws_attempted": 7,
        "offensive_rebounds": 3,
        "defensive_rebounds": 12,
        "rebounds": 15,
        "assists": 10,
        "steals": 1,
        "blocks": 1,
        "turnovers": 5,
        "personal_fouls": 5,
        "points": 45,
        "field_goal_pct": 0.529,
        "three_point_pct": 0.333,
        "free_throw_pct": 0.857,
        "points_per_game": 22.5,
        "rebounds_per_game": 7.5,
        "assists_per_game": 5.0,
        "steals_per_game": 0.5,
        "blocks_per_game": 0.5,
        "turnovers_per_game": 2.5,
        "three_pointers_made_per_game": 1.5,
        "minutes_per_game": 35.5,
    }


# ---------------------------------------------------- the shared percentage


def test_percentages_follow_the_box_scores_rounding_rule(client, session_factory):
    """1/16 = 0.0625 and 5/16 = 0.3125 sit exactly halfway at three places.
    The box score's rule (EVENTS-005) gives 0.062 and 0.312; a second rule
    such as Postgres's ROUND, which rounds half away from zero, gives 0.063
    and 0.313. Both pages must show the same figure."""
    with session_factory() as session:
        team, opponent = add_team(session, "UTA"), add_team(session, "DEN")
        player = add_player(session, "Half", "Way")
        game = add_game(session, home=team, away=opponent, when=date(2024, 1, 1), season="2023-24")
        add_line(
            session,
            game=game,
            team=team,
            player=player,
            field_goals_made=1,
            field_goals_attempted=16,
            free_throws_made=5,
            free_throws_attempted=16,
            three_pointers_made=1,
            three_pointers_attempted=16,
            points=8,
        )
        session.commit()
        player_id, game_id = player.id, game.id

    box = client.get(f"/events/games/{game_id}").json()["home_box_score"]["players"][0]
    body = _detail(client, player_id)

    for line in (body["career_regular"], _season(body["seasons"], "2023-24", "regular")):
        assert line["field_goal_pct"] == box["field_goal_pct"] == 0.062
        assert line["three_point_pct"] == box["three_point_pct"] == 0.062
        assert line["free_throw_pct"] == box["free_throw_pct"] == 0.312


def _three_place_rounds(source: str) -> int:
    """Calls of round(..., 3) or <x>.round(..., 3) in a module's source."""
    found = 0
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        name = func.id if isinstance(func, ast.Name) else getattr(func, "attr", None)
        if name != "round":
            continue
        digits = node.args[1] if len(node.args) > 1 else None
        for keyword in node.keywords:
            if keyword.arg == "ndigits":
                digits = keyword.value
        if isinstance(digits, ast.Constant) and digits.value == 3:
            found += 1
    return found


def test_events_has_one_percentage_rule():
    """The box score and the player lines share one helper: there is exactly
    one place in app/events that rounds to three places."""
    sources = {path.name: path.read_text(encoding="utf-8") for path in EVENTS_APP_DIR.glob("*.py")}

    counts = {name: _three_place_rounds(source) for name, source in sources.items()}

    assert sum(counts.values()) == 1, counts


# -------------------------------------------------------------------- queries


def _detail_statements(engine, client, player_id: int) -> list[str]:
    _detail(client, player_id)  # warm-up: connection setup is not the detail's
    with recorded_statements(engine) as statements:
        _detail(client, player_id)
    return statements


def test_detail_is_a_fixed_number_of_queries_whatever_the_career(engine, client, session_factory):
    with session_factory() as session:
        one, two, opponent = (
            add_team(session, "PHX"),
            add_team(session, "DAL"),
            add_team(session, "SAS"),
        )
        short = add_player(session, "Short", "Career")
        for day in (1, 2, 3):
            game = add_game(
                session, home=one, away=opponent, when=date(2024, 1, day), season="2023-24"
            )
            add_line(session, game=game, team=one, player=short, points=day)
        long = add_player(session, "Long", "Career")
        assert add_long_career(session, long, [one, two], opponent) >= 40
        session.commit()
        short_id, long_id = short.id, long.id

    small = _detail_statements(engine, client, short_id)
    large = _detail_statements(engine, client, long_id)

    assert len(large) == len(small), (small, large)
    assert 1 <= len(large) <= 8, large


def test_career_and_season_lines_are_grouped_in_postgres(engine, client, session_factory):
    with session_factory() as session:
        one, two, opponent = (
            add_team(session, "PHX"),
            add_team(session, "DAL"),
            add_team(session, "SAS"),
        )
        long = add_player(session, "Long", "Career")
        add_long_career(session, long, [one, two], opponent)
        session.commit()
        long_id = long.id

    statements = _detail_statements(engine, client, long_id)

    assert any("GROUP BY" in statement.upper() for statement in statements), statements
