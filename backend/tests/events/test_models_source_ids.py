"""Tests for EVENTS-001's schema change to Team and Game, per AGENTS.md TDD
workflow. Written before the change exists.

A Team or Game can now be keyed by its nba.com id (`nba_team_id` /
`nba_game_id`, from the Kaggle "NBA games" dataset), its API-SPORTS id, or
both -- but never neither (a CHECK constraint). Each id is unique. Game also
gains a nullable `game_type` ("regular" / "playoffs" / "play-in"). Every
API-SPORTS-only row keeps working exactly as before, and the response schemas
expose the new fields.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from psycopg.errors import CheckViolation
from sqlalchemy.exc import IntegrityError

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_session
from app.events.models import Game, Team
from app.events.routes import router


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


def _team(**overrides) -> Team:
    defaults = {
        "name": "Toronto Raptors",
        "abbreviation": "TOR",
        "conference": "Eastern",
        "division": "Atlantic",
    }
    defaults.update(overrides)
    return Team(**defaults)


def _game(home_team_id: int, away_team_id: int, **overrides) -> Game:
    defaults = {
        "home_team_id": home_team_id,
        "away_team_id": away_team_id,
        "date": datetime(2019, 10, 22, tzinfo=UTC),
        "season": "2019-20",
        "home_score": 130,
        "away_score": 122,
        "player_stats": [],
    }
    defaults.update(overrides)
    return Game(**defaults)


def _two_teams(session) -> tuple[int, int]:
    home = _team(nba_team_id=1610612761)
    away = _team(nba_team_id=1610612738, name="Boston Celtics", abbreviation="BOS")
    session.add_all([home, away])
    session.commit()
    return home.id, away.id


# --------------------------------------------------------------------- Team


def test_team_can_be_stored_with_only_an_nba_id(session_factory):
    with session_factory() as session:
        team = _team(nba_team_id=1610612761)
        session.add(team)
        session.commit()
        team_id = team.id

    with session_factory() as session:
        stored = session.get(Team, team_id)
        assert stored.nba_team_id == 1610612761
        assert stored.api_sports_team_id is None


def test_team_with_only_an_api_sports_id_still_works(session_factory):
    with session_factory() as session:
        team = _team(api_sports_team_id=12)
        session.add(team)
        session.commit()
        team_id = team.id

    with session_factory() as session:
        stored = session.get(Team, team_id)
        assert stored.api_sports_team_id == 12
        assert stored.nba_team_id is None


def test_team_with_neither_id_is_rejected(session_factory):
    with session_factory() as session:
        session.add(_team())
        with pytest.raises(IntegrityError) as excinfo:
            session.commit()

    # Rejected by the at-least-one-id CHECK, not by a NOT NULL on one column.
    assert isinstance(excinfo.value.orig, CheckViolation)


def test_nba_team_id_is_unique(session_factory):
    with session_factory() as session:
        session.add(_team(nba_team_id=1610612761))
        session.commit()
        session.add(_team(nba_team_id=1610612761, abbreviation="TO2"))
        with pytest.raises(IntegrityError):
            session.commit()


def test_nba_team_id_holds_a_real_nba_com_id(session_factory):
    """nba.com team ids (1610612737...) exceed a 32-bit int: BigInteger."""
    with session_factory() as session:
        session.add(_team(nba_team_id=1610612766))
        session.commit()


# --------------------------------------------------------------------- Game


def test_game_can_be_stored_with_only_an_nba_id_and_a_game_type(session_factory):
    with session_factory() as session:
        home_id, away_id = _two_teams(session)
        game = _game(home_id, away_id, nba_game_id=22200477, game_type="regular")
        session.add(game)
        session.commit()
        game_id = game.id

    with session_factory() as session:
        stored = session.get(Game, game_id)
        assert stored.nba_game_id == 22200477
        assert stored.api_sports_game_id is None
        assert stored.game_type == "regular"


def test_game_with_only_an_api_sports_id_still_works(session_factory):
    with session_factory() as session:
        home = _team(api_sports_team_id=12)
        away = _team(api_sports_team_id=17, abbreviation="LAL")
        session.add_all([home, away])
        session.commit()
        game = _game(home.id, away.id, api_sports_game_id=5001)
        session.add(game)
        session.commit()
        game_id = game.id

    with session_factory() as session:
        stored = session.get(Game, game_id)
        assert stored.api_sports_game_id == 5001
        assert stored.nba_game_id is None
        assert stored.game_type is None


def test_game_with_neither_id_is_rejected(session_factory):
    with session_factory() as session:
        home_id, away_id = _two_teams(session)
        session.add(_game(home_id, away_id))
        with pytest.raises(IntegrityError) as excinfo:
            session.commit()

    assert isinstance(excinfo.value.orig, CheckViolation)


def test_nba_game_id_is_unique(session_factory):
    with session_factory() as session:
        home_id, away_id = _two_teams(session)
        session.add(_game(home_id, away_id, nba_game_id=22200477))
        session.commit()
        session.add(_game(home_id, away_id, nba_game_id=22200477))
        with pytest.raises(IntegrityError):
            session.commit()


# --------------------------------------------------------------------- routes


def test_get_game_exposes_the_new_fields(client, session_factory):
    with session_factory() as session:
        home_id, away_id = _two_teams(session)
        game = _game(home_id, away_id, nba_game_id=41900001, game_type="playoffs")
        session.add(game)
        session.commit()
        game_id = game.id

    response = client.get(f"/events/games/{game_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["nba_game_id"] == 41900001
    assert body["game_type"] == "playoffs"
    assert body["api_sports_game_id"] is None


def test_get_team_exposes_the_new_fields(client, session_factory):
    with session_factory() as session:
        team = _team(nba_team_id=1610612761)
        session.add(team)
        session.commit()
        team_id = team.id

    response = client.get(f"/events/teams/{team_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["nba_team_id"] == 1610612761
    assert body["api_sports_team_id"] is None


def test_list_routes_serve_api_sports_only_rows_with_null_nba_ids(client, session_factory):
    with session_factory() as session:
        home = _team(api_sports_team_id=12)
        away = _team(api_sports_team_id=17, abbreviation="LAL")
        session.add_all([home, away])
        session.commit()
        session.add(_game(home.id, away.id, api_sports_game_id=5001))
        session.commit()

    teams = client.get("/events/teams")
    games = client.get("/events/games")

    assert teams.status_code == 200
    assert {t["nba_team_id"] for t in teams.json()} == {None}
    assert games.status_code == 200
    [game] = games.json()
    assert game["api_sports_game_id"] == 5001
    assert game["nba_game_id"] is None
    assert game["game_type"] is None
