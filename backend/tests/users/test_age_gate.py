"""Age-gate tests for POST /users (USERS-002).

date_of_birth must be strictly in the past and at least 16 whole years
before the request date. Written against the intended interface before
any validation exists on app.users.schemas.CreateUserRequest -- today,
POST /users accepts any date, including a future one, so these are
expected to fail until that validation lands.

Follows the same "build a throwaway FastAPI() app, override
get_session/get_event_bus/get_current_identity" pattern as
tests/users/test_routes.py.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from testcontainers.postgres import PostgresContainer

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_event_bus, get_session
from app.eventbus import InMemoryEventPublisher, PostEventBus
from app.users.auth import VerifiedIdentity
from app.users.dependencies import get_current_identity, get_current_user
from app.users.models import User
from app.users.routes import router

TODAY = date.today()


def _years_before_today(years: int) -> date:
    try:
        return TODAY.replace(year=TODAY.year - years)
    except ValueError:
        # TODAY is a Feb 29 that doesn't exist `years` back -- nudge to Mar 1
        # rather than let the whole test run depend on the calendar.
        return TODAY.replace(month=3, day=1, year=TODAY.year - years)


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


def _as_identity(app, sub: str) -> None:
    app.dependency_overrides[get_current_identity] = lambda: VerifiedIdentity(sub=sub)


def _user_count(session_factory, username: str) -> int:
    with session_factory() as session:
        rows = session.execute(select(User).where(User.username == username)).scalars().all()
        return len(rows)


def test_create_profile_exactly_16_years_old_succeeds(app, client, session_factory):
    _as_identity(app, "sub-exactly-16")
    dob = _years_before_today(16)

    response = client.post(
        "/users",
        json={"username": "exactly_sixteen", "date_of_birth": dob.isoformat()},
    )

    assert response.status_code == 201
    assert _user_count(session_factory, "exactly_sixteen") == 1


def test_create_profile_one_day_short_of_16_returns_422_and_creates_no_profile(
    app, client, session_factory
):
    _as_identity(app, "sub-one-day-short")
    dob = _years_before_today(16) + timedelta(days=1)

    response = client.post(
        "/users",
        json={"username": "one_day_short", "date_of_birth": dob.isoformat()},
    )

    assert response.status_code == 422
    assert _user_count(session_factory, "one_day_short") == 0


def test_create_profile_future_date_of_birth_returns_422_and_creates_no_profile(
    app, client, session_factory
):
    _as_identity(app, "sub-future-dob")
    dob = TODAY + timedelta(days=1)

    response = client.post(
        "/users",
        json={"username": "future_dob", "date_of_birth": dob.isoformat()},
    )

    assert response.status_code == 422
    assert _user_count(session_factory, "future_dob") == 0


def test_create_profile_date_of_birth_today_returns_422_and_creates_no_profile(
    app, client, session_factory
):
    _as_identity(app, "sub-today-dob")

    response = client.post(
        "/users",
        json={"username": "today_dob", "date_of_birth": TODAY.isoformat()},
    )

    assert response.status_code == 422
    assert _user_count(session_factory, "today_dob") == 0


def test_create_profile_underage_422_names_date_of_birth_as_the_field(app, client):
    """The 422 body must point a form at date_of_birth specifically, not
    just report a generic validation failure."""
    _as_identity(app, "sub-field-name")
    dob = _years_before_today(16) + timedelta(days=1)

    response = client.post(
        "/users",
        json={"username": "field_name_user", "date_of_birth": dob.isoformat()},
    )

    assert response.status_code == 422
    body = response.json()
    errors = body.get("detail", [])
    assert isinstance(errors, list) and len(errors) > 0
    assert any("date_of_birth" in error.get("loc", []) for error in errors)


def test_create_profile_30_years_old_succeeds_and_dob_visibility_matches_route(
    app, client, session_factory
):
    _as_identity(app, "sub-thirty")
    dob = _years_before_today(30)

    response = client.post(
        "/users",
        json={"username": "thirty_year_old", "date_of_birth": dob.isoformat()},
    )

    assert response.status_code == 201
    user_id = response.json()["id"]
    assert response.json()["date_of_birth"] == dob.isoformat()

    public_response = client.get(f"/users/{user_id}")
    assert public_response.status_code == 200
    assert "date_of_birth" not in public_response.json()

    with session_factory() as session:
        user = session.get(User, user_id)
    app.dependency_overrides[get_current_user] = lambda: user

    me_response = client.get("/users/me")
    assert me_response.status_code == 200
    assert me_response.json()["date_of_birth"] == dob.isoformat()
