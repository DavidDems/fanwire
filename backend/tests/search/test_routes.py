"""Tests for search/ HTTP routes, per AGENTS.md TDD workflow. Written
before app/search/routes.py exists.

Router isn't wired into app.main in this test -- a throwaway local
FastAPI() app includes just the search router, same pattern as
backend/tests/feed/test_routes.py. Overrides get_session/
get_optional_current_user/get_live_score_proxy.

Covers wiki/CodeContext/Modules/0x07-search.md's contract:
- GET /search/accounts and GET /search/posts are two independently
  paginated sections (the accounts-first business rule is a frontend
  ordering concern -- the backend just exposes two separate, independently
  paginated endpoints, per this unit's task brief).
- GET /search/games (season/team_id/position, all optional and AND'd;
  unknown position -> 422) and GET /search/games/filters.
- Injection safety: dangerous characters in `q` never 500.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from app.search.routes import router
from fastapi import FastAPI
from fastapi.testclient import TestClient
from testcontainers.postgres import PostgresContainer

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_session
from app.events.dependencies import get_live_score_proxy
from app.events.models import Game, Team
from app.posts.models import Post
from app.users.dependencies import get_optional_current_user
from app.users.models import User


@pytest.fixture(scope="module")
def postgres_url():
    with PostgresContainer("postgres:16-alpine") as pg:
        yield pg.get_connection_url().replace("psycopg2", "psycopg")


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def app(session_factory):
    app = FastAPI()
    app.include_router(router)

    def _get_session_override():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = _get_session_override
    app.dependency_overrides[get_optional_current_user] = lambda: None
    app.dependency_overrides[get_live_score_proxy] = lambda: None
    return app


@pytest.fixture()
def client(app):
    return TestClient(app)


def _make_user(session, **overrides) -> User:
    defaults = {
        "cognito_sub": f"sub-{overrides.get('username', 'u')}",
        "username": "route_search_user",
        "date_of_birth": date(1990, 1, 1),
    }
    defaults.update(overrides)
    user = User(**defaults)
    session.add(user)
    session.commit()
    return user


def _make_post(session, author, **overrides) -> Post:
    defaults = {"author_id": author.id, "text": "a post"}
    defaults.update(overrides)
    post = Post(**defaults)
    session.add(post)
    session.commit()
    return post


def _make_team(session, **overrides) -> Team:
    defaults = {
        "api_sports_team_id": 1,
        "name": "Team",
        "abbreviation": "TM",
        "conference": "Eastern",
        "division": "Atlantic",
    }
    defaults.update(overrides)
    team = Team(**defaults)
    session.add(team)
    session.commit()
    return team


def _make_game(session, home, away, **overrides) -> Game:
    defaults = {
        "api_sports_game_id": 1,
        "home_team_id": home.id,
        "away_team_id": away.id,
        "date": datetime(2026, 1, 1, tzinfo=UTC),
        "season": "2025-26",
        "home_score": 100,
        "away_score": 98,
        "player_stats": [],
    }
    defaults.update(overrides)
    game = Game(**defaults)
    session.add(game)
    session.commit()
    return game


# --- GET /search/accounts ------------------------------------------------


def test_search_accounts_returns_matching_users(client, session_factory):
    with session_factory() as session:
        david = _make_user(session, cognito_sub="sub-david", username="david")
        _make_user(session, cognito_sub="sub-other", username="unrelated")

    response = client.get("/search/accounts", params={"q": "dav"})

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body["items"]] == [david.id]
    assert body["items"][0]["username"] == "david"
    assert "date_of_birth" not in body["items"][0]


def test_search_accounts_paginates_independently_of_offset(client, session_factory):
    with session_factory() as session:
        users = [
            _make_user(session, cognito_sub=f"sub-p{i}", username=f"pageacct{i}") for i in range(3)
        ]

    page1 = client.get("/search/accounts", params={"q": "pageacct", "limit": 2, "offset": 0})
    page2 = client.get("/search/accounts", params={"q": "pageacct", "limit": 2, "offset": 2})

    assert page1.status_code == 200
    assert len(page1.json()["items"]) == 2
    assert page1.json()["next_offset"] == 2

    assert page2.status_code == 200
    assert len(page2.json()["items"]) == 1
    assert page2.json()["next_offset"] is None
    assert len(users) == 3


@pytest.mark.parametrize(
    "dangerous_query", ["'", ";", "--", ":*", "&|!()", "%", "a'; DROP TABLE users; --"]
)
def test_search_accounts_is_injection_safe(client, dangerous_query):
    response = client.get("/search/accounts", params={"q": dangerous_query})

    assert response.status_code == 200
    assert response.json()["items"] == []


# --- GET /search/posts ----------------------------------------------------


def test_search_posts_returns_matching_posts(client, session_factory):
    with session_factory() as session:
        author = _make_user(session, cognito_sub="sub-post-author", username="post_author")
        match = _make_post(session, author, text="a great basketball game")
        _make_post(session, author, text="unrelated")

    response = client.get("/search/posts", params={"q": "basketball"})

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body["items"]] == [match.id]


def test_search_posts_and_accounts_are_independently_paginated(client, session_factory):
    with session_factory() as session:
        author = _make_user(session, cognito_sub="sub-shared", username="shared_hooper")
        posts = [_make_post(session, author, text=f"hooper post {i}") for i in range(3)]

    # Paging through /search/posts should not be affected by, or affect,
    # /search/accounts' own offset -- two separate sections.
    accounts_page = client.get("/search/accounts", params={"q": "hooper", "offset": 0})
    posts_page1 = client.get("/search/posts", params={"q": "hooper", "limit": 2, "offset": 0})
    posts_page2 = client.get("/search/posts", params={"q": "hooper", "limit": 2, "offset": 2})

    assert accounts_page.status_code == 200
    assert [item["username"] for item in accounts_page.json()["items"]] == ["shared_hooper"]

    assert len(posts_page1.json()["items"]) == 2
    assert posts_page1.json()["next_offset"] == 2
    assert len(posts_page2.json()["items"]) == 1
    assert posts_page2.json()["next_offset"] is None
    assert len(posts) == 3


@pytest.mark.parametrize(
    "dangerous_query", ["'", ";", "--", ":*", "&|!()", "%", "a'; DROP TABLE posts; --"]
)
def test_search_posts_is_injection_safe(client, dangerous_query):
    response = client.get("/search/posts", params={"q": dangerous_query})

    assert response.status_code == 200
    assert response.json()["items"] == []


# --- GET /search/games -----------------------------------------------------


def test_search_games_filters_by_season_alone(client, session_factory):
    with session_factory() as session:
        a = _make_team(session, api_sports_team_id=1)
        b = _make_team(session, api_sports_team_id=2)
        target = _make_game(session, a, b, api_sports_game_id=1, season="2025-26")
        _make_game(session, a, b, api_sports_game_id=2, season="2024-25")

    response = client.get("/search/games", params={"season": "2025-26"})

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [target.id]


def test_search_games_filters_by_team_alone(client, session_factory):
    with session_factory() as session:
        a = _make_team(session, api_sports_team_id=11)
        b = _make_team(session, api_sports_team_id=12)
        c = _make_team(session, api_sports_team_id=13)
        home_game = _make_game(session, a, b, api_sports_game_id=11)
        away_game = _make_game(session, b, a, api_sports_game_id=12)
        _make_game(session, b, c, api_sports_game_id=13)
        team_a_id = a.id

    response = client.get("/search/games", params={"team_id": team_a_id})

    assert response.status_code == 200
    assert {item["id"] for item in response.json()["items"]} == {home_game.id, away_game.id}


def test_search_games_filters_by_position_alone(client, session_factory):
    with session_factory() as session:
        a = _make_team(session, api_sports_team_id=21)
        b = _make_team(session, api_sports_team_id=22)
        target = _make_game(
            session,
            a,
            b,
            api_sports_game_id=21,
            player_stats=[{"player_name": "X", "team_id": a.id, "position": "SF"}],
        )
        _make_game(
            session,
            a,
            b,
            api_sports_game_id=22,
            player_stats=[{"player_name": "Y", "team_id": a.id, "position": "PG"}],
        )

    response = client.get("/search/games", params={"position": "SF"})

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [target.id]


def test_search_games_filters_combined(client, session_factory):
    with session_factory() as session:
        a = _make_team(session, api_sports_team_id=31)
        b = _make_team(session, api_sports_team_id=32)
        target = _make_game(
            session,
            a,
            b,
            api_sports_game_id=31,
            season="2025-26",
            player_stats=[{"player_name": "X", "team_id": a.id, "position": "C"}],
        )
        _make_game(
            session,
            a,
            b,
            api_sports_game_id=32,
            season="2024-25",
            player_stats=[{"player_name": "X", "team_id": a.id, "position": "C"}],
        )
        team_a_id = a.id

    response = client.get(
        "/search/games", params={"season": "2025-26", "team_id": team_a_id, "position": "C"}
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [target.id]


def test_search_games_unknown_position_returns_422(client):
    response = client.get("/search/games", params={"position": "QB"})

    assert response.status_code == 422


def test_search_games_filters_endpoint(client, session_factory):
    with session_factory() as session:
        a = _make_team(session, api_sports_team_id=41)
        b = _make_team(session, api_sports_team_id=42)
        _make_game(session, a, b, api_sports_game_id=41, season="2025-26")
        _make_game(session, a, b, api_sports_game_id=42, season="2024-25")

    response = client.get("/search/games/filters")

    assert response.status_code == 200
    body = response.json()
    assert set(body["seasons"]) == {"2025-26", "2024-25"}
    assert set(body["positions"]) == {"PG", "SG", "SF", "PF", "C", "G", "F"}
