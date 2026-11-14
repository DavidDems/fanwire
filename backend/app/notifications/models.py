"""SQLAlchemy 2.0 declarative models for notifications/: Notification and
NotificationPreference.

Schema and rationale: wiki/CodeContext/Modules/0x05-notifications.md.
Every table uses a bigint identity primary key, never UUID, per
wiki/CodeContext/Modules/0x00-architecture.md "Cross-cutting conventions".

Per wiki/CodeContext/Modules/0x00-architecture.md "Connection rule",
notifications/ may only reach into users/ through its User table (real FK
targets for recipient_user_id/actor_user_id) -- it must not import from
app.posts/app.media/app.events, or either module's internal classes,
outside the one narrow read-only lookup documented in
app.notifications.consumer's module docstring.

`reference_id` implements wiki/CodeContext/Modules/0x05-notifications.md
"Open decisions" #1's recommendation as-is (now resolved, not a settled
alternative): a single nullable polymorphic column, validated at the
application layer (app.notifications.consumer), not a DB-level FK -- it
can't point at two different tables (users.id for `follow`, posts.id for
`reply`/`repost`).

`type` is stored as a native Postgres enum, same style as
app.media.models.MediaStatus -- SQLAlchemy's default Enum(...) stores each
member's *name* (e.g. "FOLLOW"), not its .value ("follow"), matching that
precedent exactly.
"""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Enum, ForeignKey, Identity, true
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db import Base
from app.users.models import User  # noqa: F401 -- real FK target for recipient/actor user ids


class NotificationType(enum.Enum):
    """Closed set per wiki/CodeContext/Modules/0x05-notifications.md
    business rules -- `like` is explicitly excluded, not a 4th value
    waiting to happen."""

    FOLLOW = "follow"
    REPLY = "reply"
    REPOST = "repost"


class Notification(Base):
    """One notification for `recipient_user_id`. Reads/writes are always
    scoped to the recipient -- see app.notifications.routes. Soft-delete via
    `cleared_at`, matching the soft-delete pattern already used for
    User/Post."""

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    recipient_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False, index=True
    )
    type: Mapped[NotificationType] = mapped_column(
        Enum(NotificationType, name="notification_type"), nullable=False
    )
    actor_user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    # Polymorphic by `type` -- see module docstring. No DB-level FK: it
    # points at users.id for `follow` and posts.id for `reply`/`repost`.
    reference_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Soft-delete marker for "clear notifications"; NULL = active.
    cleared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class NotificationPreference(Base):
    """One row per user, the only preference flag for v1 -- there is no
    in-app equivalent, in-app notifications cannot be disabled per business
    rule."""

    __tablename__ = "notification_preferences"

    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), primary_key=True)
    email_notifications_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )
