"""Cognito JWT verification behind a narrow interface — Dependency
Inversion (wiki/CodeContext/Standards/design-principles.md): callers depend
on TokenVerifier, never on CognitoTokenVerifier directly, so tests (and
app.users.dependencies) can inject FakeTokenVerifier and never hit real
Cognito. See wiki/CodeContext/Modules/0x01-users.md Security section:
"All writes ... require a Cognito token verified server-side on every
request ... never trusted based on client claims alone."

Cognito issues RS256 (RSA)-signed JWTs; this module never exercises the
ECDSA signing/verification path (see wiki/CodeContext/Modules/0x01-users.md
Security section on the `PYSEC-2026-1325`/`ecdsa` pip-audit ignore — that
reasoning holds as long as nothing here uses EC keys).
"""

from __future__ import annotations

import abc
from dataclasses import dataclass
from typing import Any

from jose import jwt
from jose.exceptions import JOSEError

from app.users.jwks import JWKSProvider


@dataclass(frozen=True)
class VerifiedIdentity:
    """The result of a successful token verification — just enough to
    identify the caller (`sub`) and, optionally, their email as Cognito
    reports it. Never carries the raw token or any unverified claim."""

    sub: str
    email: str | None = None


class InvalidTokenError(Exception):
    """Raised by any TokenVerifier.verify() on expired/malformed/bad-
    signature/wrong-audience tokens — the caller never needs to know which
    of those it was, only that the token is not to be trusted."""


class TokenVerifier(abc.ABC):
    """The one typed interface app.users.dependencies depends on. Concrete
    implementations: CognitoTokenVerifier (production), FakeTokenVerifier
    (tests)."""

    @abc.abstractmethod
    def verify(self, token: str) -> VerifiedIdentity:
        """Return the verified identity encoded in `token`, or raise
        InvalidTokenError on any failure."""


class CognitoTokenVerifier(TokenVerifier):
    """Verifies a Cognito-issued RS256 JWT against an injected JWKS.

    The JWKS (Cognito's public keys) is injected rather than fetched here —
    tests hand this a self-signed test JWKS with no HTTP call involved;
    fetching/caching the real JWKS from Cognito's well-known endpoint is a
    concern for whatever wires this up at the API boundary, not this class.
    """

    def __init__(self, jwks: dict[str, Any], *, audience: str, issuer: str) -> None:
        self._jwks = jwks
        self._audience = audience
        self._issuer = issuer

    def verify(self, token: str) -> VerifiedIdentity:
        try:
            key = self._matching_key(token)
            claims = jwt.decode(
                token,
                key,
                algorithms=["RS256"],
                audience=self._audience,
                issuer=self._issuer,
            )
        except JOSEError as exc:
            raise InvalidTokenError(str(exc)) from exc

        return VerifiedIdentity(sub=claims["sub"], email=claims.get("email"))

    def _matching_key(self, token: str) -> dict[str, Any]:
        # jwt.get_unverified_header itself raises JOSEError on a malformed
        # token — let that propagate to the except clause in verify().
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")
        for key in self._jwks.get("keys", []):
            if key.get("kid") == kid:
                return key
        raise InvalidTokenError(f"no matching JWK for kid={kid!r}")


class RefreshingTokenVerifier(TokenVerifier):
    """Wraps a JWKSProvider so the JWKS is re-fetched (respecting its TTL/
    cache) on every verify() call rather than pinned to a JWKS snapshot at
    construction time — handles Cognito's occasional key rotation without a
    process restart. Delegates the actual verification to a fresh
    CognitoTokenVerifier built from whatever JWKS get_jwks() currently
    returns (cheap: that's normally just a cache hit)."""

    def __init__(self, jwks_provider: JWKSProvider, *, audience: str, issuer: str) -> None:
        self._jwks_provider = jwks_provider
        self._audience = audience
        self._issuer = issuer

    def verify(self, token: str) -> VerifiedIdentity:
        jwks = self._jwks_provider.get_jwks()
        verifier = CognitoTokenVerifier(jwks, audience=self._audience, issuer=self._issuer)
        return verifier.verify(token)


class FakeTokenVerifier(TokenVerifier):
    """Test double for later phases/route tests. Constructed with a preset
    VerifiedIdentity (returned regardless of the token argument) or with
    None, in which case every verify() call raises InvalidTokenError —
    never exercises jose or any real key material."""

    def __init__(self, identity: VerifiedIdentity | None) -> None:
        self._identity = identity

    def verify(self, token: str) -> VerifiedIdentity:
        if self._identity is None:
            raise InvalidTokenError("FakeTokenVerifier configured to reject every token")
        return self._identity
