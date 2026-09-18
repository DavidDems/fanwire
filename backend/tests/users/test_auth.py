"""Tests for users/ Cognito JWT verification, per AGENTS.md TDD workflow.
Written before app/users/auth.py exists.

CognitoTokenVerifier is exercised against a real, locally-generated RSA
keypair and a self-signed test JWT — never against real Cognito (the JWKS
is injected, per wiki/CodeContext/Modules/0x01-users.md's Dependency
Inversion tie-in and wiki/CodeContext/Standards/design-principles.md).
"""

from datetime import UTC, datetime, timedelta

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwk, jwt

from app.users.auth import (
    CognitoTokenVerifier,
    FakeTokenVerifier,
    InvalidTokenError,
    RefreshingTokenVerifier,
    VerifiedIdentity,
)
from app.users.jwks import JWKSProvider

AUDIENCE = "test-app-client-id"
ISSUER = "https://cognito-idp.ca-central-1.amazonaws.com/ca-central-1_test"
KID = "test-kid"


@pytest.fixture(scope="module")
def rsa_keys():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_key = private_key.public_key()

    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    public_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()

    jwk_dict = jwk.construct(public_pem, "RS256").to_dict()
    jwk_dict["kid"] = KID
    return {"private_pem": private_pem, "jwks": {"keys": [jwk_dict]}}


def _make_token(rsa_keys, **claim_overrides):
    now = datetime.now(UTC)
    claims = {
        "sub": "cognito-sub-123",
        "email": "alice@example.com",
        "aud": AUDIENCE,
        "iss": ISSUER,
        "exp": now + timedelta(minutes=5),
        "iat": now,
    }
    claims.update(claim_overrides)
    return jwt.encode(claims, rsa_keys["private_pem"], algorithm="RS256", headers={"kid": KID})


def test_verify_accepts_a_valid_token(rsa_keys):
    verifier = CognitoTokenVerifier(jwks=rsa_keys["jwks"], audience=AUDIENCE, issuer=ISSUER)
    token = _make_token(rsa_keys)

    identity = verifier.verify(token)

    assert identity == VerifiedIdentity(sub="cognito-sub-123", email="alice@example.com")


def test_verify_rejects_wrong_audience(rsa_keys):
    verifier = CognitoTokenVerifier(jwks=rsa_keys["jwks"], audience=AUDIENCE, issuer=ISSUER)
    token = _make_token(rsa_keys, aud="some-other-client-id")

    with pytest.raises(InvalidTokenError):
        verifier.verify(token)


def test_verify_rejects_expired_token(rsa_keys):
    verifier = CognitoTokenVerifier(jwks=rsa_keys["jwks"], audience=AUDIENCE, issuer=ISSUER)
    expired = datetime.now(UTC) - timedelta(minutes=5)
    token = _make_token(rsa_keys, exp=expired, iat=expired - timedelta(minutes=10))

    with pytest.raises(InvalidTokenError):
        verifier.verify(token)


def test_verify_rejects_tampered_signature(rsa_keys):
    verifier = CognitoTokenVerifier(jwks=rsa_keys["jwks"], audience=AUDIENCE, issuer=ISSUER)
    token = _make_token(rsa_keys)
    # Flip a character in the middle of the signature segment, not the
    # trailing edge of the base64url string — the last character(s) of a
    # base64 group can carry fewer meaningful bits, so some substitutions
    # there round-trip to the same decoded bytes and don't actually tamper
    # the signature (flaky test otherwise).
    header_b64, payload_b64, signature_b64 = token.split(".")
    mid = len(signature_b64) // 2
    tampered_char = "A" if signature_b64[mid] != "A" else "B"
    tampered_signature = signature_b64[:mid] + tampered_char + signature_b64[mid + 1 :]
    tampered = f"{header_b64}.{payload_b64}.{tampered_signature}"

    with pytest.raises(InvalidTokenError):
        verifier.verify(token=tampered)


def test_verify_rejects_wrong_issuer(rsa_keys):
    verifier = CognitoTokenVerifier(jwks=rsa_keys["jwks"], audience=AUDIENCE, issuer=ISSUER)
    token = _make_token(rsa_keys, iss="https://cognito-idp.ca-central-1.amazonaws.com/wrong-pool")

    with pytest.raises(InvalidTokenError):
        verifier.verify(token)


def test_refreshing_verifier_accepts_a_valid_token(rsa_keys):
    provider = JWKSProvider(
        region="ca-central-1",
        user_pool_id="ca-central-1_test",
        fetcher=lambda url: rsa_keys["jwks"],
    )
    verifier = RefreshingTokenVerifier(provider, audience=AUDIENCE, issuer=ISSUER)
    token = _make_token(rsa_keys)

    identity = verifier.verify(token)

    assert identity == VerifiedIdentity(sub="cognito-sub-123", email="alice@example.com")


def test_refreshing_verifier_rejects_an_invalid_token(rsa_keys):
    provider = JWKSProvider(
        region="ca-central-1",
        user_pool_id="ca-central-1_test",
        fetcher=lambda url: rsa_keys["jwks"],
    )
    verifier = RefreshingTokenVerifier(provider, audience=AUDIENCE, issuer=ISSUER)
    token = _make_token(rsa_keys, aud="some-other-client-id")

    with pytest.raises(InvalidTokenError):
        verifier.verify(token)


def test_fake_verifier_returns_preset_identity_regardless_of_token():
    identity = VerifiedIdentity(sub="fake-sub", email="fake@example.com")
    verifier = FakeTokenVerifier(identity)

    assert verifier.verify("any-token-value") == identity


def test_fake_verifier_raises_when_constructed_with_none():
    verifier = FakeTokenVerifier(None)

    with pytest.raises(InvalidTokenError):
        verifier.verify("any-token-value")
