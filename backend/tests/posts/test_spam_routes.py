"""POSTS-003: the heuristic spam scorer seen through POST /posts and
POST /posts/{post_id}/repost. Written before the real scorer is wired.

Same harness as tests/posts/test_rate_limit_routes.py: get_moderation_chain
is NOT overridden, so the real chain is built by the real
get_moderation_chain, with get_settings overridden so each test can pick
its own settings. A post the spam scorer refuses answers 400 with the
existing spam detail, persists nothing and publishes no event.

Users are created with created_at = now(), so every test user is a new
account (younger than the default 24 hours) unless _backdate moves its
creation back. POST /posts/{post_id}/repost publishes a plain repost, which
has no text of its own, so the scorer never refuses it; a quote repost
(text of its own) goes through POST /posts and is scored like any post.
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

# The reason app.posts.moderation.SpamScoreCheck raises, which the routes
# pass through as the 400's detail.
SPAM_DETAIL = "spam score at or above threshold"

ONE_LINK = "watch this https://example.com/clip"
THREE_LINKS = "https://a.example/1 https://b.example/2 www.c.example/3"


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


def _backdate(session, user: User, hours: int) -> None:
    session.execute(
        text("UPDATE users SET created_at = now() - make_interval(hours => :hours) WHERE id = :id"),
        {"hours": hours, "id": user.id},
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
def new_author(app, session_factory):
    """An account created just now -- a new account to the scorer."""
    with session_factory() as session:
        author = _make_user(session, "new_author")
    _as_user(app, author)
    return author


@pytest.fixture()
def established_author(app, session_factory):
    """An account created two days ago."""
    with session_factory() as session:
        author = _make_user(session, "established_author")
        _backdate(session, author, hours=48)
    _as_user(app, author)
    return author


@pytest.fixture()
def linky_post(session_factory):
    """Someone else's post, itself full of links."""
    with session_factory() as session:
        other = _make_user(session, "linky_author")
        _backdate(session, other, hours=48)
        post = Post(author_id=other.id, text=THREE_LINKS)
        session.add(post)
        session.commit()
        return post.id


# --- POST /posts ------------------------------------------------------------


def test_a_new_account_posting_a_link_answers_400_with_the_spam_detail(client, new_author):
    response = client.post("/posts", json={"text": ONE_LINK})

    assert response.status_code == 400
    assert response.json()["detail"] == SPAM_DETAIL


def test_a_refused_post_persists_nothing_and_publishes_nothing(
    client, session_factory, publisher, new_author
):
    client.post("/posts", json={"text": ONE_LINK})

    assert _post_count(session_factory, new_author.id) == 0
    assert publisher.published == []


def test_three_links_from_an_established_account_answer_400(
    client, session_factory, publisher, established_author
):
    response = client.post("/posts", json={"text": THREE_LINKS})

    assert response.status_code == 400
    assert response.json()["detail"] == SPAM_DETAIL
    assert _post_count(session_factory, established_author.id) == 0
    assert publisher.published == []


def test_an_established_accounts_single_link_is_created(
    client, session_factory, established_author
):
    response = client.post("/posts", json={"text": ONE_LINK})

    assert response.status_code == 201
    assert _post_count(session_factory, established_author.id) == 1


def test_a_new_accounts_post_without_a_link_is_created(client, new_author):
    response = client.post("/posts", json={"text": "LETS GO" + "O" * 30})

    assert response.status_code == 201


def test_a_new_accounts_reply_with_a_link_answers_400(
    client, session_factory, publisher, new_author, linky_post
):
    response = client.post(
        "/posts",
        json={"text": ONE_LINK, "is_reply": True, "parent_post_id": linky_post},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == SPAM_DETAIL
    assert _post_count(session_factory, new_author.id) == 0
    assert publisher.published == []


def test_a_new_accounts_quote_repost_with_a_link_answers_400(
    client, session_factory, publisher, new_author, linky_post
):
    response = client.post(
        "/posts",
        json={"text": ONE_LINK, "is_repost": True, "original_post_id": linky_post},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == SPAM_DETAIL
    assert _post_count(session_factory, new_author.id) == 0
    assert publisher.published == []


def test_the_threshold_comes_from_settings(app, client, established_author):
    _use_settings(app, spam_score_threshold=0.3)

    response = client.post("/posts", json={"text": ONE_LINK})

    assert response.status_code == 400
    assert response.json()["detail"] == SPAM_DETAIL


# --- POST /posts/{post_id}/repost -------------------------------------------


def test_a_new_accounts_plain_repost_is_never_refused_by_the_scorer(
    app, client, session_factory, publisher, new_author, linky_post
):
    # The lowest threshold a Settings accepts: a plain repost has no text, so
    # it scores 0.0 and still passes.
    _use_settings(app, spam_score_threshold=0.01)

    response = client.post(f"/posts/{linky_post}/repost")

    assert response.status_code == 201
    assert _post_count(session_factory, new_author.id) == 1
    assert publisher.published != []
