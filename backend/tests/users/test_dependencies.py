"""Tests for the get_current_identity FastAPI dependency, per AGENTS.md TDD
workflow. Written before app/users/dependencies.py exists.

Exercises the actual boundary enforcement wiki/CodeContext/Modules/
0x01-users.md's Security section requires: a Cognito token verified
server-side on every request, never trusted based on client claims alone.
No real protected route exists yet in app.main — this proves the
dependency works against a throwaway route defined in this test module,
per the task's instructions not to touch app.main this phase.
"""

from datetime import date

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from testcontainers.postgres import PostgresContainer

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_session
from app.settings import Settings
from app.users.auth import FakeTokenVerifier, RefreshingTokenVerifier, VerifiedIdentity
from app.users.dependencies import (
    _default_token_verifier,
    get_current_identity,
    get_current_user,
    get_optional_current_user,
    get_token_verifier,
)
from app.users.models import User
from app.users.service import create_user, soft_delete_user


def _make_app():
    app = FastAPI()

    @app.get("/whoami")
    def whoami(identity: VerifiedIdentity = Depends(get_current_identity)):
        return {"sub": identity.sub, "email": identity.email}

    return app


def test_get_current_identity_accepts_a_valid_bearer_token():
    app = _make_app()
    identity = VerifiedIdentity(sub="cognito-sub-123", email="alice@example.com")
    app.dependency_overrides[get_token_verifier] = lambda: FakeTokenVerifier(identity)
    client = TestClient(app)

    response = client.get("/whoami", headers={"Authorization": "Bearer good-token"})

    assert response.status_code == 200
    assert response.json() == {"sub": "cognito-sub-123", "email": "alice@example.com"}


def test_get_current_identity_rejects_an_invalid_token():
    app = _make_app()
    app.dependency_overrides[get_token_verifier] = lambda: FakeTokenVerifier(None)
    client = TestClient(app)

    response = client.get("/whoami", headers={"Authorization": "Bearer bad-token"})

    assert response.status_code == 401


def test_get_current_identity_rejects_a_missing_authorization_header():
    app = _make_app()
    app.dependency_overrides[get_token_verifier] = lambda: FakeTokenVerifier(
        VerifiedIdentity(sub="irrelevant")
    )
    client = TestClient(app)

    response = client.get("/whoami")

    assert response.status_code == 401


def test_get_current_identity_rejects_a_malformed_authorization_header():
    app = _make_app()
    app.dependency_overrides[get_token_verifier] = lambda: FakeTokenVerifier(
        VerifiedIdentity(sub="irrelevant")
    )
    client = TestClient(app)

    response = client.get("/whoami", headers={"Authorization": "good-token-no-scheme"})

    assert response.status_code == 401


def _settings(**overrides) -> Settings:
    values = {
        "database_url": "postgresql+psycopg://u:p@host:5432/db",
        "cognito_region": "us-east-1",
        "cognito_user_pool_id": "us-east-1_pool123",
        "cognito_app_client_id": "client-abc",
        **overrides,
    }
    return Settings(**values)


def test_get_token_verifier_builds_a_refreshing_token_verifier_from_settings():
    _default_token_verifier.cache_clear()

    verifier = get_token_verifier(_settings())

    assert isinstance(verifier, RefreshingTokenVerifier)


def test_get_token_verifier_caches_by_settings_values():
    _default_token_verifier.cache_clear()
    settings = _settings()

    first = get_token_verifier(settings)
    second = get_token_verifier(settings)

    assert first is second


def test_get_token_verifier_differs_for_different_settings():
    _default_token_verifier.cache_clear()

    first = get_token_verifier(_settings(cognito_user_pool_id="us-east-1_pool-a"))
    second = get_token_verifier(_settings(cognito_user_pool_id="us-east-1_pool-b"))

    assert first is not second


# --- get_current_user -------------------------------------------------
#
# Resolves the verified token's `sub` to this app's local User row. Needs a
# real Postgres-backed session (via testcontainers, same fixture pattern as
# backend/tests/users/test_service.py) since it queries the users table.


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


def _make_current_user_app(*, identity: VerifiedIdentity, session_factory):
    app = FastAPI()

    @app.get("/me")
    def me(user: User = Depends(get_current_user)):
        return {"id": user.id, "username": user.username}

    def _get_session_override():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_token_verifier] = lambda: FakeTokenVerifier(identity)
    app.dependency_overrides[get_session] = _get_session_override
    return app


