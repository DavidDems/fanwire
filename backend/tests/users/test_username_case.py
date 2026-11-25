"""USERS-011: usernames are unique regardless of case (ADR 0042).

A unique index on lower(username), ux_users_username_lower, sits beside the
existing case-sensitive UNIQUE(username). A case-only duplicate on POST /users
answers the existing generic 409 and writes no row. Names are still stored and
returned exactly as typed (ADR 0010), and a deactivated user's name stays
reserved in every case. Written before the index exists: today raptors after
Raptors answers 201.
"""

from datetime import UTC, date, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_event_bus, get_session
from app.eventbus import InMemoryEventPublisher, PostEventBus
from app.users.auth import VerifiedIdentity
from app.users.dependencies import get_current_identity
from app.users.models import User
from app.users.routes import router
from app.users.service import create_user, soft_delete_user

RECENT_AUTH_TIME = int(datetime.now(UTC).timestamp())


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


def _create(session, cognito_sub: str, username: str) -> User:
    return create_user(
        session, cognito_sub=cognito_sub, username=username, date_of_birth=date(1990, 1, 1)
    )


def _post_as(app, client, sub: str, username: str):
    app.dependency_overrides[get_current_identity] = lambda: VerifiedIdentity(
        sub=sub, auth_time=RECENT_AUTH_TIME
    )
    return client.post("/users", json={"username": username, "date_of_birth": "1990-01-01"})


def _usernames(session_factory) -> list[str]:
    with session_factory() as session:
        return sorted(session.scalars(select(User.username)))


# --- the model declares the index -------------------------------------------


def test_user_model_declares_a_unique_index_on_lower_username():
    indexes = {index.name: index for index in User.__table__.indexes}

    assert "ux_users_username_lower" in indexes
    index = indexes["ux_users_username_lower"]
    assert index.unique is True
    (expression,) = index.expressions
    assert (
        str(expression.compile(compile_kwargs={"literal_binds": True})) == "lower(users.username)"
    )


def test_the_case_sensitive_unique_constraint_stays():
    assert User.__table__.c.username.unique is True


# --- POST /users ------------------------------------------------------------


@pytest.mark.parametrize("variant", ["raptors", "RAPTORS", "rAPTORS"])
def test_a_case_only_duplicate_answers_409_and_writes_no_row(app, client, session_factory, variant):
    with session_factory() as session:
        _create(session, "sub-first", "Raptors")

    response = _post_as(app, client, "sub-second", variant)

    assert response.status_code == 409
    assert _usernames(session_factory) == ["Raptors"]
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(User)) == 1
        first = session.scalar(select(User).where(User.cognito_sub == "sub-first"))
        assert first is not None
        assert first.username == "Raptors"


def test_the_409_keeps_the_existing_generic_detail(app, client, session_factory):
    with session_factory() as session:
        _create(session, "sub-first", "Raptors")

    response = _post_as(app, client, "sub-second", "raptors")

    assert response.json()["detail"] == (
        "A profile already exists for this account, the username is taken, "
        "or preferred_team_id does not reference an existing team"
    )


@pytest.mark.parametrize("other", ["Raptors2", "Rap.tors", "Raptor"])
def test_a_name_that_differs_by_more_than_case_is_created(app, client, session_factory, other):
    with session_factory() as session:
        _create(session, "sub-first", "Raptors")

    response = _post_as(app, client, "sub-second", other)

    assert response.status_code == 201
    assert response.json()["username"] == other


def test_a_deactivated_users_name_stays_reserved_in_every_case(app, client, session_factory):
    with session_factory() as session:
        user = _create(session, "sub-first", "Raptors")
        soft_delete_user(session, user.id)

    response = _post_as(app, client, "sub-second", "raptors")

    assert response.status_code == 409
    assert _usernames(session_factory) == ["Raptors"]


def test_the_name_is_stored_and_returned_exactly_as_typed(app, client, session_factory):
    response = _post_as(app, client, "sub-first", "Raptors.Fan")

    assert response.status_code == 201
    assert response.json()["username"] == "Raptors.Fan"
    assert _usernames(session_factory) == ["Raptors.Fan"]


# --- the service leaves the duplicate to the database -----------------------


def test_create_user_surfaces_a_case_only_duplicate_as_integrity_error(session_factory):
    with session_factory() as session:
        _create(session, "sub-first", "Raptors")

    with session_factory() as session, pytest.raises(IntegrityError):
        _create(session, "sub-second", "raptors")
