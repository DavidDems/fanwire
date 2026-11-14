"""Tests for GET /events/teams/{team_id}/seasons/{season} (EVENTS-007).
Spec: .ai/tasks/EVENTS-007/.

Pinned contract (extra fields are tolerated):

- The response is an object with `season`; `team` (at least `id`, `name`,
  `abbreviation`, `conference`, `division`); `record`, the regular-season
  record: `wins`, `losses`, `home_wins`, `home_losses`, `away_wins`,
  `away_losses` (the standings row's names); and `games`.
- `games` is every one of the team's games that season, of every stored
  type, newest first by date. Each has `game_id`, `date` (ISO datetime),
  `game_type`, `label`, `sub_label`, `opponent` (at least `id` and
  `abbreviation`), `is_home`, `team_score`, `opponent_score` (this team's
  and the opponent's final score) and `won` (a boolean).
- Only `regular` games are in `record`; every type is in `games`.
- 422 for a malformed season, 404 for a season with no stored game or an
  unknown team (test_seasons.py).
"""

from __future__ import annotations

from datetime import date, datetime, time

import pytest

from app.db import Base, make_session_factory
from tests.events.players_support import (
    add_game,
    add_player,
    make_client,
    make_players_engine,
)
from tests.events.seasons_support import (
    Calendar,
    add_conference_team,
    add_games,
    add_lines,
    add_result,
    statements_for,
)


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


def _season(client, team_id: int, season: str) -> dict:
    response = client.get(f"/events/teams/{team_id}/seasons/{season}")
    assert response.status_code == 200, response.text
    return response.json()


def _game(session, *, home, away, when, game_type, label, sub_label, scores) -> int:
    game = add_game(
        session,
        home=home,
        away=away,
        when=when,
        season="2023-24",
        game_type=game_type,
        home_score=scores[0],
        away_score=scores[1],
        label=label,
    )
    game.sub_label = sub_label
    session.flush()
    return game.id


@pytest.fixture()
def season(session_factory):
    """BOS's 2023-24, written out of date order (date, home, away, type,
    label, sub-label, home score, away score):
        2023-11-01 BOS-NYK regular              110-100  W home
        2023-11-14 MIA-BOS regular  Emirates NBA Cup / East Group C  101-99 L away
        2023-12-02 NYK-BOS regular              95-105   W away
        2023-12-09 BOS-LAL cup-final Emirates NBA Cup / Championship 120-121 L home
        2024-01-10 BOS-MIA regular              98-104   L home
        2024-04-21 BOS-MIA playoffs East - First Round / Game 1 114-94 W home
    plus a 2022-23 BOS game and a 2023-24 NYK-MIA game, neither BOS's
    2023-24. Regular record: 2-2, home 1-1, away 1-1."""
    with session_factory() as session:
        bos = add_conference_team(session, "BOS", "Boston Celtics", "Eastern", "Atlantic")
        nyk = add_conference_team(session, "NYK", "New York Knicks", "Eastern", "Atlantic")
        mia = add_conference_team(session, "MIA", "Miami Heat", "Eastern", "Southeast")
        lal = add_conference_team(session, "LAL", "Los Angeles Lakers", "Western", "Pacific")
        specs = {
            "playoffs": (
                date(2024, 4, 21),
                bos,
                mia,
                "playoffs",
                "East - First Round",
                "Game 1",
                (114, 94),
            ),
            "cup_group": (
                date(2023, 11, 14),
                mia,
                bos,
                "regular",
                "Emirates NBA Cup",
                "East Group C",
                (101, 99),
            ),
            "opener": (date(2023, 11, 1), bos, nyk, "regular", None, None, (110, 100)),
            "cup_final": (
                date(2023, 12, 9),
                bos,
                lal,
                "cup-final",
                "Emirates NBA Cup",
                "Championship",
                (120, 121),
            ),
            "january": (date(2024, 1, 10), bos, mia, "regular", None, None, (98, 104)),
            "away_win": (date(2023, 12, 2), nyk, bos, "regular", None, None, (95, 105)),
        }
        ids = {}
        for key, (day, home, away, game_type, label, sub_label, scores) in specs.items():
            ids[key] = _game(
                session,
                home=home,
                away=away,
                when=datetime.combine(day, time(19, 30)),
                game_type=game_type,
                label=label,
                sub_label=sub_label,
                scores=scores,
            )
        add_result(
            session, home=bos, away=nyk, home_won=True, season="2022-23", when=date(2023, 1, 3)
        )
        add_result(
            session, home=nyk, away=mia, home_won=True, season="2023-24", when=date(2023, 12, 20)
        )
        session.commit()
        return {
            "ids": ids,
            "team": {"BOS": bos.id, "NYK": nyk.id, "MIA": mia.id, "LAL": lal.id},
        }


