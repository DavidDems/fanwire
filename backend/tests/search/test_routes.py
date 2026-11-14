"""Tests for search/ HTTP routes, per AGENTS.md TDD workflow. Written
before app/search/routes.py exists.

Router isn't wired into app.main in this test -- a throwaway local
FastAPI() app includes just the search router, same pattern as
backend/tests/feed/test_routes.py. Overrides get_session/
get_optional_current_user. Since EVENTS-003 no search route depends on a
live-score proxy, and a post item carries no `live_scores` field.

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

import itertools
from datetime import UTC, date, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_session
from app.events.models import Game, Player, PlayerGameStats, Team
from app.posts.models import EventMention, Post
from app.search.routes import router
from app.users.dependencies import get_optional_current_user
from app.users.models import User

_person_ids = itertools.count(1)

_ZERO_STATS = dict.fromkeys(
    (
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
        "plus_minus",
    ),
    0,
)


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
        "nba_team_id": 1,
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


def _make_game(session, home, away, starting_positions=(), **overrides) -> Game:
    """`starting_positions`: one box-score row per entry, for a new player on
    the home team; None is a bench row (no starting position)."""
    defaults = {
        "nba_game_id": 1,
        "home_team_id": home.id,
        "away_team_id": away.id,
        "date": datetime(2026, 1, 1, tzinfo=UTC),
        "season": "2025-26",
        "home_score": 100,
        "away_score": 98,
    }
    defaults.update(overrides)
    game = Game(**defaults)
    session.add(game)
    session.flush()
    for position in starting_positions:
        player = Player(nba_person_id=next(_person_ids), last_name="Player")
        session.add(player)
        session.flush()
        session.add(
            PlayerGameStats(
                game_id=game.id,
                player_id=player.id,
                team_id=home.id,
                starter=position is not None,
                starting_position=position,
                seconds_played=600,
                **_ZERO_STATS,
            )
        )
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


def test_search_posts_items_carry_no_live_scores(client, session_factory):
    with session_factory() as session:
        author = _make_user(session, cognito_sub="sub-live-author", username="live_author")
        home = _make_team(session, nba_team_id=61)
        away = _make_team(session, nba_team_id=62)
        game = _make_game(session, home, away, nba_game_id=61, date=datetime.now(UTC))
        post = _make_post(session, author, text="courtside tonight")
        session.add(EventMention(post_id=post.id, game_id=game.id, raw_token="#GameId"))
        session.commit()

    response = client.get("/search/posts", params={"q": "courtside"})

    assert response.status_code == 200
    [item] = response.json()["items"]
    assert "live_scores" not in item
    assert item["mentioned_game_ids"] == [game.id]


def _dependency_names(dependant) -> set[str]:
    names = set()
    for sub in dependant.dependencies:
        if sub.call is not None:
            names.add(getattr(sub.call, "__name__", repr(sub.call)))
        names |= _dependency_names(sub)
    return names


def test_no_search_route_depends_on_a_live_score_proxy():
    for route in router.routes:
        names = _dependency_names(route.dependant)
        assert not any("live_score" in name for name in names), (route.path, names)


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
        a = _make_team(session, nba_team_id=1)
        b = _make_team(session, nba_team_id=2)
        target = _make_game(session, a, b, nba_game_id=1, season="2025-26")
        _make_game(session, a, b, nba_game_id=2, season="2024-25")

    response = client.get("/search/games", params={"season": "2025-26"})

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [target.id]


def test_search_games_filters_by_team_alone(client, session_factory):
    with session_factory() as session:
        a = _make_team(session, nba_team_id=11)
        b = _make_team(session, nba_team_id=12)
        c = _make_team(session, nba_team_id=13)
        home_game = _make_game(session, a, b, nba_game_id=11)
        away_game = _make_game(session, b, a, nba_game_id=12)
        _make_game(session, b, c, nba_game_id=13)
        team_a_id = a.id

    response = client.get("/search/games", params={"team_id": team_a_id})

    assert response.status_code == 200
    assert {item["id"] for item in response.json()["items"]} == {home_game.id, away_game.id}


def test_search_games_filters_by_position_alone(client, session_factory):
    with session_factory() as session:
        a = _make_team(session, nba_team_id=21)
        b = _make_team(session, nba_team_id=22)
        target = _make_game(
            session,
            a,
            b,
            nba_game_id=21,
            starting_positions=["SF"],
        )
        _make_game(
            session,
            a,
            b,
            nba_game_id=22,
            starting_positions=["PG"],
        )

    response = client.get("/search/games", params={"position": "SF"})

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [target.id]


def test_search_games_filters_combined(client, session_factory):
    with session_factory() as session:
        a = _make_team(session, nba_team_id=31)
        b = _make_team(session, nba_team_id=32)
        target = _make_game(
            session,
            a,
            b,
            nba_game_id=31,
            season="2025-26",
            starting_positions=["C"],
        )
        _make_game(
            session,
            a,
            b,
            nba_game_id=32,
            season="2024-25",
            starting_positions=["C"],
        )
        team_a_id = a.id

    response = client.get(
        "/search/games", params={"season": "2025-26", "team_id": team_a_id, "position": "C"}
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [target.id]


def test_search_games_items_carry_no_player_stats(client, session_factory):
    with session_factory() as session:
        a = _make_team(session, nba_team_id=51)
        b = _make_team(session, nba_team_id=52)
        _make_game(session, a, b, nba_game_id=51, starting_positions=["G"])

    response = client.get("/search/games")

    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    assert "player_stats" not in items[0]


def test_search_games_unknown_position_returns_422(client):
    response = client.get("/search/games", params={"position": "QB"})

    assert response.status_code == 422


def test_search_games_filters_endpoint(client, session_factory):
    with session_factory() as session:
        a = _make_team(session, nba_team_id=41)
        b = _make_team(session, nba_team_id=42)
        _make_game(session, a, b, nba_game_id=41, season="2025-26")
        _make_game(session, a, b, nba_game_id=42, season="2024-25")

    response = client.get("/search/games/filters")

    assert response.status_code == 200
    body = response.json()
    assert set(body["seasons"]) == {"2025-26", "2024-25"}
    assert set(body["positions"]) == {"PG", "SG", "SF", "PF", "C", "G", "F"}
