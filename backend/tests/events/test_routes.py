"""Tests for the public, read-only events/ routes, per AGENTS.md TDD
workflow. Written before app/events/routes.py exists.

Routers aren't wired into app.main yet (that's a later unit's job), so this
builds a throwaway local FastAPI() app that includes the events router and
overrides get_session, the same "build a small app, override the dependency"
pattern backend/tests/users/test_dependencies.py uses for
get_current_identity.

See wiki/CodeContext/Modules/0x02-events.md for the business rule this
closes ("Create an API to serve the data of these game from the database to
the website").
"""

from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

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


def _make_team(**overrides):
    defaults = {
        "api_sports_team_id": 12,
        "name": "Boston Celtics",
        "abbreviation": "BOS",
        "conference": "Eastern",
        "division": "Atlantic",
        "logo_url": "https://example.com/bos.png",
    }
    defaults.update(overrides)
    return Team(**defaults)


def _make_game(*, home_team_id, away_team_id, **overrides):
    defaults = {
        "api_sports_game_id": 5001,
        "home_team_id": home_team_id,
        "away_team_id": away_team_id,
        "date": datetime(2025, 11, 1, 19, 30, tzinfo=UTC),
        "season": "2025-26",
        "home_score": 112,
        "away_score": 108,
        "venue": "TD Garden",
        "player_stats": [{"player_name": "Jayson Tatum", "team_id": home_team_id, "points": 28}],
    }
    defaults.update(overrides)
    return Game(**defaults)


def test_list_teams_returns_empty_list_when_no_teams(client):
    response = client.get("/events/teams")

    assert response.status_code == 200
    assert response.json() == []


def test_list_teams_returns_all_teams(client, session_factory):
    with session_factory() as session:
        session.add_all(
            [
                _make_team(api_sports_team_id=12, name="Boston Celtics", abbreviation="BOS"),
                _make_team(
                    api_sports_team_id=17,
                    name="Los Angeles Lakers",
                    abbreviation="LAL",
                    conference="Western",
                    division="Pacific",
                ),
            ]
        )
        session.commit()

    response = client.get("/events/teams")

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 2
    names = {team["name"] for team in body}
    assert names == {"Boston Celtics", "Los Angeles Lakers"}


