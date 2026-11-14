"""Tests for GET /events/games's pagination and filters (EVENTS-005).

A full load is ~29,646 games, over a Lambda response's 6 MB as one list, so
the route pages: `limit` (default 50, at most 200) and `offset`, newest
first, `date desc, id desc` so that pages sharing an evening never overlap
or skip a game. Filters `season`, `team_id`, `game_type`, `date_from` and
`date_to` are ANDed; every malformed value is a 422, never an empty list.
The response is still a list of GameOut, so the compose picker keeps
working. Spec: .ai/tasks/EVENTS-005/.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_session
from app.events.models import Game, Team
from app.events.routes import router

GAME_OUT_KEYS = {
    "id",
    "nba_game_id",
    "home_team_id",
    "away_team_id",
    "date",
    "season",
    "home_score",
    "away_score",
    "venue",
    "game_type",
}


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


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
def teams(session_factory):
    """Three teams, returned as their ids: (BOS, LAL, MIA)."""
    with session_factory() as session:
        rows = [
            Team(
                nba_team_id=1610612738,
                name="Boston Celtics",
                abbreviation="BOS",
                conference="East",
                division="Atlantic",
            ),
            Team(
                nba_team_id=1610612747,
                name="Los Angeles Lakers",
                abbreviation="LAL",
                conference="West",
                division="Pacific",
            ),
            Team(
                nba_team_id=1610612748,
                name="Miami Heat",
                abbreviation="MIA",
                conference="East",
                division="Southeast",
            ),
        ]
        session.add_all(rows)
        session.commit()
        return tuple(team.id for team in rows)


def _add_games(session_factory, games: list[dict]) -> None:
    with session_factory() as session:
        for spec in games:
            values = {
                "season": "2025-26",
                "home_score": 110,
                "away_score": 100,
                "game_type": "regular",
            }
            values.update(spec)
            session.add(Game(**values))
        session.commit()


def _nba_ids(response) -> list[int]:
    assert response.status_code == 200, response.text
    return [game["nba_game_id"] for game in response.json()]


# ------------------------------------------------------------------ pagination


def test_default_limit_is_50_newest_first(client, session_factory, teams):
    bos, lal, _ = teams
    start = datetime(2025, 10, 21, 19, 30)
    _add_games(
        session_factory,
        [
            {
                "nba_game_id": 1000 + n,
                "home_team_id": bos,
                "away_team_id": lal,
                "date": start + timedelta(days=n),
            }
            for n in range(55)
        ],
    )

    ids = _nba_ids(client.get("/events/games"))

    assert ids == [1000 + n for n in range(54, 4, -1)]


def test_limit_and_offset_select_a_page(client, session_factory, teams):
    bos, lal, _ = teams
    start = datetime(2025, 10, 21, 19, 30)
    _add_games(
        session_factory,
        [
            {
                "nba_game_id": 1000 + n,
                "home_team_id": bos,
                "away_team_id": lal,
                "date": start + timedelta(days=n),
            }
            for n in range(10)
        ],
    )

    ids = _nba_ids(client.get("/events/games", params={"limit": 3, "offset": 2}))

    assert ids == [1007, 1006, 1005]


def test_limit_200_is_allowed(client, teams):
    response = client.get("/events/games", params={"limit": 200})

    assert response.status_code == 200
    assert response.json() == []


def test_pages_over_one_evening_never_overlap_or_skip(client, session_factory, teams):
    """A dozen games share an evening: `date` alone is no order, so the
    tie-break is the id, descending."""
    bos, lal, _ = teams
    evening = datetime(2025, 11, 1, 19, 30)
    _add_games(
        session_factory,
        [
            {
                "nba_game_id": 2000 + n,
                "home_team_id": bos,
                "away_team_id": lal,
                "date": evening,
            }
            for n in range(7)
        ],
    )
    with session_factory() as session:
        expected = [game.nba_game_id for game in session.query(Game).order_by(Game.id.desc()).all()]

    pages = [
        _nba_ids(client.get("/events/games", params={"limit": 3, "offset": offset}))
        for offset in (0, 3, 6)
    ]

    assert [len(page) for page in pages] == [3, 3, 1]
    assert pages[0] + pages[1] + pages[2] == expected


@pytest.mark.parametrize(
    "params",
    [
        {"limit": 0},
        {"limit": 201},
        {"limit": -5},
        {"offset": -1},
        {"limit": "ten"},
    ],
)
def test_bad_limit_or_offset_is_422(client, teams, params):
    response = client.get("/events/games", params=params)

    assert response.status_code == 422


def test_response_is_still_a_list_of_game_out(client, session_factory, teams):
    bos, lal, _ = teams
    _add_games(
        session_factory,
        [
            {
                "nba_game_id": 3001,
                "home_team_id": bos,
                "away_team_id": lal,
                "date": datetime(2025, 11, 1, 19, 30),
                "venue": "TD Garden",
            }
        ],
    )

    response = client.get("/events/games")

    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    assert set(body[0]) == GAME_OUT_KEYS


# --------------------------------------------------------------------- filters


def test_filters_by_season(client, session_factory, teams):
    bos, lal, _ = teams
    _add_games(
        session_factory,
        [
            {
                "nba_game_id": 1,
                "home_team_id": bos,
                "away_team_id": lal,
                "date": datetime(2025, 11, 1, 19, 30),
                "season": "2025-26",
            },
            {
                "nba_game_id": 2,
                "home_team_id": bos,
                "away_team_id": lal,
                "date": datetime(2024, 11, 1, 19, 30),
                "season": "2024-25",
            },
        ],
    )

    assert _nba_ids(client.get("/events/games", params={"season": "2024-25"})) == [2]


@pytest.mark.parametrize("season", ["2025", "2025-2026", "25-26", "abcd-ef", "2025-26 "])
def test_malformed_season_is_422(client, teams, season):
    response = client.get("/events/games", params={"season": season})

    assert response.status_code == 422


def test_filters_by_team_home_or_away(client, session_factory, teams):
    bos, lal, mia = teams
    _add_games(
        session_factory,
        [
            {
                "nba_game_id": 1,
                "home_team_id": bos,
                "away_team_id": lal,
                "date": datetime(2025, 11, 1, 19, 30),
            },
            {
                "nba_game_id": 2,
                "home_team_id": lal,
                "away_team_id": bos,
                "date": datetime(2025, 11, 2, 19, 30),
            },
            {
                "nba_game_id": 3,
                "home_team_id": lal,
                "away_team_id": mia,
                "date": datetime(2025, 11, 3, 19, 30),
            },
        ],
    )

    assert _nba_ids(client.get("/events/games", params={"team_id": bos})) == [2, 1]


@pytest.mark.parametrize("game_type", ["regular", "cup-final", "play-in", "playoffs"])
def test_filters_by_each_game_type(client, session_factory, teams, game_type):
    bos, lal, _ = teams
    types = ["regular", "cup-final", "play-in", "playoffs"]
    _add_games(
        session_factory,
        [
            {
                "nba_game_id": 10 + n,
                "home_team_id": bos,
                "away_team_id": lal,
                "date": datetime(2026, 4, 1, 19, 30) + timedelta(days=n),
                "game_type": kind,
            }
            for n, kind in enumerate(types)
        ],
    )

    ids = _nba_ids(client.get("/events/games", params={"game_type": game_type}))

    assert ids == [10 + types.index(game_type)]


@pytest.mark.parametrize("game_type", ["preseason", "Regular", "all-star", ""])
def test_unknown_game_type_is_422(client, teams, game_type):
    response = client.get("/events/games", params={"game_type": game_type})

    assert response.status_code == 422


def test_date_range_is_inclusive_calendar_days(client, session_factory, teams):
    """`date_to` covers the whole of its day: a game at 23:30 that evening
    is in, a game at midnight the next day is out."""
    bos, lal, _ = teams
    _add_games(
        session_factory,
        [
            {
                "nba_game_id": 1,
                "home_team_id": bos,
                "away_team_id": lal,
                "date": datetime(2025, 11, 1, 23, 30),
            },
            {
                "nba_game_id": 2,
                "home_team_id": bos,
                "away_team_id": lal,
                "date": datetime(2025, 11, 2, 0, 0),
            },
            {
                "nba_game_id": 3,
                "home_team_id": bos,
                "away_team_id": lal,
                "date": datetime(2025, 11, 2, 22, 0),
            },
            {
                "nba_game_id": 4,
                "home_team_id": bos,
                "away_team_id": lal,
                "date": datetime(2025, 11, 3, 0, 0),
            },
        ],
    )

    one_day = {"date_from": "2025-11-02", "date_to": "2025-11-02"}
    assert _nba_ids(client.get("/events/games", params=one_day)) == [3, 2]
    assert _nba_ids(client.get("/events/games", params={"date_to": "2025-11-01"})) == [1]
    assert _nba_ids(client.get("/events/games", params={"date_from": "2025-11-03"})) == [4]


def test_date_from_after_date_to_is_422(client, teams):
    response = client.get(
        "/events/games", params={"date_from": "2025-11-03", "date_to": "2025-11-02"}
    )

    assert response.status_code == 422


@pytest.mark.parametrize("param", ["date_from", "date_to"])
@pytest.mark.parametrize("value", ["2025-13-01", "yesterday", "2025/11/01"])
def test_malformed_date_is_422(client, teams, param, value):
    response = client.get("/events/games", params={param: value})

    assert response.status_code == 422


def test_filters_combine_with_and(client, session_factory, teams):
    bos, lal, mia = teams
    _add_games(
        session_factory,
        [
            # Matches every filter.
            {
                "nba_game_id": 1,
                "home_team_id": lal,
                "away_team_id": bos,
                "date": datetime(2025, 5, 10, 20, 0),
                "season": "2024-25",
                "game_type": "playoffs",
            },
            # Wrong team.
            {
                "nba_game_id": 2,
                "home_team_id": lal,
                "away_team_id": mia,
                "date": datetime(2025, 5, 11, 20, 0),
                "season": "2024-25",
                "game_type": "playoffs",
            },
            # Wrong game type.
            {
                "nba_game_id": 3,
                "home_team_id": bos,
                "away_team_id": lal,
                "date": datetime(2025, 3, 1, 20, 0),
                "season": "2024-25",
                "game_type": "regular",
            },
            # Wrong season.
            {
                "nba_game_id": 4,
                "home_team_id": bos,
                "away_team_id": lal,
                "date": datetime(2024, 5, 10, 20, 0),
                "season": "2023-24",
                "game_type": "playoffs",
            },
            # Outside the dates.
            {
                "nba_game_id": 5,
                "home_team_id": bos,
                "away_team_id": lal,
                "date": datetime(2025, 6, 10, 20, 0),
                "season": "2024-25",
                "game_type": "playoffs",
            },
        ],
    )

    params = {
        "season": "2024-25",
        "team_id": bos,
        "game_type": "playoffs",
        "date_from": "2025-04-01",
        "date_to": "2025-05-31",
    }
    assert _nba_ids(client.get("/events/games", params=params)) == [1]
