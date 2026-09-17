"""Tests for the get_current_identity FastAPI dependency, per AGENTS.md TDD
workflow. Written before app/users/dependencies.py exists.

Exercises the actual boundary enforcement wiki/CodeContext/Modules/
0x01-users.md's Security section requires: a Cognito token verified
server-side on every request, never trusted based on client claims alone.
No real protected route exists yet in app.main — this proves the
dependency works against a throwaway route defined in this test module,
per the task's instructions not to touch app.main this phase.
"""

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.settings import Settings
from app.users.auth import FakeTokenVerifier, RefreshingTokenVerifier, VerifiedIdentity
from app.users.dependencies import _default_token_verifier, get_current_identity, get_token_verifier


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
