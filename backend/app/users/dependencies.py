"""FastAPI dependency wiring for users/ auth.

get_current_identity is the actual boundary enforcement wiki/CodeContext/
Modules/0x01-users.md's Security section requires: "All writes ... require
a Cognito token verified server-side on every request ... never trusted
based on client claims alone." Client-side "am I logged in" checks are UX
only, never the boundary (wiki/CodeContext/Standards/design-principles.md
Security baseline).
"""

from __future__ import annotations

from functools import cache

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dependencies import get_session, get_settings
from app.settings import Settings
from app.users.auth import (
    InvalidTokenError,
    RefreshingTokenVerifier,
    TokenVerifier,
    VerifiedIdentity,
)
from app.users.jwks import JWKSProvider
from app.users.models import User


def get_token_verifier(settings: Settings = Depends(get_settings)) -> TokenVerifier:
    """Indirection point (Dependency Inversion) so the concrete
    TokenVerifier is injectable/overridable — route tests override this via
    FastAPI's `app.dependency_overrides`, typically with FakeTokenVerifier,
    unchanged from before.

    The real default is a RefreshingTokenVerifier wired from Settings'
    Cognito fields (region, user pool, app client id) — see
    _default_token_verifier.
    """
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


def get_current_user(
    identity: VerifiedIdentity = Depends(get_current_identity),
    session: Session = Depends(get_session),
) -> User:
    """Resolves the verified token's `sub` to this app's local User row.
    404s (not 401 — the token itself is valid, there's just no profile yet)
    if no active User exists for this cognito_sub — e.g. a Cognito-confirmed
    signup that never completed POST /users. Callers needing the internal
    User.id (follow/unfollow, soft-delete-self) depend on this instead of
    get_current_identity directly.
    """
    user = session.scalar(
        select(User).where(User.cognito_sub == identity.sub, User.deleted_at.is_(None))
    )
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User profile not found")
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
    write-path routes that require one.

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
