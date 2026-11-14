"""POSTS-002: the rate limit seen through POST /posts and
POST /posts/{post_id}/repost. Written before the real limiter is wired.

Unlike tests/posts/test_routes.py, this harness does NOT override
get_moderation_chain: the real chain is built by the real
get_moderation_chain, with get_settings overridden so each test picks its
own limits. A refusal by the rate limit answers 429 with a detail, persists
nothing and publishes no event; every other moderation refusal keeps
answering 400.

Posts the author already has are inserted directly (created_at defaults to
now()), so only the request under test goes through the route.
"""

from __future__ import annotations

from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_event_bus, get_session, get_settings
from app.eventbus import InMemoryEventPublisher, PostEventBus
from app.posts.models import Post
from app.posts.routes import router
from app.settings import Settings
from app.users.dependencies import get_current_user
from app.users.models import User


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def publisher():
    return InMemoryEventPublisher()


@pytest.fixture()
def app(session_factory, publisher):
    app = FastAPI()
    app.include_router(router)

    def _get_session_override():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = _get_session_override
    app.dependency_overrides[get_event_bus] = lambda: PostEventBus(publisher)
    _use_settings(app)
    return app


@pytest.fixture()
def client(app):
    return TestClient(app)


def _use_settings(app, **overrides) -> None:
    values = {"database_url": "postgresql+psycopg://u:p@host:5432/db", **overrides}
    settings = Settings(**values)
    app.dependency_overrides[get_settings] = lambda: settings


def _make_user(session, username: str) -> User:
    user = User(cognito_sub=f"sub-{username}", username=username, date_of_birth=date(1990, 1, 1))
    session.add(user)
    session.commit()
    return user


def _place_posts(session, author_id: int, count: int, age_seconds: int = 5) -> None:
    session.execute(
        text(
            "INSERT INTO posts (author_id, text, created_at) "
            "SELECT :author_id, 'earlier post ' || g, now() - make_interval(secs => :age) "
            "FROM generate_series(1, :count) AS g"
        ),
        {"author_id": author_id, "age": age_seconds, "count": count},
    )
    session.commit()


def _post_count(session_factory, author_id: int) -> int:
    with session_factory() as session:
        return session.scalar(
            select(func.count()).select_from(Post).where(Post.author_id == author_id)
        )


def _as_user(app, user: User) -> None:
    app.dependency_overrides[get_current_user] = lambda: user


@pytest.fixture()
def author_at_the_minute_limit(app, session_factory):
    """An author with 10 posts in the last minute -- the default limit."""
    with session_factory() as session:
        author = _make_user(session, "busy_author")
        _place_posts(session, author.id, 10)
    _as_user(app, author)
    return author


@pytest.fixture()
def someone_elses_post(session_factory):
    with session_factory() as session:
        other = _make_user(session, "other_author")
        post = Post(author_id=other.id, text="something worth reposting")
        session.add(post)
        session.commit()
        return post.id


# --- POST /posts ------------------------------------------------------------


def test_create_post_over_the_limit_answers_429_with_a_detail(client, author_at_the_minute_limit):
    response = client.post("/posts", json={"text": "one too many"})

    assert response.status_code == 429
    detail = response.json()["detail"]
    assert isinstance(detail, str) and detail


def test_create_post_over_the_limit_persists_nothing_and_publishes_nothing(
    client, session_factory, publisher, author_at_the_minute_limit
):
    client.post("/posts", json={"text": "one too many"})

    assert _post_count(session_factory, author_at_the_minute_limit.id) == 10
    assert publisher.published == []


def test_create_post_under_the_limit_is_created(app, client, session_factory):
    with session_factory() as session:
        author = _make_user(session, "calm_author")
        _place_posts(session, author.id, 9)
    _as_user(app, author)

    response = client.post("/posts", json={"text": "number ten"})

    assert response.status_code == 201


def test_create_reply_over_the_limit_answers_429(
    client, author_at_the_minute_limit, someone_elses_post
):
    response = client.post(
        "/posts",
        json={"text": "a reply", "is_reply": True, "parent_post_id": someone_elses_post},
    )

    assert response.status_code == 429


def test_create_quote_repost_over_the_limit_answers_429(
    client, author_at_the_minute_limit, someone_elses_post
):
    response = client.post(
        "/posts",
        json={"text": "a quote", "is_repost": True, "original_post_id": someone_elses_post},
    )

    assert response.status_code == 429


def test_other_moderation_refusals_still_answer_400(app, client, session_factory):
    with session_factory() as session:
        author = _make_user(session, "rude_author")
    _as_user(app, author)
    _use_settings(app, moderation_banned_words="badword")

    response = client.post("/posts", json={"text": "this has a badword in it"})

    assert response.status_code == 400


# --- POST /posts/{post_id}/repost -------------------------------------------


def test_repost_over_the_limit_answers_429_with_a_detail(
    client, author_at_the_minute_limit, someone_elses_post
):
    response = client.post(f"/posts/{someone_elses_post}/repost")

    assert response.status_code == 429
    detail = response.json()["detail"]
    assert isinstance(detail, str) and detail


def test_repost_over_the_limit_persists_nothing_and_publishes_nothing(
    client, session_factory, publisher, author_at_the_minute_limit, someone_elses_post
):
    client.post(f"/posts/{someone_elses_post}/repost")

    assert _post_count(session_factory, author_at_the_minute_limit.id) == 10
    assert publisher.published == []


def test_reposts_made_through_the_repost_route_count_against_the_limit(
    app, client, session_factory
):
    _use_settings(app, post_rate_limit_per_minute=2, post_rate_limit_per_hour=1000)
    with session_factory() as session:
        author = _make_user(session, "reposter")
        other = _make_user(session, "reposted")
        originals = [Post(author_id=other.id, text=f"original {n}") for n in range(3)]
        session.add_all(originals)
        session.commit()
        original_ids = [p.id for p in originals]
    _as_user(app, author)

    assert client.post(f"/posts/{original_ids[0]}/repost").status_code == 201
    assert client.post(f"/posts/{original_ids[1]}/repost").status_code == 201

    assert client.post(f"/posts/{original_ids[2]}/repost").status_code == 429
    assert client.post("/posts", json={"text": "and an original"}).status_code == 429