def test_get_team_by_id_returns_team_when_found(client, session_factory):
    with session_factory() as session:
        team = _make_team()
        session.add(team)
        session.commit()
        team_id = team.id

    response = client.get(f"/events/teams/{team_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == team_id
    assert body["name"] == "Boston Celtics"
    assert body["logo_url"] == "https://example.com/bos.png"


def test_get_team_by_id_returns_404_when_not_found(client):
    response = client.get("/events/teams/999999")

    assert response.status_code == 404


def test_list_games_returns_empty_list_when_no_games(client):
    response = client.get("/events/games")

    assert response.status_code == 200
    assert response.json() == []


def test_list_games_returns_all_games_unfiltered(client, session_factory):
    with session_factory() as session:
        home = _make_team(api_sports_team_id=12, name="Boston Celtics", abbreviation="BOS")
        away = _make_team(
            api_sports_team_id=17,
            name="Los Angeles Lakers",
            abbreviation="LAL",
            conference="Western",
            division="Pacific",
        )
        session.add_all([home, away])
        session.commit()

        session.add_all(
            [
                _make_game(
                    api_sports_game_id=5001,
                    home_team_id=home.id,
                    away_team_id=away.id,
                    date=datetime(2025, 11, 1, tzinfo=UTC),
                ),
                _make_game(
                    api_sports_game_id=5002,
                    home_team_id=away.id,
                    away_team_id=home.id,
                    date=datetime(2025, 11, 3, tzinfo=UTC),
                ),
            ]
        )
        session.commit()

    response = client.get("/events/games")

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 2


def test_list_games_orders_by_date_descending(client, session_factory):
    with session_factory() as session:
        home = _make_team()
        session.add(home)
        session.commit()

        session.add_all(
            [
                _make_game(
                    api_sports_game_id=1,
                    home_team_id=home.id,
                    away_team_id=home.id,
                    date=datetime(2025, 11, 1, tzinfo=UTC),
                ),
                _make_game(
                    api_sports_game_id=2,
                    home_team_id=home.id,
                    away_team_id=home.id,
                    date=datetime(2025, 11, 5, tzinfo=UTC),
                ),
                _make_game(
                    api_sports_game_id=3,
                    home_team_id=home.id,
                    away_team_id=home.id,
                    date=datetime(2025, 11, 3, tzinfo=UTC),
                ),
            ]
        )
        session.commit()

    response = client.get("/events/games")

    assert response.status_code == 200
    body = response.json()
    ids = [game["api_sports_game_id"] for game in body]
    assert ids == [2, 3, 1]


def test_list_games_filters_by_team_id_home_or_away(client, session_factory):
    with session_factory() as session:
        team_a = _make_team(api_sports_team_id=12, name="Boston Celtics", abbreviation="BOS")
        team_b = _make_team(
            api_sports_team_id=17,
            name="Los Angeles Lakers",
            abbreviation="LAL",
            conference="Western",
            division="Pacific",
        )
        team_c = _make_team(
            api_sports_team_id=20,
            name="Miami Heat",
            abbreviation="MIA",
            conference="Eastern",
            division="Southeast",
        )
        session.add_all([team_a, team_b, team_c])
        session.commit()

        session.add_all(
            [
                # team_a home
                _make_game(
                    api_sports_game_id=1,
                    home_team_id=team_a.id,
                    away_team_id=team_b.id,
                    date=datetime(2025, 11, 1, tzinfo=UTC),
                ),
                # team_a away
                _make_game(
                    api_sports_game_id=2,
                    home_team_id=team_b.id,
                    away_team_id=team_a.id,
                    date=datetime(2025, 11, 2, tzinfo=UTC),
                ),
                # no team_a involvement
                _make_game(
                    api_sports_game_id=3,
                    home_team_id=team_b.id,
                    away_team_id=team_c.id,
                    date=datetime(2025, 11, 3, tzinfo=UTC),
                ),
            ]
        )
        session.commit()
        team_a_id = team_a.id

    response = client.get("/events/games", params={"team_id": team_a_id})

    assert response.status_code == 200
    body = response.json()
    ids = {game["api_sports_game_id"] for game in body}
    assert ids == {1, 2}


def test_list_games_filters_by_season(client, session_factory):
    with session_factory() as session:
        home = _make_team()
        session.add(home)
        session.commit()

        session.add_all(
            [
                _make_game(
                    api_sports_game_id=1,
                    home_team_id=home.id,
                    away_team_id=home.id,
                    date=datetime(2025, 11, 1, tzinfo=UTC),
                    season="2025-26",
                ),
                _make_game(
                    api_sports_game_id=2,
                    home_team_id=home.id,
                    away_team_id=home.id,
                    date=datetime(2024, 11, 1, tzinfo=UTC),
                    season="2024-25",
                ),
            ]
        )
        session.commit()

    response = client.get("/events/games", params={"season": "2024-25"})

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["api_sports_game_id"] == 2


def test_get_game_by_id_returns_game_when_found(client, session_factory):
    with session_factory() as session:
        home = _make_team()
        session.add(home)
        session.commit()
        home_id = home.id

        game = _make_game(home_team_id=home_id, away_team_id=home_id)
        session.add(game)
        session.commit()
        game_id = game.id

    response = client.get(f"/events/games/{game_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == game_id
    assert body["player_stats"] == [
        {"player_name": "Jayson Tatum", "team_id": home_id, "points": 28}
    ]


def test_get_game_by_id_returns_404_when_not_found(client):
    response = client.get("/events/games/999999")

    assert response.status_code == 404
