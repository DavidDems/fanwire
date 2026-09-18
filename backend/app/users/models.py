"""SQLAlchemy 2.0 declarative models for users/: User and Follow.

Schema and rationale: wiki/CodeContext/Modules/0x01-users.md.
Every table uses a bigint identity primary key, never UUID, per
wiki/CodeContext/Modules/0x00-architecture.md "Cross-cutting conventions".

Per wiki/CodeContext/Modules/0x00-architecture.md "Connection rule", users/
may only reach into events/ through its Team table (a read-only FK target
for preferred_team_id) — it never queries/writes Team rows itself — and
into media/ via a real `ForeignKey("media.id")` on profile_picture_media_id
— it must not import from app.posts or either module's internal classes.

profile_picture_media_id deliberately does NOT import app.media.models.Media
(unlike the Team/User "real FK target" imports elsewhere in this codebase):
app.media.models already imports app.posts.models (for its own post_id FK),
and app.posts.models imports this module (app.users.models) for author_id
etc. An eager `from app.media.models import Media` here would close a real
3-module import cycle (users -> media -> posts -> users), which fails at
import time (verified: `ImportError: cannot import name 'User' from
partially initialized module 'app.users.models'`). The FK works correctly
without the class import — SQLAlchemy resolves the `"media.id"` string
against Base.metadata lazily, and every entry point that touches the ORM
(alembic/env.py, test conftest/fixtures) already imports app.media.models
directly before any mapper configuration or DDL runs.

Separately, users and media also form a circular *table* dependency now
(media.uploader_id -> users.id, users.profile_picture_media_id -> media.id)
— nothing to do with the Python import graph. `Base.metadata.create_all()`
needs a single linear table-creation order and can't find one across a
two-table FK cycle, raising `CircularDependencyError` (verified). The
profile_picture_media_id FK below is marked `use_alter=True`, which tells
SQLAlchemy to defer that one constraint to a post-create `ALTER TABLE`
instead of requiring it at `CREATE TABLE media` time — breaking the cycle.
The Alembic migration for this FK is a separate `ALTER TABLE ... ADD
CONSTRAINT` for the same reason.
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

# app.media.models.Media is NOT imported here — see module docstring for why
# (it would close a real users -> media -> posts -> users import cycle).


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
    # Real FK now that media/'s Media table exists. Media's class is
    # deliberately not imported into this module, and the constraint is
    # use_alter=True — see module docstring for both. See
    # wiki/CodeContext/Modules/0x01-users.md.
    profile_picture_media_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey(
            "media.id", use_alter=True, name="fk_users_profile_picture_media_id_media"
        ),
        nullable=True,
    )
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
