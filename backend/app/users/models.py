"""SQLAlchemy 2.0 declarative models for users/: User and Follow.

Schema and rationale: wiki/CodeContext/Modules/0x01-users.md.
Every table uses a bigint identity primary key, never UUID, per
wiki/CodeContext/Modules/0x00-architecture.md "Cross-cutting conventions".

Per wiki/CodeContext/Modules/0x00-architecture.md "Connection rule", users/
may only reach into events/ through its Team table (a read-only FK target
for preferred_team_id) — it never queries/writes Team rows itself, and it
must not import from media/ or posts/, neither of which exists yet.
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    PrimaryKeyConstraint,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db import Base
from app.events.models import Team  # noqa: F401 — read-only FK target, see module docstring


class User(Base):
    """Local profile projection keyed by `cognito_sub`. Cognito is the sole
    owner of credentials/MFA/token issuance — no password/email column
    exists here, see wiki/CodeContext/Modules/0x01-users.md."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    cognito_sub: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    username: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # PII, required at row-creation time for this pass. *When* it's collected
    # in a signup flow (Cognito registration vs. a later profile step) is a
    # still-open UX question this schema doesn't need to answer — see
    # wiki/CodeContext/Modules/0x01-users.md "Open decisions".
    date_of_birth: Mapped[date] = mapped_column(Date, nullable=False)
    preferred_team_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("teams.id"), nullable=True
    )
    # Deliberately a plain column, NOT a ForeignKey, for now: media/ (which
    # owns Media) doesn't exist yet in this branch. This is a two-step
    # migration — the real `ForeignKey("media.id")` constraint gets added
    # once media/'s Media table lands — not an oversight. See
    # wiki/CodeContext/Modules/0x01-users.md.
    profile_picture_media_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
    # Soft-delete marker; null = active row. Never a bare boolean, so *when*
    # a row was deactivated is explicit rather than inferred — see
    # wiki/CodeContext/Modules/0x01-users.md Design principles tie-ins.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Follow(Base):
    """Join-table state: who-follows-whom. No `deleted_at` — unfollow is a
    real row delete, not a soft-delete, per wiki/CodeContext/Modules/
    0x01-users.md."""

    __tablename__ = "follows"

    follower_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    followed_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        # Composite PK doubles as the "follow a given user at most once"
        # uniqueness constraint — no separate UniqueConstraint needed.
        PrimaryKeyConstraint("follower_user_id", "followed_user_id"),
        CheckConstraint(
            "follower_user_id <> followed_user_id", name="ck_follows_no_self_follow"
        ),
    )
