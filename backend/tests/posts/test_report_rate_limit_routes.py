"""POSTS-010: the per-user report limit seen through
POST /posts/{post_id}/report. Written before the limiter is wired.

The route takes its limiter from app.posts.dependencies.get_report_rate_limiter;
these tests override it with app.posts.moderation.FakeRateLimiter, so "at the
limit" is a fixed verdict here -- the window boundaries are proved once
against real Postgres in tests/posts/test_report_rate_limiter.py. A refusal
answers 429 with a detail, writes no Report row, leaves Post.reported as it
was and publishes nothing. A repeat stays 204 and an unknown or deleted post
stays 404, even at the limit.

New names are reached as `dependencies.<Name>` / `moderation.<Name>` inside
fixtures and tests rather than imported at the top, so each test fails on
its own missing name instead of the whole module failing to collect.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_event_bus, get_session, get_settings
from app.eventbus import InMemoryEventPublisher, PostEventBus
from app.posts import dependencies, moderation
from app.posts.models import Post, Report
from app.posts.moderation import FakeRateLimiter
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
    _limit(app, allowed=True)
    return app


@pytest.fixture()
def client(app):
    return TestClient(app)


def _limit(app, *, allowed: bool) -> None:
    app.dependency_overrides[dependencies.get_report_rate_limiter] = lambda: FakeRateLimiter(
        allowed
    )


def _make_user(session, username: str) -> User:
    user = User(cognito_sub=f"sub-{username}", username=username, date_of_birth=date(1990, 1, 1))
    session.add(user)
    session.commit()
    return user


def _as_user(app, user: User) -> None:
    app.dependency_overrides[get_current_user] = lambda: user


@pytest.fixture()
def reporter(app, session_factory):
    with session_factory() as session:
        user = _make_user(session, "reporter")
    _as_user(app, user)
    return user


@pytest.fixture()
def post_id(session_factory):
    with session_factory() as session:
        author = _make_user(session, "author")
        post = Post(author_id=author.id, text="worth reporting")
        session.add(post)
        session.commit()
        return post.id


def _report_count(session_factory, reporter_id: int) -> int:
    with session_factory() as session:
        return session.scalar(
            select(func.count()).select_from(Report).where(Report.reporter_id == reporter_id)
        )


def _is_reported(session_factory, post_id: int) -> bool:
    with session_factory() as session:
        return session.get(Post, post_id).reported


# --- at the limit -----------------------------------------------------------


def test_report_at_the_limit_answers_429_with_a_detail(app, client, reporter, post_id):
    _limit(app, allowed=False)

    response = client.post(f"/posts/{post_id}/report")

    assert response.status_code == 429
    detail = response.json()["detail"]
    assert isinstance(detail, str) and detail


def test_report_at_the_limit_writes_nothing_and_publishes_nothing(
    app, client, session_factory, publisher, reporter, post_id
):
    _limit(app, allowed=False)

    client.post(f"/posts/{post_id}/report")

    assert _report_count(session_factory, reporter.id) == 0
    assert _is_reported(session_factory, post_id) is False
    assert publisher.published == []


def test_a_repeat_report_at_the_limit_still_answers_204_and_creates_nothing(
    app, client, session_factory, publisher, reporter, post_id
):
    assert client.post(f"/posts/{post_id}/report").status_code == 204
    _limit(app, allowed=False)

    response = client.post(f"/posts/{post_id}/report")

    assert response.status_code == 204
    assert _report_count(session_factory, reporter.id) == 1
    assert [e.name for e in publisher.published] == ["PostReported"]


def test_an_unknown_post_at_the_limit_answers_404(app, client, reporter):
    _limit(app, allowed=False)

    response = client.post("/posts/999999/report")

    assert response.status_code == 404


def test_a_deleted_post_at_the_limit_answers_404(app, client, session_factory, reporter, post_id):
    with session_factory() as session:
        session.get(Post, post_id).deleted_at = datetime.now(UTC)
        session.commit()
    _limit(app, allowed=False)

    response = client.post(f"/posts/{post_id}/report")

    assert response.status_code == 404


# --- below the limit --------------------------------------------------------


def test_report_below_the_limit_is_unchanged(
    client, session_factory, publisher, reporter, post_id
):
    response = client.post(f"/posts/{post_id}/report")

    assert response.status_code == 204
    assert _report_count(session_factory, reporter.id) == 1
    assert _is_reported(session_factory, post_id) is True
    assert [e.name for e in publisher.published] == ["PostReported"]


# --- the real wiring --------------------------------------------------------


def test_get_report_rate_limiter_wires_the_report_count_limiter_from_settings(
    app, client, session_factory, reporter, post_id
):
    """With the real provider (only get_settings overridden), a limit of one
    report a minute refuses the second report straight away."""
    del app.dependency_overrides[dependencies.get_report_rate_limiter]
    settings = Settings(
        database_url="postgresql+psycopg://u:p@host:5432/db",
        report_rate_limit_per_minute=1,
        report_rate_limit_per_hour=10,
    )
    app.dependency_overrides[get_settings] = lambda: settings
    with session_factory() as session:
        author = _make_user(session, "second_author")
        second = Post(author_id=author.id, text="also worth reporting")
        session.add(second)
        session.commit()
        second_id = second.id

    assert client.post(f"/posts/{post_id}/report").status_code == 204
    assert client.post(f"/posts/{second_id}/report").status_code == 429
    assert _report_count(session_factory, reporter.id) == 1


def test_get_report_rate_limiter_returns_a_report_count_rate_limiter(session_factory):
    settings = Settings(database_url="postgresql+psycopg://u:p@host:5432/db")
    with session_factory() as session:
        limiter = dependencies.get_report_rate_limiter(session=session, settings=settings)

    assert isinstance(limiter, moderation.ReportCountRateLimiter)


# --- OpenAPI ----------------------------------------------------------------


def test_the_report_route_declares_429_in_openapi():
    app = FastAPI()
    app.include_router(router)

    responses = app.openapi()["paths"]["/posts/{post_id}/report"]["post"]["responses"]

    assert "429" in responses
    assert responses["429"]["description"] != "Post rate limit exceeded"