def test_get_current_user_resolves_to_the_matching_active_user(session_factory):
    with session_factory() as session:
        user = create_user(
            session,
            cognito_sub="sub-resolve-me",
            username="resolveme",
            date_of_birth=date(1990, 1, 1),
        )
        user_id = user.id

    identity = VerifiedIdentity(sub="sub-resolve-me")
    app = _make_current_user_app(identity=identity, session_factory=session_factory)
    client = TestClient(app)

    response = client.get("/me", headers={"Authorization": "Bearer good-token"})

    assert response.status_code == 200
    assert response.json() == {"id": user_id, "username": "resolveme"}


def test_get_current_user_404s_when_no_user_row_matches_the_sub(session_factory):
    identity = VerifiedIdentity(sub="sub-with-no-profile")
    app = _make_current_user_app(identity=identity, session_factory=session_factory)
    client = TestClient(app)

    response = client.get("/me", headers={"Authorization": "Bearer good-token"})

    assert response.status_code == 404


def test_get_current_user_404s_when_the_matching_row_is_soft_deleted(session_factory):
    with session_factory() as session:
        user = create_user(
            session,
            cognito_sub="sub-soft-deleted",
            username="softdeleted",
            date_of_birth=date(1990, 1, 1),
        )
        soft_delete_user(session, user.id)

    identity = VerifiedIdentity(sub="sub-soft-deleted")
    app = _make_current_user_app(identity=identity, session_factory=session_factory)
    client = TestClient(app)

    response = client.get("/me", headers={"Authorization": "Bearer good-token"})

    assert response.status_code == 404


# --- get_optional_current_user -----------------------------------------
#
# For the guest-vs-authenticated feed/ (a later unit): no header -> None
# (guest), an invalid/malformed token -> 401 (never a silent downgrade to
# guest), a valid token with no matching profile -> None.


def _make_optional_current_user_app(*, session_factory):
    app = FastAPI()

    @app.get("/maybe-me")
    def maybe_me(user: User | None = Depends(get_optional_current_user)):
        if user is None:
            return {"authenticated": False}
        return {"authenticated": True, "id": user.id}

    def _get_session_override():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = _get_session_override
    return app


def test_get_optional_current_user_returns_none_without_authorization_header(session_factory):
    app = _make_optional_current_user_app(session_factory=session_factory)
    app.dependency_overrides[get_token_verifier] = lambda: FakeTokenVerifier(
        VerifiedIdentity(sub="irrelevant")
    )
    client = TestClient(app)

    response = client.get("/maybe-me")

    assert response.status_code == 200
    assert response.json() == {"authenticated": False}


def test_get_optional_current_user_401s_on_an_invalid_token(session_factory):
    app = _make_optional_current_user_app(session_factory=session_factory)
    app.dependency_overrides[get_token_verifier] = lambda: FakeTokenVerifier(None)
    client = TestClient(app)

    response = client.get("/maybe-me", headers={"Authorization": "Bearer bad-token"})

    assert response.status_code == 401


def test_get_optional_current_user_401s_on_a_malformed_header(session_factory):
    app = _make_optional_current_user_app(session_factory=session_factory)
    app.dependency_overrides[get_token_verifier] = lambda: FakeTokenVerifier(
        VerifiedIdentity(sub="irrelevant")
    )
    client = TestClient(app)

    response = client.get("/maybe-me", headers={"Authorization": "good-token-no-scheme"})

    assert response.status_code == 401


def test_get_optional_current_user_returns_none_when_token_valid_but_no_profile(session_factory):
    app = _make_optional_current_user_app(session_factory=session_factory)
    app.dependency_overrides[get_token_verifier] = lambda: FakeTokenVerifier(
        VerifiedIdentity(sub="sub-optional-no-profile")
    )
    client = TestClient(app)

    response = client.get("/maybe-me", headers={"Authorization": "Bearer good-token"})

    assert response.status_code == 200
    assert response.json() == {"authenticated": False}


def test_get_optional_current_user_resolves_the_active_user(session_factory):
    with session_factory() as session:
        user = create_user(
            session,
            cognito_sub="sub-optional-with-profile",
            username="optionalprofile",
            date_of_birth=date(1990, 1, 1),
        )
        user_id = user.id

    app = _make_optional_current_user_app(session_factory=session_factory)
    app.dependency_overrides[get_token_verifier] = lambda: FakeTokenVerifier(
        VerifiedIdentity(sub="sub-optional-with-profile")
    )
    client = TestClient(app)

    response = client.get("/maybe-me", headers={"Authorization": "Bearer good-token"})

    assert response.status_code == 200
    assert response.json() == {"authenticated": True, "id": user_id}
