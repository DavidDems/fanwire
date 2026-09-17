"""Tests for app.users.jwks.JWKSProvider, per AGENTS.md TDD workflow.
Written before app/users/jwks.py exists.

The real HTTP fetch is injected (Dependency Inversion, same style as
MalwareScanner/TokenVerifier elsewhere in this codebase) so this never
makes a real network call — only the production default fetcher does,
and nothing here exercises it.
"""

from datetime import timedelta

from freezegun import freeze_time

from app.users.jwks import JWKSProvider

REGION = "us-east-1"
USER_POOL_ID = "us-east-1_test123"


def _fake_fetcher(calls: list[str], jwks: dict):
    def _fetch(url: str) -> dict:
        calls.append(url)
        return jwks

    return _fetch


def test_get_jwks_fetches_on_first_call():
    calls: list[str] = []
    jwks = {"keys": [{"kid": "abc"}]}
    provider = JWKSProvider(
        region=REGION, user_pool_id=USER_POOL_ID, fetcher=_fake_fetcher(calls, jwks)
    )

    result = provider.get_jwks()

    assert result == jwks
    assert calls == [
        f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}/.well-known/jwks.json"
    ]


def test_get_jwks_does_not_refetch_before_ttl_elapses():
    calls: list[str] = []
    jwks = {"keys": [{"kid": "abc"}]}

    with freeze_time("2026-01-01 00:00:00"):
        provider = JWKSProvider(
            region=REGION,
            user_pool_id=USER_POOL_ID,
            ttl_seconds=3600,
            fetcher=_fake_fetcher(calls, jwks),
        )

        provider.get_jwks()
        provider.get_jwks()

        assert len(calls) == 1


def test_get_jwks_refetches_after_ttl_elapses():
    calls: list[str] = []
    jwks = {"keys": [{"kid": "abc"}]}

    with freeze_time("2026-01-01 00:00:00") as frozen:
        provider = JWKSProvider(
            region=REGION,
            user_pool_id=USER_POOL_ID,
            ttl_seconds=3600,
            fetcher=_fake_fetcher(calls, jwks),
        )

        provider.get_jwks()
        assert len(calls) == 1

        frozen.tick(delta=timedelta(seconds=3601))
        provider.get_jwks()

        assert len(calls) == 2
