"""FastAPI dependency wiring for users/ auth.

get_current_identity is the actual boundary enforcement wiki/CodeContext/
Modules/0x01-users.md's Security section requires: "All writes ... require
a Cognito token verified server-side on every request ... never trusted
based on client claims alone." Client-side "am I logged in" checks are UX
only, never the boundary (wiki/CodeContext/Standards/design-principles.md
Security baseline).

Every route resolves its caller through one of three paths (USERS-003),
which differ only in how they treat a deactivated account (User.deleted_at
set):

- public read, get_optional_current_user: a deactivated caller is a guest
  (None), same as no Authorization header.
- active account, get_current_user (every write, private reads): a
  deactivated caller gets 403 {"detail": "account_deactivated"} -- a machine
  code the client branches on, distinct from the 404 for "no profile yet".
- own account, get_own_account (POST /users/me/recover, DELETE /users/me):
  the caller's own row whether or not it is deactivated.

All three query the row on every request, so a token issued before
deactivation can't outlive it. tests/test_route_auth.py enforces that every
write route is on the active path unless explicitly allowlisted.

The one exception to "a Cognito token" is the local load test (PERF-001,
perf/README.md): when Settings.perf_jwks_path is set -- which Settings only
allows with ENVIRONMENT exactly "perf" -- get_token_verifier verifies against
the JWKS file scripts/mint_perf_tokens.py wrote, with PERF_ISSUER and
PERF_AUDIENCE. It is the same CognitoTokenVerifier with every check intact;
only the key material and the expected iss/aud differ.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dependencies import get_session, get_settings
from app.settings import Settings
from app.users.auth import (
    CognitoTokenVerifier,
    InvalidTokenError,
    RefreshingTokenVerifier,
    TokenVerifier,
    VerifiedIdentity,
)
from app.users.jwks import JWKSProvider
from app.users.models import User

# The iss and aud of a perf ID token. Shared with scripts/mint_perf_tokens.py,
# which imports them from here, so the minted tokens and the verifier cannot
# drift apart. Deliberately not a Cognito issuer: a real pool's token never
# matches, and a perf token never matches a real pool.
PERF_ISSUER = "https://perf.fanwire.local/issuer"
PERF_AUDIENCE = "fanwire-perf"


def get_token_verifier(settings: Settings = Depends(get_settings)) -> TokenVerifier:
    """Indirection point (Dependency Inversion) so the concrete
    TokenVerifier is injectable/overridable — route tests override this via
    FastAPI's `app.dependency_overrides`, typically with FakeTokenVerifier,
    unchanged from before.

    The real default is a RefreshingTokenVerifier wired from Settings'
    Cognito fields (region, user pool, app client id) — see
    _default_token_verifier.

    When settings.perf_jwks_path is set (only possible with ENVIRONMENT
    exactly "perf", app.settings.Settings refuses it otherwise), it is
    instead a CognitoTokenVerifier over that local JWKS file, with
    PERF_ISSUER/PERF_AUDIENCE — see _perf_token_verifier. That path never
    constructs a JWKSProvider, so it never fetches anything over the network.
    """
    if settings.perf_jwks_path:
        return _perf_token_verifier(settings.perf_jwks_path)
    return _default_token_verifier(
        settings.cognito_region, settings.cognito_user_pool_id, settings.cognito_app_client_id
    )


@cache
def _default_token_verifier(region: str, user_pool_id: str, app_client_id: str) -> TokenVerifier:
    # Cached by the settings values themselves (not by the Settings
    # instance) so the same Cognito config always resolves to the same
    # JWKSProvider/RefreshingTokenVerifier rather than rebuilding one per
    # call — get_settings() itself is already cached, but this stays
    # correct even if that ever changes.
    provider = JWKSProvider(region=region, user_pool_id=user_pool_id)
    issuer = f"https://cognito-idp.{region}.amazonaws.com/{user_pool_id}"
    return RefreshingTokenVerifier(provider, audience=app_client_id, issuer=issuer)


@cache
def _perf_token_verifier(jwks_path: str) -> TokenVerifier:
    # Cached by path, like _default_token_verifier: the file is read once per
    # process (on the first verify, which is why perf/run.ps1 mints before it
    # brings the backend up), and a different path gets its own verifier.
    jwks = json.loads(Path(jwks_path).read_text(encoding="utf-8"))
    return CognitoTokenVerifier(jwks, audience=PERF_AUDIENCE, issuer=PERF_ISSUER)


def get_current_identity(
    request: Request,
    token_verifier: TokenVerifier = Depends(get_token_verifier),
) -> VerifiedIdentity:
    """Requires `Authorization: Bearer <token>`, verifies it via the
    injected TokenVerifier, and returns the resulting VerifiedIdentity.
    Fails fast at the boundary (per wiki/CodeContext/Standards/
    design-principles.md "Fail fast" / "Validate at boundaries only") with
    a 401 on anything wrong — missing header, wrong scheme, or a token the
    verifier rejects.
    """
    authorization = request.headers.get("Authorization")
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Authorization header"
        )

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Malformed Authorization header"
        )

    try:
        return token_verifier.verify(token)
    except InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        ) from exc


def get_own_account(
    identity: VerifiedIdentity = Depends(get_current_identity),
    session: Session = Depends(get_session),
) -> User:
    """The own-account path: resolves the verified token's `sub` to the
    caller's User row whether or not it is deactivated -- only the routes
    acting on the caller's own account status (recover, deactivate) depend
    on this. 404s if no User row exists for this cognito_sub; 401s come from
    get_current_identity unchanged.
    """
    user = session.scalar(select(User).where(User.cognito_sub == identity.sub))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User profile not found")
    return user


def get_current_user(user: User = Depends(get_own_account)) -> User:
    """The active-account path: the caller's User row, refused with 403
    "account_deactivated" if it is deactivated (not 404 -- the client must
    tell "deactivated, offer recovery" apart from "no profile yet, offer
    creation"). 404s via get_own_account if no User row exists for this
    cognito_sub -- e.g. a Cognito-confirmed signup that never completed
    POST /users. Callers needing the internal User.id (every write route)
    depend on this instead of get_current_identity directly.
    """
    if user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="account_deactivated")
    return user


def get_optional_current_user(
    request: Request,
    token_verifier: TokenVerifier = Depends(get_token_verifier),
    session: Session = Depends(get_session),
) -> User | None:
    """For the guest-vs-authenticated feed/ (a later unit): no Authorization
    header at all is a legitimate guest request, so this returns None
    rather than raising. A *present but invalid* token is never silently
    downgraded to guest, though -- that would let a client with an expired/
    forged token quietly fall back to public content instead of finding out
    its session is dead, so this still 401s in that case, same as
    get_current_identity. A valid token with no matching User row (an
    otherwise-valid Cognito account that never completed POST /users) also
    returns None -- there's no profile to attach, but it's not this
    dependency's job to force a 404 the way get_current_user does for
    write-path routes that require one. A deactivated caller's valid token
    returns None too (a guest), never get_current_user's 403.

    Deliberately duplicates get_current_identity's header-parsing (rather
    than calling it directly) because get_current_identity always raises on
    a missing header -- there's no way to call it and get None back for
    that one case without changing its behavior for every existing caller.
    """
    authorization = request.headers.get("Authorization")
    if not authorization:
        return None

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Malformed Authorization header"
        )

    try:
        identity = token_verifier.verify(token)
    except InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        ) from exc

    return session.scalar(
        select(User).where(User.cognito_sub == identity.sub, User.deleted_at.is_(None))
    )
