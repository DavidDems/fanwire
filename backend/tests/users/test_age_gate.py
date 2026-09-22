"""Pins the USERS-002 age gate: POST /users must reject a date_of_birth
that isn't strictly in the past, and must reject anyone who is not yet a
whole 16 years old on the day of the request.

Written before app.users.schemas.CreateUserRequest validates
date_of_birth at all -- today it accepts any date, including a future
one, so every 422 assertion below is expected to fail (the endpoint
currently returns 201) until that validation exists.

Follows the "build a small throwaway app, override get_session/
get_current_identity/get_current_user" pattern from
tests/users/test_routes.py, and freezes "today" with freezegun so the
16-years-ago/tomorrow/today boundaries are exact regardless of when CI
runs -- see backend-testing skill re: freezegun for TTL/date-boundary
tests.
"""

from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from freezegun import freeze_time
from sqlalchemy import select
from testcontainers.postgres import PostgresContainer

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_event_bus, get_session
from app.eventbus import InMemoryEventPublisher, PostEventBus
from app.users.auth import VerifiedIdentity
from app.users.dependencies import get_current_identity, get_current_user
from app.users.models import User
from app.users.routes import router

# Frozen "today" for every test in this file. Deliberately not Feb 29 or
# any other day where "N years before" is ambiguous.
FROZEN_TODAY = date(2026, 6, 15)
FROZEN_TODAY_ISO = "2026-06-15"

EXACTLY_16_YEARS_AGO = date(2010, 6, 15)
ONE_DAY_SHORT_OF_16 = date(2010, 6, 16)
TOMORROW = date(2026, 6, 16)
THIRTY_YEARS_AGO = date(1996, 6, 15)


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


def _as_user(app, user: User) -> None:
    app.dependency_overrides[get_current_user] = lambda: user


def _post_user(client, *, username: str, date_of_birth: date, description: str | None = None):
    body = {"username": username, "date_of_birth": date_of_birth.isoformat()}
    if description is not None:
        body["description"] = description
    return client.post("/users", json=body)


def _user_exists(session_factory, username: str) -> bool:
    with session_factory() as session:
        return session.scalar(select(User).where(User.username == username)) is not None


def _names_date_of_birth_as_offending_field(body: dict) -> bool:
    detail = body.get("detail")
    if isinstance(detail, list):
        return any("date_of_birth" in err.get("loc", []) for err in detail)
    return "date_of_birth" in str(detail)


# --- criterion 1: exactly 16 years old today is old enough -----------------


def test_dob_exactly_16_years_before_today_returns_201_and_creates_profile(
    app, client, session_factory
):
    _as_identity(app, "sub-exactly-16")

    with freeze_time(FROZEN_TODAY_ISO):
        response = _post_user(
            client, username="exactly_sixteen", date_of_birth=EXACTLY_16_YEARS_AGO
        )

    assert response.status_code == 201
    assert _user_exists(session_factory, "exactly_sixteen")


# --- criterion 2: one day short of the 16th birthday is too young ----------


def test_dob_one_day_short_of_16th_birthday_returns_422_and_creates_no_profile(
    app, client, session_factory
):
    _as_identity(app, "sub-one-day-short")

    with freeze_time(FROZEN_TODAY_ISO):
        response = _post_user(client, username="one_day_short", date_of_birth=ONE_DAY_SHORT_OF_16)

    assert response.status_code == 422
    assert not _user_exists(session_factory, "one_day_short")


# --- criterion 3: a future date of birth is rejected ------------------------


def test_dob_in_future_returns_422_and_creates_no_profile(app, client, session_factory):
    _as_identity(app, "sub-future-dob")

    with freeze_time(FROZEN_TODAY_ISO):
        response = _post_user(client, username="future_dob", date_of_birth=TOMORROW)

    assert response.status_code == 422
    assert not _user_exists(session_factory, "future_dob")


# --- criterion 4: today is not "strictly in the past" -----------------------


def test_dob_of_today_returns_422(app, client, session_factory):
    _as_identity(app, "sub-today-dob")

    with freeze_time(FROZEN_TODAY_ISO):
        response = _post_user(client, username="today_dob", date_of_birth=FROZEN_TODAY)

    assert response.status_code == 422
    assert not _user_exists(session_factory, "today_dob")


# --- criterion 5: the 422 names date_of_birth as the field at fault --------


@pytest.mark.parametrize(
    "dob",
    [ONE_DAY_SHORT_OF_16, TOMORROW, FROZEN_TODAY],
    ids=["one_day_short_of_16", "future", "today"],
)
def test_422_response_names_date_of_birth_as_the_offending_field(app, client, dob):
    _as_identity(app, f"sub-field-at-fault-{dob.isoformat()}")

    with freeze_time(FROZEN_TODAY_ISO):
        response = _post_user(client, username=f"field_fault_{dob.isoformat()}", date_of_birth=dob)

    assert response.status_code == 422
    assert _names_date_of_birth_as_offending_field(response.json())


# --- criterion 6: a 30-year-old still succeeds and PII visibility holds ----


def test_dob_30_years_before_today_succeeds_and_pii_visibility_is_unchanged(
    app, client, session_factory
):
    _as_identity(app, "sub-thirty-years")

    with freeze_time(FROZEN_TODAY_ISO):
        response = _post_user(client, username="thirty_years", date_of_birth=THIRTY_YEARS_AGO)

    assert response.status_code == 201
    body = response.json()
    assert body["date_of_birth"] == THIRTY_YEARS_AGO.isoformat()
    user_id = body["id"]

    public_response = client.get(f"/users/{user_id}")
    assert public_response.status_code == 200
    assert "date_of_birth" not in public_response.json()

    with session_factory() as session:
        user = session.scalar(select(User).where(User.id == user_id))

    _as_user(app, user)
    me_response = client.get("/users/me")
    assert me_response.status_code == 200
    assert me_response.json()["date_of_birth"] == THIRTY_YEARS_AGO.isoformat()
