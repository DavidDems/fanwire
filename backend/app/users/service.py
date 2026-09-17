"""Plain functions operating on an injected Session — no service class, no
hidden session/state (KISS, wiki/CodeContext/Standards/design-principles.md).

See wiki/CodeContext/Modules/0x01-users.md for the User/Follow behavior
these implement.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.users.models import Follow, User


class UserNotFoundError(ValueError):
    """Raised by soft_delete_user when the id doesn't resolve to an active
    (not already soft-deleted) User row. Fail fast, per
    wiki/CodeContext/Standards/design-principles.md — soft-deleting twice is
    a boundary error, not a silent no-op."""


class SelfFollowError(ValueError):
    """Raised by follow() when follower_user_id == followed_user_id."""


class AlreadyFollowingError(ValueError):
    """Raised by follow() when the (follower, followed) pair already
    exists."""


class NotFollowingError(ValueError):
    """Raised by unfollow() when the (follower, followed) pair doesn't
    exist."""


def create_user(
    session: Session,
    *,
    cognito_sub: str,
    username: str,
    date_of_birth: date,
    description: str | None = None,
    preferred_team_id: int | None = None,
) -> User:
    """Persist and return a new User row. A duplicate cognito_sub/username
    is left to surface as IntegrityError — the DB unique constraint is the
    source of truth, and a pre-check-then-insert here would just be a TOCTOU
    race (wiki/CodeContext/Standards/design-principles.md "Single source of
    truth")."""
    user = User(
        cognito_sub=cognito_sub,
        username=username,
        date_of_birth=date_of_birth,
        description=description,
        preferred_team_id=preferred_team_id,
    )
    session.add(user)
    session.commit()
    return user


def soft_delete_user(session: Session, user_id: int) -> None:
    """Set deleted_at on the given User. Fails fast with UserNotFoundError
    if the user doesn't exist or is already soft-deleted — see
    UserNotFoundError."""
    user = session.scalar(
        select(User).where(User.id == user_id, User.deleted_at.is_(None))
    )
    if user is None:
        raise UserNotFoundError(f"No active user with id={user_id!r}")

    user.deleted_at = datetime.now(UTC)
    session.commit()


def follow(session: Session, *, follower_user_id: int, followed_user_id: int) -> Follow:
    """Create a Follow row. Raises SelfFollowError before touching the DB
    if the ids are equal, and AlreadyFollowingError (checked first, for a
    clearer error than a raw IntegrityError — "already following" is an
    expected/common case) if the pair already exists.

    Does NOT publish any event: posts/'s PostEventBus doesn't exist until
    Phase 2, so that wiring is out of scope here — same precedent as
    app.events.ingestion's match_to_mentions/publish no-ops.
    """
    if follower_user_id == followed_user_id:
        raise SelfFollowError("A user cannot follow themselves")

    existing = session.scalar(
        select(Follow).where(
            Follow.follower_user_id == follower_user_id,
            Follow.followed_user_id == followed_user_id,
        )
    )
    if existing is not None:
        raise AlreadyFollowingError(
            f"User {follower_user_id!r} is already following {followed_user_id!r}"
        )

    row = Follow(follower_user_id=follower_user_id, followed_user_id=followed_user_id)
    session.add(row)
    session.commit()
    return row


def unfollow(session: Session, *, follower_user_id: int, followed_user_id: int) -> None:
    """Hard-delete the Follow row — unfollow is a real delete, no
    soft-delete on Follow (wiki/CodeContext/Modules/0x01-users.md). Raises
    NotFollowingError if the pair doesn't exist."""
    row = session.scalar(
        select(Follow).where(
            Follow.follower_user_id == follower_user_id,
            Follow.followed_user_id == followed_user_id,
        )
    )
    if row is None:
        raise NotFollowingError(
            f"User {follower_user_id!r} is not following {followed_user_id!r}"
        )

    session.delete(row)
    session.commit()
