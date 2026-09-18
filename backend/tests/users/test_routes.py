"""Tests for users/ HTTP routes, per AGENTS.md TDD workflow. Written before
app/users/routes.py and app/users/schemas.py exist.

Routers aren't wired into app.main yet (a later unit wires all three
modules' routers in together) -- this builds a throwaway local FastAPI()
app that includes the users router and overrides get_current_identity/
get_current_user/get_session, the same "build a small app, override the
dependency" pattern backend/tests/users/test_dependencies.py and
backend/tests/events/test_routes.py use.

See wiki/CodeContext/Modules/0x01-users.md Security section: writes
require a verified Cognito token; profile-page reads (GET /users/{id}) are
public.
"""

from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from testcontainers.postgres import PostgresContainer

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_event_bus, get_session
from app.eventbus import InMemoryEventPublisher, PostEventBus
from app.users.auth import VerifiedIdentity
from app.users.dependencies import get_current_identity, get_current_user
from app.users.models import User
from app.users.routes import router
from app.users.service import create_user, follow, soft_delete_user


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
    app.dependency_overrides[get_event_bus] = lambda: PostEventBus(InMemoryEventPublisher())
    return app


@pytest.fixture()
def client(app):
    return TestClient(app)


def _create(session, cognito_sub, username, **overrides):
    defaults = {"date_of_birth": date(1990, 1, 1)}
    defaults.update(overrides)
    return create_user(session, cognito_sub=cognito_sub, username=username, **defaults)


def _as_identity(app, identity: VerifiedIdentity) -> None:
    app.dependency_overrides[get_current_identity] = lambda: identity


def _as_user(app, user: User) -> None:
    app.dependency_overrides[get_current_user] = lambda: user


def _test_event_bus() -> PostEventBus:
    return PostEventBus(InMemoryEventPublisher())


def _with_captured_event_bus(app) -> InMemoryEventPublisher:
    publisher = InMemoryEventPublisher()
    app.dependency_overrides[get_event_bus] = lambda: PostEventBus(publisher)
    return publisher


# --- POST /users --------------------------------------------------------


def test_create_profile_succeeds(app, client):
    _as_identity(app, VerifiedIdentity(sub="sub-new"))

    response = client.post(
        "/users",
        json={
            "username": "newuser",
            "date_of_birth": "1990-01-01",
            "description": "hi there",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["username"] == "newuser"
    assert body["description"] == "hi there"
    assert "cognito_sub" not in body
    assert "id" in body


def test_create_profile_duplicate_cognito_sub_returns_409(app, client, session_factory):
    with session_factory() as session:
        _create(session, "sub-dup", "existing_user")

    _as_identity(app, VerifiedIdentity(sub="sub-dup"))

    response = client.post(
        "/users",
        json={"username": "another_username", "date_of_birth": "1990-01-01"},
    )

    assert response.status_code == 409


def test_create_profile_duplicate_username_returns_409(app, client, session_factory):
    with session_factory() as session:
        _create(session, "sub-existing", "taken_username")

    _as_identity(app, VerifiedIdentity(sub="sub-fresh"))

    response = client.post(
        "/users",
        json={"username": "taken_username", "date_of_birth": "1990-01-01"},
    )

    assert response.status_code == 409


# --- GET /users/{user_id} ------------------------------------------------


def test_get_profile_returns_200_for_existing_active_user(client, session_factory):
    with session_factory() as session:
        user = _create(session, "sub-get", "getme", description="about me")
        user_id = user.id

    response = client.get(f"/users/{user_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == user_id
    assert body["username"] == "getme"
    assert body["description"] == "about me"
    assert "cognito_sub" not in body


def test_get_profile_returns_404_for_missing_user(client):
    response = client.get("/users/999999")

    assert response.status_code == 404


def test_get_profile_returns_404_for_soft_deleted_user(client, session_factory):
    with session_factory() as session:
        user = _create(session, "sub-gone", "gone_user")
        soft_delete_user(session, user.id)
        user_id = user.id

    response = client.get(f"/users/{user_id}")

    assert response.status_code == 404


# --- DELETE /users/me -----------------------------------------------------


def test_delete_me_soft_deletes_caller_and_then_404s(app, client, session_factory):
    with session_factory() as session:
        user = _create(session, "sub-self-delete", "self_delete_user")

    _as_user(app, user)

    response = client.delete("/users/me")
    assert response.status_code == 204

    get_response = client.get(f"/users/{user.id}")
    assert get_response.status_code == 404


# --- POST/DELETE /users/{user_id}/follow ----------------------------------


def test_follow_succeeds(app, client, session_factory):
    with session_factory() as session:
        follower = _create(session, "sub-follower", "follower_user")
        followed = _create(session, "sub-followed", "followed_user")

    _as_user(app, follower)
    publisher = _with_captured_event_bus(app)

    response = client.post(f"/users/{followed.id}/follow")

    assert response.status_code == 204
    event_names = [e.name for e in publisher.published]
    assert event_names == ["UserFollowed"]


def test_self_follow_returns_400(app, client, session_factory):
    with session_factory() as session:
        user = _create(session, "sub-self-follow", "self_follow_user")

    _as_user(app, user)

    response = client.post(f"/users/{user.id}/follow")

    assert response.status_code == 400


def test_duplicate_follow_returns_409(app, client, session_factory):
    with session_factory() as session:
        follower = _create(session, "sub-dup-follower", "dup_follower_user")
        followed = _create(session, "sub-dup-followed", "dup_followed_user")
        follow(
            session,
            event_bus=_test_event_bus(),
            follower_user_id=follower.id,
            followed_user_id=followed.id,
        )

    _as_user(app, follower)

    response = client.post(f"/users/{followed.id}/follow")

    assert response.status_code == 409


def test_unfollow_succeeds(app, client, session_factory):
    with session_factory() as session:
        follower = _create(session, "sub-unfollower", "unfollower_user")
        followed = _create(session, "sub-unfollowed", "unfollowed_user")
        follow(
            session,
            event_bus=_test_event_bus(),
            follower_user_id=follower.id,
            followed_user_id=followed.id,
        )

    _as_user(app, follower)

    response = client.delete(f"/users/{followed.id}/follow")

    assert response.status_code == 204


def test_unfollow_when_not_following_returns_404(app, client, session_factory):
    with session_factory() as session:
        follower = _create(session, "sub-no-follow", "no_follow_user")
        followed = _create(session, "sub-not-followed", "not_followed_user")

    _as_user(app, follower)

    response = client.delete(f"/users/{followed.id}/follow")

    assert response.status_code == 404
