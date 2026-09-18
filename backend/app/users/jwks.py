"""Fetches and caches a Cognito User Pool's JWKS (JSON Web Key Set) —
the public keys `CognitoTokenVerifier` (app.users.auth) verifies tokens
against.

See wiki/CodeContext/Modules/0x01-users.md Security section: Cognito
issues RS256-signed JWTs, verified server-side on every request. The JWKS
itself is not injected here (unlike CognitoTokenVerifier's constructor,
which takes it directly for tests) — this module owns fetching it from
Cognito's well-known endpoint for the production wiring, per
app.users.auth.CognitoTokenVerifier's own docstring ("fetching/caching the
real JWKS ... is a concern for whatever wires this up at the API
boundary").
"""

from __future__ import annotations

import json
import time
import urllib.request
from collections.abc import Callable
from typing import Any


def _fetch_over_https(url: str) -> dict[str, Any]:
    # Real production fetcher. Never exercised in tests — every test
    # injects its own `fetcher`, per this module's Dependency Inversion
    # (see class docstring). `url` is always the well-known JWKS endpoint
    # this class itself builds from `region`/`user_pool_id`, never
    # user-supplied input.
    with urllib.request.urlopen(url, timeout=5) as response:
        data = json.load(response)
    return dict(data)


class JWKSProvider:
    """Fetches a Cognito User Pool's JWKS over HTTPS from its well-known
    endpoint (`https://cognito-idp.{region}.amazonaws.com/{user_pool_id}/.well-known/jwks.json`)
    and caches it in-memory for `ttl_seconds` (default 3600) — Cognito's
    JWKS rotates rarely, so a short-TTL re-fetch bounds staleness without
    hitting the endpoint on every request.

    The actual HTTP fetch is injected as `fetcher: Callable[[str], dict]`
    (Dependency Inversion, same style as MalwareScanner/TokenVerifier in
    this codebase) so tests never make a real network call — only the
    real default fetcher (used in production) does. No `httpx`/`requests`
    runtime dependency is added for this — backend/pyproject.toml keeps
    runtime deps lean (this ships in the Lambda image) and httpx is
    dev-only there (TestClient use) — so the default fetcher uses the
    stdlib `urllib.request`.
    """

    def __init__(
        self,
        *,
        region: str,
        user_pool_id: str,
        ttl_seconds: int = 3600,
        fetcher: Callable[[str], dict[str, Any]] | None = None,
    ) -> None:
        self._url = (
            f"https://cognito-idp.{region}.amazonaws.com/{user_pool_id}/.well-known/jwks.json"
        )
        self._ttl_seconds = ttl_seconds
        self._fetcher = fetcher or _fetch_over_https
        self._cached: dict[str, Any] | None = None
        self._fetched_at: float | None = None

    def get_jwks(self) -> dict[str, Any]:
        """Returns the cached JWKS, fetching it first on the first call or
        again once `ttl_seconds` has elapsed since the last fetch."""
        now = time.time()
        if (
            self._cached is None
            or self._fetched_at is None
            or now - self._fetched_at >= self._ttl_seconds
        ):
            self._cached = self._fetcher(self._url)
            self._fetched_at = now
        return self._cached
