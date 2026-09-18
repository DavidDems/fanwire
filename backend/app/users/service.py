"""Plain functions operating on an injected Session — no service class, no
hidden session/state (KISS, wiki/CodeContext/Standards/design-principles.md).

See wiki/CodeContext/Modules/0x01-users.md for the User/Follow behavior
these implement.
"""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass
from datetime import UTC, date, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.eventbus import PostEventBus
from app.events.models import Team

# Per wiki/CodeContext/Modules/0x00-architecture.md "Connection rule", this
# is the one place users/ reads Media directly -- the same narrow,
# documented cross-module read app.posts.facade.PublishPostFacade already
# does for the same reason (confirming an attached/referenced Media row is
# Processed before letting it be used). users/ only ever stores the
# resulting Media.id (wiki/CodeContext/Modules/0x01-users.md Security
# section) -- it never mutates Media.status, only reads it via the
# MediaStatus enum.
from app.media.models import Media, MediaStatus
from app.users.models import Follow, User

USER_FOLLOWED = "UserFollowed"


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


class InvalidPreferredTeamError(ValueError):
    """Raised by update_profile when preferred_team_id doesn't reference an
    existing Team row. 422, not 409 (judgment call -- see
    wiki/CodeContext/Modules/0x01-users.md): POST /users' generic 409
    folds duplicate cognito_sub/username/bad team into one
    IntegrityError-driven response because create_user has nothing else to
    pre-check. update_profile already does an explicit pre-check for
    profile_picture_media_id (no DB constraint could enforce "owned by the
    caller and Processed"), so validating preferred_team_id the same
    explicit way and reporting both failures as 422 (unprocessable
    request content) is simpler than splitting one endpoint's validation
    errors across two status codes."""


class InvalidProfilePictureError(ValueError):
    """Raised by update_profile when profile_picture_media_id doesn't
    resolve to a Media row uploaded by the caller with status
    MediaStatus.PROCESSED."""


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
    user = session.scalar(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
    if user is None:
        raise UserNotFoundError(f"No active user with id={user_id!r}")

    user.deleted_at = datetime.now(UTC)
    session.commit()


def follow(
    session: Session, *, event_bus: PostEventBus, follower_user_id: int, followed_user_id: int
) -> Follow:
    """Create a Follow row. Raises SelfFollowError before touching the DB
    if the ids are equal, and AlreadyFollowingError (checked first, for a
    clearer error than a raw IntegrityError — "already following" is an
    expected/common case) if the pair already exists.

    Publishes UserFollowed on event_bus after the commit — app.eventbus.
    PostEventBus is the app's one domain event bus, not posts/-exclusive
    despite the name (wiki/CodeContext/Modules/0x00-architecture.md
    "Cross-cutting conventions").
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

    event_bus.publish(
        USER_FOLLOWED,
        {"follower_user_id": follower_user_id, "followed_user_id": followed_user_id},
    )
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
        raise NotFollowingError(f"User {follower_user_id!r} is not following {followed_user_id!r}")

    session.delete(row)
    session.commit()


def update_profile(
    session: Session,
    user_id: int,
    *,
    fields_set: set[str],
    description: str | None = None,
    preferred_team_id: int | None = None,
    profile_picture_media_id: int | None = None,
) -> User:
    """Apply only the fields present in `fields_set` (pass
    `UpdateMeRequest.model_fields_set`) to the User with `user_id` --
    model_fields_set semantics: a field absent from the request body is
    left untouched, a field present with an explicit `null` clears it.
    `username`/`date_of_birth` aren't parameters here at all -- neither is
    editable via this function.

    Takes `user_id` rather than a `User` instance (unlike follow()/
    unfollow(), which take ids already) and re-fetches within `session` --
    same reasoning as soft_delete_user: the caller's User row may have been
    loaded in a different session (e.g. get_current_user's dependency
    caching in production vs. a route test overriding get_current_user with
    a detached instance), and mutating+committing a detached object bound
    to the wrong session wouldn't reliably persist.

    Raises InvalidPreferredTeamError / InvalidProfilePictureError -- see
    those classes for the 422 status-code judgment call -- before any
    field is applied, so a rejected update never partially applies.
    """
    user = session.scalar(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
    if user is None:
        raise UserNotFoundError(f"No active user with id={user_id!r}")

    if (
        "preferred_team_id" in fields_set
        and preferred_team_id is not None
        and session.get(Team, preferred_team_id) is None
    ):
        raise InvalidPreferredTeamError(f"No Team with id={preferred_team_id!r}")

    if "profile_picture_media_id" in fields_set and profile_picture_media_id is not None:
        media = session.get(Media, profile_picture_media_id)
        if (
            media is None
            or media.uploader_id != user_id
            or media.status is not MediaStatus.PROCESSED
        ):
            raise InvalidProfilePictureError(
                f"Media id={profile_picture_media_id!r} is not a Processed upload "
                "owned by this user"
            )

    if "description" in fields_set:
        user.description = description
    if "preferred_team_id" in fields_set:
        user.preferred_team_id = preferred_team_id
    if "profile_picture_media_id" in fields_set:
        user.profile_picture_media_id = profile_picture_media_id

    session.commit()
    return user


def followed_user_ids(session: Session, user_id: int) -> list[int]:
    """The ids of every user `user_id` follows. Public read helper (per
    wiki/CodeContext/Modules/0x00-architecture.md "Connection rule") for
    other modules (feed/, search/) to call instead of querying the Follow
    table directly. Reused by GET /users/me/following."""
    return list(
        session.scalars(
            select(Follow.followed_user_id).where(Follow.follower_user_id == user_id)
        ).all()
    )


@dataclass(frozen=True)
class PublicProfile:
    """The subset of a User row other modules (feed/, search/) may read
    through this module's public interface -- never the ORM row itself, per
    wiki/CodeContext/Modules/0x00-architecture.md "Connection rule"."""

    id: int
    username: str
    profile_picture_media_id: int | None


def get_public_profiles(session: Session, user_ids: Collection[int]) -> dict[int, PublicProfile]:
    """Batch lookup of public profile fields, keyed by id, for other
    modules to call instead of querying the User table directly.
    Soft-deleted users are excluded from the result entirely (never
    surfaced past this module)."""
    if not user_ids:
        return {}

    rows = session.scalars(
        select(User).where(User.id.in_(user_ids), User.deleted_at.is_(None))
    ).all()
    return {
        row.id: PublicProfile(
            id=row.id,
            username=row.username,
            profile_picture_media_id=row.profile_picture_media_id,
        )
        for row in rows
    }


def follower_count(session: Session, user_id: int) -> int:
    """Number of active (non-soft-deleted) users following user_id. Computed
    with a simple count query, no denormalized counter column (YAGNI) --
    wiki/CodeContext/Modules/0x01-users.md."""
    return (
        session.scalar(
            select(func.count())
            .select_from(Follow)
            .join(User, User.id == Follow.follower_user_id)
            .where(Follow.followed_user_id == user_id, User.deleted_at.is_(None))
        )
        or 0
    )


def following_count(session: Session, user_id: int) -> int:
    """Number of active (non-soft-deleted) users user_id follows. See
    follower_count."""
    return (
        session.scalar(
            select(func.count())
            .select_from(Follow)
            .join(User, User.id == Follow.followed_user_id)
            .where(Follow.follower_user_id == user_id, User.deleted_at.is_(None))
        )
        or 0
    )
