"""Tests for feed/ HTTP routes, per AGENTS.md TDD workflow. Written before
app/feed/routes.py exists.

Router isn't wired into app.main in this test -- a throwaway local
FastAPI() app includes just the feed router, same pattern as
backend/tests/posts/test_routes.py. Overrides get_session/
get_optional_current_user/get_live_score_proxy.

GET /feed uses get_optional_current_user: no token -> guest feed, a valid
token -> the personalized feed, an invalid token -> 401 (inherited,
exercised via the real get_token_verifier chain rather than overriding
get_optional_current_user directly, same as
backend/tests/users/test_dependencies.py's get_optional_current_user
tests).

GET /feed/thread/{post_id} -> ThreadView{root, replies}, 404 if the post
doesn't exist.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from testcontainers.postgres import PostgresContainer

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_session
from app.events.dependencies import get_live_score_proxy
from app.events.interfaces import NormalizedLiveScore, SportsDataSource
from app.events.models import Game, Team
from app.events.proxy import CachedEventProxy, InMemoryLiveScoreCache
from app.feed.routes import router
from app.posts.models import Post
from app.users.auth import FakeTokenVerifier
from app.users.dependencies import get_optional_current_user, get_token_verifier
from app.users.models import Follow, User


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


def _as_viewer(app, user: User) -> None:
    app.dependency_overrides[get_optional_current_user] = lambda: user


def _make_user(session, **overrides) -> User:
    defaults = {
        "cognito_sub": f"sub-{overrides.get('username', 'u')}",
        "username": "route_user",
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


class _FixedScoreSource(SportsDataSource):
    def __init__(self, score: NormalizedLiveScore | None) -> None:
        self._score = score

    def fetch_teams(self):
        return []

    def fetch_games(self, *, since=None):
        return []

    def fetch_live_score(self, api_sports_game_id: int):
        return self._score


# --- GET /feed --------------------------------------------------------


def test_get_feed_guest_returns_recent_posts_newest_first(client, session_factory):
    with session_factory() as session:
        author = _make_user(session, username="guest_feed_author")
        first = _make_post(session, author, text="first")
        second = _make_post(session, author, text="second")

    response = client.get("/feed")

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body["items"]] == [second.id, first.id]
    assert body["next_before_id"] is None


def test_get_feed_authenticated_returns_personalized_feed(app, client, session_factory):
    with session_factory() as session:
        viewer = _make_user(session, username="auth_feed_viewer")
        followed = _make_user(session, username="auth_feed_followed")
        stranger = _make_user(session, username="auth_feed_stranger")
        session.add(Follow(follower_user_id=viewer.id, followed_user_id=followed.id))
        session.commit()

        own_post = _make_post(session, viewer, text="own")
        followed_post = _make_post(session, followed, text="followed")
        _make_post(session, stranger, text="stranger")
    _as_viewer(app, viewer)

    response = client.get("/feed")

    assert response.status_code == 200
    ids = {item["id"] for item in response.json()["items"]}
    assert ids == {own_post.id, followed_post.id}


def test_get_feed_default_limit_is_20_and_sets_next_before_id_on_full_page(client, session_factory):
    with session_factory() as session:
        author = _make_user(session, username="page_author")
        posts = [_make_post(session, author, text=f"post {i}") for i in range(25)]

    response = client.get("/feed")

    assert response.status_code == 200
    body = response.json()
    assert len(body["items"]) == 20
    assert body["next_before_id"] == posts[5].id  # 25 posts, newest 20 shown, oldest of those


def test_get_feed_next_before_id_is_null_on_a_partial_page(client, session_factory):
    with session_factory() as session:
        author = _make_user(session, username="partial_author")
        _make_post(session, author, text="only post")

    response = client.get("/feed")

    assert response.status_code == 200
    assert response.json()["next_before_id"] is None


def test_get_feed_paginates_with_before_id(client, session_factory):
    with session_factory() as session:
        author = _make_user(session, username="cursor_author")
        first = _make_post(session, author, text="first")
        second = _make_post(session, author, text="second")
        third = _make_post(session, author, text="third")

    page1 = client.get("/feed", params={"limit": 2})
    assert [item["id"] for item in page1.json()["items"]] == [third.id, second.id]
    next_before_id = page1.json()["next_before_id"]
    assert next_before_id == second.id

    page2 = client.get("/feed", params={"limit": 2, "before_id": next_before_id})
    assert [item["id"] for item in page2.json()["items"]] == [first.id]
    assert page2.json()["next_before_id"] is None


def test_get_feed_limit_over_max_returns_422(client):
    response = client.get("/feed", params={"limit": 51})

    assert response.status_code == 422


def test_get_feed_invalid_token_returns_401(app, client, session_factory):
    # Exercise the real get_optional_current_user chain (not overridden)
    # for this one case -- the fixture above overrides it directly for
    # every other test.
    del app.dependency_overrides[get_optional_current_user]
    app.dependency_overrides[get_token_verifier] = lambda: FakeTokenVerifier(None)

    response = client.get("/feed", headers={"Authorization": "Bearer bad-token"})

    assert response.status_code == 401


def test_get_feed_includes_live_scores_from_the_injected_proxy(app, client, session_factory):
    with session_factory() as session:
        author = _make_user(session, username="live_feed_author")
        home = Team(
            api_sports_team_id=901,
            name="Home",
            abbreviation="HOM",
            conference="Eastern",
            division="Atlantic",
        )
        away = Team(
            api_sports_team_id=902,
            name="Away",
            abbreviation="AWY",
            conference="Western",
            division="Pacific",
        )
        session.add_all([home, away])
        session.commit()
        game = Game(
            api_sports_game_id=7777,
            home_team_id=home.id,
            away_team_id=away.id,
            date=datetime.now(UTC),
            season="2025-26",
            home_score=0,
            away_score=0,
        )
        session.add(game)
        session.commit()

        from app.posts.models import EventMention

        post = _make_post(session, author, text="live game post")
        session.add(EventMention(post_id=post.id, game_id=game.id, raw_token="#GameId"))
        session.commit()

    score = NormalizedLiveScore(
        api_sports_game_id=7777, home_score=12, away_score=10, status="in_progress"
    )
    proxy = CachedEventProxy(_FixedScoreSource(score), InMemoryLiveScoreCache())
    app.dependency_overrides[get_live_score_proxy] = lambda: proxy

    response = client.get("/feed")

    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["live_scores"] == [
        {"game_id": game.id, "home_score": 12, "away_score": 10, "status": "in_progress"}
    ]


# --- GET /feed/thread/{post_id} -----------------------------------------


def test_get_thread_returns_root_and_direct_replies(client, session_factory):
    with session_factory() as session:
        author = _make_user(session, username="thread_author")
        root = _make_post(session, author, text="root post")
        base = datetime(2026, 1, 1, tzinfo=UTC)
        older = Post(
            author_id=author.id,
            text="older reply",
            is_reply=True,
            parent_post_id=root.id,
            created_at=base,
        )
        newer = Post(
            author_id=author.id,
            text="newer reply",
            is_reply=True,
            parent_post_id=root.id,
            created_at=base.replace(minute=5),
        )
        session.add_all([older, newer])
        session.commit()
        root_id = root.id

    response = client.get(f"/feed/thread/{root_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["root"]["id"] == root_id
    assert [r["text"] for r in body["replies"]] == ["older reply", "newer reply"]


def test_get_thread_returns_404_for_nonexistent_post(client):
    response = client.get("/feed/thread/999999")

    assert response.status_code == 404


def test_get_thread_replies_is_empty_list_when_no_replies(client, session_factory):
    with session_factory() as session:
        author = _make_user(session, username="lonely_thread_author")
        root = _make_post(session, author, text="lonely root")
        root_id = root.id

    response = client.get(f"/feed/thread/{root_id}")

    assert response.status_code == 200
    assert response.json()["replies"] == []