def test_team_season_names_the_team(client, season):
    body = _season(client, season["team"]["BOS"], "2023-24")

    assert body["season"] == "2023-24"
    team = body["team"]
    assert (team["id"], team["name"], team["abbreviation"]) == (
        season["team"]["BOS"],
        "Boston Celtics",
        "BOS",
    )
    assert (team["conference"], team["division"]) == ("Eastern", "Atlantic")


def test_record_counts_regular_games_with_home_and_away_splits(client, season):
    record = _season(client, season["team"]["BOS"], "2023-24")["record"]

    got = {
        key: record[key]
        for key in ("wins", "losses", "home_wins", "home_losses", "away_wins", "away_losses")
    }
    assert got == {
        "wins": 2,
        "losses": 2,
        "home_wins": 1,
        "home_losses": 1,
        "away_wins": 1,
        "away_losses": 1,
    }


def test_games_are_every_type_newest_first(client, season):
    games = _season(client, season["team"]["BOS"], "2023-24")["games"]

    ids = season["ids"]
    assert [game["game_id"] for game in games] == [
        ids["playoffs"],
        ids["january"],
        ids["cup_final"],
        ids["away_win"],
        ids["cup_group"],
        ids["opener"],
    ]


def test_a_game_carries_opponent_side_scores_and_result(client, season):
    games = {
        game["game_id"]: game for game in _season(client, season["team"]["BOS"], "2023-24")["games"]
    }
    ids, team = season["ids"], season["team"]

    def view(key: str) -> tuple:
        game = games[ids[key]]
        return (
            game["game_type"],
            game["label"],
            game["sub_label"],
            game["opponent"]["id"],
            game["opponent"]["abbreviation"],
            game["is_home"],
            game["team_score"],
            game["opponent_score"],
            game["won"],
        )

    assert view("playoffs") == (
        "playoffs",
        "East - First Round",
        "Game 1",
        team["MIA"],
        "MIA",
        True,
        114,
        94,
        True,
    )
    assert view("cup_group") == (
        "regular",
        "Emirates NBA Cup",
        "East Group C",
        team["MIA"],
        "MIA",
        False,
        99,
        101,
        False,
    )
    assert view("away_win") == ("regular", None, None, team["NYK"], "NYK", False, 105, 95, True)
    assert view("cup_final") == (
        "cup-final",
        "Emirates NBA Cup",
        "Championship",
        team["LAL"],
        "LAL",
        True,
        120,
        121,
        False,
    )
    assert datetime.fromisoformat(games[ids["opener"]]["date"]).date() == date(2023, 11, 1)


def test_the_opponent_sees_the_same_game_from_its_side(client, season):
    games = _season(client, season["team"]["MIA"], "2023-24")["games"]

    cup_group = next(game for game in games if game["game_id"] == season["ids"]["cup_group"])
    assert (cup_group["is_home"], cup_group["team_score"], cup_group["opponent_score"]) == (
        True,
        101,
        99,
    )
    assert cup_group["won"] is True
    assert cup_group["opponent"]["abbreviation"] == "BOS"


# ------------------------------------------------------------------ queries


def test_team_season_is_a_fixed_number_of_queries(engine, client, session_factory):
    with session_factory() as session:
        small = add_conference_team(session, "SML", "Small Club", "Eastern", "Central")
        large = add_conference_team(session, "LRG", "Large Club", "Eastern", "Central")
        opponent = add_conference_team(session, "OPP", "Opponent Club", "Western", "Pacific")
        calendar = Calendar(date(2021, 10, 20))
        add_games(
            session, team=small, opponent=opponent, season="2021-22", count=1, calendar=calendar
        )
        many = add_games(
            session, team=large, opponent=opponent, season="2021-22", count=25, calendar=calendar
        )
        many += add_games(
            session,
            team=large,
            opponent=opponent,
            season="2021-22",
            count=4,
            calendar=calendar,
            game_type="playoffs",
        )
        add_lines(session, games=many, team=large, player=add_player(session, "Box", "Score"))
        session.commit()
        small_id, large_id = small.id, large.id

    few = statements_for(engine, client, f"/events/teams/{small_id}/seasons/2021-22")
    lots = statements_for(engine, client, f"/events/teams/{large_id}/seasons/2021-22")

    assert len(lots) == len(few), (few, lots)
    assert 1 <= len(lots) <= 6, lots
