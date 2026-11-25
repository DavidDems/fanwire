"""The username rule for new accounts (USERS-010, ADR 0035).

A new username is 1 to 30 ASCII letters, digits, underscores and dots,
starting with a letter, digit or underscore, with no two dots in a row and
no trailing dot: `^(?!.*\\.\\.)(?!.*\\.$)\\w[\\w.]{0,29}$`, ASCII-only, matched
against the whole string. `POST /users` (`CreateUserRequest`) is the only
write that sets a username, so it is the only place the rule is enforced.

Names that already exist and break the rule are grandfathered: every read
and every other write still accepts them, and nobody is renamed. The last
section of this file inserts such a row directly, as an old row would be,
and reads it back through the routes.

Written before the rule exists: today `CreateUserRequest.username` is a bare
`str`, so the rejection tests fail. The grandfathering tests pass today and
must keep passing once the rule lands.

Same throwaway-app pattern as tests/users/test_age_gate.py.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import func, select

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_event_bus, get_session
from app.eventbus import InMemoryEventPublisher, PostEventBus
from app.feed.routes import router as feed_router
from app.posts.models import Post
from app.search.routes import router as search_router
from app.users.auth import VerifiedIdentity
from app.users.dependencies import (
    get_current_identity,
    get_current_user,
    get_optional_current_user,
)
from app.users.models import Follow, User
from app.users.routes import router as users_router
from app.users.schemas import CreateUserRequest

USERNAME_MSG = (
    "Use 1 to 30 letters, numbers, underscores or dots, "
    "with no two dots in a row and no dot at the end."
)

ACCEPTED = [
    "a",
    "_",
    "9",
    "raptors_fan",
    "Raptors.Fan",
    "a.b.c",
    "a" * 30,
    "1a",
    "_a",
]

REJECTED = [
    pytest.param("", id="empty"),
    pytest.param("a" * 31, id="31-chars"),
    pytest.param(".a", id="leading-dot"),
    pytest.param("a.", id="trailing-dot"),
    pytest.param("a..b", id="two-dots"),
    pytest.param("a-b", id="hyphen"),
    pytest.param("a b", id="space"),
    pytest.param("a@b", id="at-sign"),
    pytest.param("élise", id="non-ascii-e-acute"),
    pytest.param("ıllini", id="non-ascii-dotless-i"),
    pytest.param("ａbc", id="full-width-letter"),
    pytest.param("abc\n", id="trailing-newline"),
    pytest.param("abc\ndef", id="embedded-newline"),
    pytest.param(" abc", id="leading-space"),
    pytest.param("abc ", id="trailing-space"),
]

_DOB = "1990-01-01"


def _request(username: str) -> CreateUserRequest:
    return CreateUserRequest.model_validate({"username": username, "date_of_birth": _DOB})


# --- CreateUserRequest: the rule itself (no database) ---------------------


@pytest.mark.parametrize("username", ACCEPTED)
def test_schema_accepts_username_unchanged(username):
    assert _request(username).username == username


@pytest.mark.parametrize("username", REJECTED)
def test_schema_rejects_username_with_the_one_clear_error(username):
    with pytest.raises(ValidationError) as excinfo:
        _request(username)

    errors = excinfo.value.errors()
    assert len(errors) == 1
    error = errors[0]
    assert error["loc"] == ("username",)
    assert error["type"] == "username_format"
    assert error["msg"] == USERNAME_MSG


# --- fixtures for the database-backed tests -------------------------------


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
    app.include_router(users_router)
    app.include_router(search_router)
    app.include_router(feed_router)

    def _get_session_override():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = _get_session_override
    app.dependency_overrides[get_event_bus] = lambda: PostEventBus(InMemoryEventPublisher())
    app.dependency_overrides[get_optional_current_user] = lambda: None
    return app


@pytest.fixture()
def client(app):
    return TestClient(app)


def _as_identity(app, sub: str) -> None:
    app.dependency_overrides[get_current_identity] = lambda: VerifiedIdentity(
        sub=sub, auth_time=int(datetime.now(UTC).timestamp())
    )


def _as_user(app, user: User) -> None:
    app.dependency_overrides[get_current_user] = lambda: user


def _user_rows(session_factory) -> int:
    with session_factory() as session:
        return session.scalar(select(func.count()).select_from(User))


# --- POST /users: the rule at the route -----------------------------------


@pytest.mark.parametrize("username", REJECTED)
def test_route_rejects_username_with_422_and_writes_no_row(app, client, session_factory, username):
    _as_identity(app, "sub-rejected-name")

    response = client.post("/users", json={"username": username, "date_of_birth": _DOB})

    assert response.status_code == 422
    errors = response.json()["detail"]
    username_errors = [e for e in errors if e["loc"][-1] == "username"]
    assert len(username_errors) == 1
    assert username_errors[0]["msg"] == USERNAME_MSG
    assert _user_rows(session_factory) == 0


@pytest.mark.parametrize("username", ACCEPTED)
def test_route_accepts_username_and_stores_it_exactly_as_sent(
    app, client, session_factory, username
):
    _as_identity(app, "sub-accepted-name")

    response = client.post("/users", json={"username": username, "date_of_birth": _DOB})

    assert response.status_code == 201
    assert response.json()["username"] == username
    with session_factory() as session:
        stored = session.get(User, response.json()["id"])
        assert stored is not None
        assert stored.username == username


# --- grandfathering: an old name that breaks the rule ---------------------

OLD_NAME = "old-name."


def _insert_user(session_factory, *, sub: str, username: str) -> User:
    """Insert straight through the session, bypassing CreateUserRequest, as a
    row written before the rule existed would have been."""
    with session_factory() as session:
        user = User(cognito_sub=sub, username=username, date_of_birth=date(1990, 1, 1))
        session.add(user)
        session.commit()
        session.refresh(user)
        session.expunge(user)
        return user


@pytest.fixture()
def old_user(session_factory) -> User:
    return _insert_user(session_factory, sub="sub-old-name", username=OLD_NAME)


def test_grandfathered_name_is_returned_unchanged_by_public_profile(client, old_user):
    response = client.get(f"/users/{old_user.id}")

    assert response.status_code == 200
    assert response.json()["username"] == OLD_NAME


def test_grandfathered_name_is_returned_unchanged_by_me(app, client, old_user):
    _as_user(app, old_user)

    response = client.get("/users/me")

    assert response.status_code == 200
    assert response.json()["username"] == OLD_NAME


def test_grandfathered_user_can_patch_me(app, client, session_factory, old_user):
    _as_user(app, old_user)

    response = client.patch("/users/me", json={"description": "still a fan"})

    assert response.status_code == 200
    assert response.json()["username"] == OLD_NAME
    assert response.json()["description"] == "still a fan"
    with session_factory() as session:
        assert session.get(User, old_user.id).username == OLD_NAME


def test_grandfathered_name_appears_in_account_search(client, old_user):
    # 'simple' tsvector of "old-name." holds the token "old"; the prefix query finds it.
    response = client.get("/search/accounts", params={"q": "old"})

    assert response.status_code == 200
    matches = [item for item in response.json()["items"] if item["id"] == old_user.id]
    assert len(matches) == 1
    assert matches[0]["username"] == OLD_NAME


def test_grandfathered_name_appears_as_post_author_in_feed(client, session_factory, old_user):
    with session_factory() as session:
        post = Post(author_id=old_user.id, text="an old post")
        session.add(post)
        session.commit()
        post_id = post.id

    response = client.get(f"/feed/thread/{post_id}")

    assert response.status_code == 200
    assert response.json()["root"]["author"]["username"] == OLD_NAME


def test_grandfathered_user_can_follow_and_be_followed(app, client, session_factory, old_user):
    other = _insert_user(session_factory, sub="sub-new-fan", username="new_fan")

    _as_user(app, old_user)
    assert client.post(f"/users/{other.id}/follow").status_code == 204

    _as_user(app, other)
    assert client.post(f"/users/{old_user.id}/follow").status_code == 204

    with session_factory() as session:
        pairs = set(session.execute(select(Follow.follower_user_id, Follow.followed_user_id)))
    assert pairs == {(old_user.id, other.id), (other.id, old_user.id)}
