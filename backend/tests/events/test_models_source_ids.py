"""Tests for how Team and Game are keyed, per AGENTS.md TDD workflow.

EVENTS-001 let a row be keyed by its nba.com id, its API-SPORTS id, or both,
with a CHECK requiring at least one. EVENTS-003 retires API-SPORTS: the
nba.com id (`nba_team_id` / `nba_game_id`, from the Kaggle "NBA games"
dataset) is now the only source id, required on every row and unique, and
neither the models nor the response schemas carry an `api_sports_*` field.
Game keeps its nullable `game_type` ("regular" / "playoffs" / "play-in").
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from psycopg.errors import NotNullViolation
from sqlalchemy import CheckConstraint, UniqueConstraint
from sqlalchemy.exc import IntegrityError

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_session
from app.events.models import Game, Team
from app.events.routes import router
from app.events.schemas import GameOut, TeamOut


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
    }
    defaults.update(overrides)
    return Game(**defaults)


def _two_teams(session) -> tuple[int, int]:
    home = _team(nba_team_id=1610612761)
    away = _team(nba_team_id=1610612738, name="Boston Celtics", abbreviation="BOS")
    session.add_all([home, away])
    session.commit()
    return home.id, away.id


def _api_sports_keys(body) -> set[str]:
    return {key for key in body if key.startswith("api_sports")}


# --------------------------------------------------------------------- models


def test_models_carry_no_api_sports_id():
    assert not hasattr(Team, "api_sports_team_id")
    assert not hasattr(Game, "api_sports_game_id")
    assert "api_sports_team_id" not in Team.__table__.c
    assert "api_sports_game_id" not in Game.__table__.c


def test_models_declare_nba_ids_required_and_unique():
    for column in (Team.__table__.c.nba_team_id, Game.__table__.c.nba_game_id):
        assert column.nullable is False, column
        single_column_uniques = {
            tuple(c.columns.keys())
            for c in column.table.constraints
            if isinstance(c, UniqueConstraint)
        }
        assert column.unique or (column.name,) in single_column_uniques, column


def test_models_declare_no_has_source_id_check():
    for table in (Team.__table__, Game.__table__):
        names = {c.name for c in table.constraints if isinstance(c, CheckConstraint)}
        assert "ck_teams_has_source_id" not in names
        assert "ck_games_has_source_id" not in names


# --------------------------------------------------------------------- Team


def test_team_is_stored_with_its_nba_id(session_factory):
    with session_factory() as session:
        team = _team(nba_team_id=1610612761)
        session.add(team)
        session.commit()
        team_id = team.id

    with session_factory() as session:
        stored = session.get(Team, team_id)
        assert stored.nba_team_id == 1610612761


def test_team_without_an_nba_id_is_rejected_by_not_null(session_factory):
    with session_factory() as session:
        session.add(_team())
        with pytest.raises(IntegrityError) as excinfo:
            session.commit()

    # A NOT NULL on nba_team_id, no longer the at-least-one-id CHECK.
    assert isinstance(excinfo.value.orig, NotNullViolation)


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


def test_game_is_stored_with_its_nba_id_and_a_game_type(session_factory):
    with session_factory() as session:
        home_id, away_id = _two_teams(session)
        game = _game(home_id, away_id, nba_game_id=22200477, game_type="regular")
        session.add(game)
        session.commit()
        game_id = game.id

    with session_factory() as session:
        stored = session.get(Game, game_id)
        assert stored.nba_game_id == 22200477
        assert stored.game_type == "regular"


def test_game_without_an_nba_id_is_rejected_by_not_null(session_factory):
    with session_factory() as session:
        home_id, away_id = _two_teams(session)
        session.add(_game(home_id, away_id))
        with pytest.raises(IntegrityError) as excinfo:
            session.commit()

    assert isinstance(excinfo.value.orig, NotNullViolation)


def test_nba_game_id_is_unique(session_factory):
    with session_factory() as session:
        home_id, away_id = _two_teams(session)
        session.add(_game(home_id, away_id, nba_game_id=22200477))
        session.commit()
        session.add(_game(home_id, away_id, nba_game_id=22200477))
        with pytest.raises(IntegrityError):
            session.commit()


# --------------------------------------------------------------------- schemas


def test_response_schemas_expose_no_api_sports_field():
    assert _api_sports_keys(TeamOut.model_fields) == set()
    assert _api_sports_keys(GameOut.model_fields) == set()


def test_response_schemas_make_nba_ids_required_ints():
    assert TeamOut.model_fields["nba_team_id"].annotation is int
    assert GameOut.model_fields["nba_game_id"].annotation is int


# --------------------------------------------------------------------- routes


def test_get_game_exposes_nba_fields_and_no_api_sports_id(client, session_factory):
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
    assert _api_sports_keys(body) == set()


def test_get_team_exposes_nba_id_and_no_api_sports_id(client, session_factory):
    with session_factory() as session:
        team = _team(nba_team_id=1610612761)
        session.add(team)
        session.commit()
        team_id = team.id

    response = client.get(f"/events/teams/{team_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["nba_team_id"] == 1610612761
    assert _api_sports_keys(body) == set()


def test_list_routes_expose_no_api_sports_ids(client, session_factory):
    with session_factory() as session:
        home_id, away_id = _two_teams(session)
        session.add(_game(home_id, away_id, nba_game_id=22200477))
        session.commit()

    teams = client.get("/events/teams")
    games = client.get("/events/games")

    assert teams.status_code == 200
    assert {t["nba_team_id"] for t in teams.json()} == {1610612761, 1610612738}
    assert all(_api_sports_keys(t) == set() for t in teams.json())
    assert games.status_code == 200
    [game] = games.json()
    assert game["nba_game_id"] == 22200477
    assert _api_sports_keys(game) == set()
