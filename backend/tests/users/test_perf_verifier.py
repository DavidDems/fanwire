"""PERF-001: get_token_verifier's perf path, per AGENTS.md TDD workflow.
Written before it exists.

When Settings.perf_jwks_path is set (which Settings only allows with
ENVIRONMENT exactly "perf", see tests/test_settings_perf.py),
get_token_verifier returns the existing CognitoTokenVerifier built from the
JWKS JSON file at that path, with the perf issuer and audience
(app.users.dependencies.PERF_ISSUER / PERF_AUDIENCE). It never fetches a JWKS
over the network. auth.py is untouched, so every check CognitoTokenVerifier
already makes still applies; the route-level tests below prove that on
GET /users/me through the real app.main.app wiring.

Each test writes its JWKS to its own tmp_path, so an implementation that
caches the perf verifier by path never serves one test another's key.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import urllib.request
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from jwt.algorithms import RSAAlgorithm

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_session, get_settings
from app.main import app as main_app
from app.settings import Settings
from app.users import dependencies as users_dependencies
from app.users.auth import CognitoTokenVerifier, InvalidTokenError, RefreshingTokenVerifier
from app.users.dependencies import get_token_verifier
from app.users.jwks import JWKSProvider
from app.users.models import User

KID = "perf-test-kid"


def _keypair(kid: str = KID) -> dict:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    public_der = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    jwk = RSAAlgorithm.to_jwk(private_key.public_key(), as_dict=True)
    jwk.update({"kid": kid, "alg": "RS256", "use": "sig"})
    return {"kid": kid, "private_pem": private_pem, "public_der": public_der, "jwk": jwk}


@pytest.fixture(scope="module")
def perf_key():
    return _keypair()


@pytest.fixture(scope="module")
def stranger_key():
    # Same kid on purpose: a forger copies the header, and the only thing that
    # should stop the token is the signature not matching the perf JWKS key.
    return _keypair()


def _write_jwks(directory: Path, key: dict) -> Path:
    path = directory / "jwks.json"
    path.write_text(json.dumps({"keys": [key["jwk"]]}), encoding="utf-8")
    return path


def _id_claims(sub: str = "perf-user-1", **overrides) -> dict:
    now = datetime.now(UTC)
    claims = {
        "sub": sub,
        "token_use": "id",
        "aud": users_dependencies.PERF_AUDIENCE,
        "iss": users_dependencies.PERF_ISSUER,
        "exp": now + timedelta(hours=2),
        "iat": now,
    }
    claims.update(overrides)
    return claims


def _sign(key: dict, claims: dict) -> str:
    return jwt.encode(claims, key["private_pem"], algorithm="RS256", headers={"kid": key["kid"]})


def _hs256_with_public_key(key: dict, claims: dict) -> str:
    """CVE-2026-85394's shape: HS256 keyed with the RSA public key bytes."""

    def b64(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

    def jsonb64(obj: dict) -> str:
        return b64(json.dumps(obj, default=lambda v: int(v.timestamp())).encode())

    signing_input = (
        jsonb64({"alg": "HS256", "typ": "JWT", "kid": key["kid"]}) + "." + jsonb64(claims)
    )
    signature = hmac.new(key["public_der"], signing_input.encode(), hashlib.sha256).digest()
    return f"{signing_input}.{b64(signature)}"


def _perf_settings(jwks_path: Path, database_url: str = "postgresql+psycopg://u:p@h:5432/db"):
    return Settings(
        database_url=database_url,
        environment="perf",
        perf_jwks_path=str(jwks_path),
        cognito_region="us-east-1",
        cognito_user_pool_id="us-east-1_pool123",
        cognito_app_client_id="client-abc",
    )


@pytest.fixture()
def no_network(monkeypatch):
    """Any JWKS fetch or HTTP call fails the test loudly."""

    def _boom(*args, **kwargs):
        raise AssertionError("the perf verifier must never touch JWKSProvider or the network")

    monkeypatch.setattr(JWKSProvider, "__init__", _boom)
    monkeypatch.setattr(JWKSProvider, "get_jwks", _boom)
    monkeypatch.setattr(urllib.request, "urlopen", _boom)


# --- the constants ------------------------------------------------------


def test_perf_issuer_and_audience_are_non_empty_strings():
    assert isinstance(users_dependencies.PERF_ISSUER, str)
    assert isinstance(users_dependencies.PERF_AUDIENCE, str)
    assert users_dependencies.PERF_ISSUER
    assert users_dependencies.PERF_AUDIENCE


def test_perf_issuer_is_not_a_cognito_issuer():
    assert "cognito-idp" not in users_dependencies.PERF_ISSUER
    assert "amazonaws.com" not in users_dependencies.PERF_ISSUER


# --- get_token_verifier ---------------------------------------------------


def test_perf_jwks_path_yields_a_cognito_token_verifier(tmp_path, perf_key, no_network):
    verifier = get_token_verifier(_perf_settings(_write_jwks(tmp_path, perf_key)))

    assert isinstance(verifier, CognitoTokenVerifier)
    assert not isinstance(verifier, RefreshingTokenVerifier)


def test_perf_verifier_accepts_a_perf_id_token_and_returns_its_sub(tmp_path, perf_key, no_network):
    verifier = get_token_verifier(_perf_settings(_write_jwks(tmp_path, perf_key)))

    identity = verifier.verify(_sign(perf_key, _id_claims(sub="perf-user-42")))

    assert identity.sub == "perf-user-42"


def test_perf_verifier_rejects_a_key_not_in_the_jwks(tmp_path, perf_key, stranger_key, no_network):
    verifier = get_token_verifier(_perf_settings(_write_jwks(tmp_path, perf_key)))

    with pytest.raises(InvalidTokenError):
        verifier.verify(_sign(stranger_key, _id_claims()))


def test_perf_verifier_rejects_the_cognito_issuer(tmp_path, perf_key, no_network):
    verifier = get_token_verifier(_perf_settings(_write_jwks(tmp_path, perf_key)))
    token = _sign(
        perf_key,
        _id_claims(iss="https://cognito-idp.us-east-1.amazonaws.com/us-east-1_pool123"),
    )

    with pytest.raises(InvalidTokenError):
        verifier.verify(token)


def test_perf_verifier_rejects_the_wrong_audience(tmp_path, perf_key, no_network):
    verifier = get_token_verifier(_perf_settings(_write_jwks(tmp_path, perf_key)))

    with pytest.raises(InvalidTokenError):
        verifier.verify(_sign(perf_key, _id_claims(aud="client-abc")))


def test_empty_perf_jwks_path_still_yields_the_refreshing_verifier():
    users_dependencies._default_token_verifier.cache_clear()
    settings = Settings(
        database_url="postgresql+psycopg://u:p@h:5432/db",
        environment="perf",
        cognito_region="us-east-1",
        cognito_user_pool_id="us-east-1_pool123",
        cognito_app_client_id="client-abc",
    )

    assert isinstance(get_token_verifier(settings), RefreshingTokenVerifier)


# --- GET /users/me through app.main.app -----------------------------------


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def perf_client(tmp_path, perf_key, session_factory, postgres_url, no_network):
    settings = _perf_settings(_write_jwks(tmp_path, perf_key), database_url=postgres_url)

    def _get_session_override():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    main_app.dependency_overrides[get_settings] = lambda: settings
    main_app.dependency_overrides[get_session] = _get_session_override
    try:
        yield TestClient(main_app)
    finally:
        main_app.dependency_overrides.pop(get_settings, None)
        main_app.dependency_overrides.pop(get_session, None)


def _me(client: TestClient, token: str):
    return client.get("/users/me", headers={"Authorization": f"Bearer {token}"})


def test_me_accepts_a_valid_perf_token_for_an_existing_user(perf_client, perf_key, session_factory):
    with session_factory() as session:
        session.add(
            User(cognito_sub="perf-user-7", username="perfuser7", date_of_birth=date(1990, 1, 1))
        )
        session.commit()

    response = _me(perf_client, _sign(perf_key, _id_claims(sub="perf-user-7")))

    assert response.status_code == 200, response.text
    assert response.json()["username"] == "perfuser7"


def test_me_401s_a_token_signed_by_a_key_not_in_the_jwks(perf_client, stranger_key):
    assert _me(perf_client, _sign(stranger_key, _id_claims())).status_code == 401


def test_me_401s_an_expired_perf_token(perf_client, perf_key):
    past = datetime.now(UTC) - timedelta(hours=1)
    token = _sign(perf_key, _id_claims(exp=past, iat=past - timedelta(hours=2)))

    assert _me(perf_client, token).status_code == 401


def test_me_401s_an_hs256_token(perf_client, perf_key):
    claims = _id_claims()
    token = _hs256_with_public_key(perf_key, claims)

    assert _me(perf_client, token).status_code == 401


def test_me_401s_an_access_token(perf_client, perf_key):
    claims = _id_claims(token_use="access", client_id=users_dependencies.PERF_AUDIENCE)
    del claims["aud"]

    assert _me(perf_client, _sign(perf_key, claims)).status_code == 401
