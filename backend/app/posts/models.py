"""SQLAlchemy 2.0 declarative models for posts/: Post, PostLike,
EventMention, and Report.

Schema and rationale: wiki/CodeContext/Modules/0x03-posts.md.
Every table uses a bigint identity primary key, never UUID, per
wiki/CodeContext/Modules/0x00-architecture.md "Cross-cutting conventions".

Per wiki/CodeContext/Modules/0x00-architecture.md "Connection rule", posts/
may only reach into users/ through its User table (a real FK target for
author_id/user_id/reporter_id) and into events/ through its tables as FK
targets only (EventMention.game_id, and Post's data-link columns naming
games, player_game_stats and players by string) — it never imports either
module's internal classes for a read.

No separate "quote repost" flag: `is_repost=True` with non-empty `text` is
a quote-repost, `is_repost=True` with null/empty `text` is a plain repost —
settled reading of the wiki's "repost" business rule, not re-derived here.

`Post.reported` is never set directly by application code outside
app.posts.service (a later unit) — this module only defines the column.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Computed,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    PrimaryKeyConstraint,
    Text,
    UniqueConstraint,
    false,
)
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db import Base
from app.events.models import Game  # noqa: F401 — registers events/' FK targets on Base.metadata
from app.posts.data_link import DataLink
from app.users.models import User  # noqa: F401 — real FK target for author_id/user_id/reporter_id


class Post(Base):
    """Original posts, replies, and reposts as one table, distinguished by
    flags — not three tables or a subclass per kind. Never edited (no
    `updated_at`, no "edit a post" business rule), but its owner may
    soft-delete it (POSTS-004): `deleted_at` is set once, by
    app.posts.service.delete_post, and every read leaves the post out from
    then on. Nothing cascades. See wiki/CodeContext/Modules/0x03-posts.md."""

    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    author_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_reply: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    parent_post_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("posts.id"), nullable=True
    )
    is_repost: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    original_post_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("posts.id"), nullable=True
    )
    # Set true only as a side effect of the first Report row for this post
    # (app.posts.service, a later unit) — never set directly from a client
    # request. This model only defines the column.
    reported: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # The owner's soft delete (POSTS-004); null for a live post. Read only
    # through app.posts.service's visibility predicate and deleted_post_ids.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # The post's one sports-data attachment (POSTS-005): at most one id set,
    # none on a reply, the scope exactly with linked_player_id (the CHECKs
    # below). Written and read only through app.posts.data_link.DataLink.
    # No index: nothing queries by them yet.
    linked_game_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("games.id"), nullable=True
    )
    linked_player_game_stats_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("player_game_stats.id"), nullable=True
    )
    linked_player_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("players.id"), nullable=True
    )
    linked_player_scope: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Full-text search index for search/'s post search
    # (wiki/CodeContext/Modules/0x07-search.md) -- search/ owns no tables,
    # so this column (and its GIN index below) lives here, the schema's
    # single source of truth, per 0x00-architecture.md's Connection rule.
    # Generated/persisted (STORED): Postgres keeps it current on every
    # INSERT/UPDATE, no trigger to maintain.
    search_vector: Mapped[str] = mapped_column(
        TSVECTOR,
        Computed("to_tsvector('english', coalesce(text, ''))", persisted=True),
        nullable=True,
    )

    __table_args__ = (
        CheckConstraint(
            "NOT is_reply OR parent_post_id IS NOT NULL",
            name="ck_posts_reply_requires_parent",
        ),
        CheckConstraint(
            "NOT is_repost OR original_post_id IS NOT NULL",
            name="ck_posts_repost_requires_original",
        ),
        CheckConstraint(
            "num_nonnulls(linked_game_id, linked_player_game_stats_id, linked_player_id) <= 1",
            name="ck_posts_one_data_link",
        ),
        CheckConstraint(
            "NOT is_reply OR (linked_game_id IS NULL AND linked_player_game_stats_id IS NULL "
            "AND linked_player_id IS NULL AND linked_player_scope IS NULL)",
            name="ck_posts_no_data_link_on_reply",
        ),
        CheckConstraint(
            "(linked_player_id IS NULL) = (linked_player_scope IS NULL)",
            name="ck_posts_player_scope_pairing",
        ),
        CheckConstraint(
            "linked_player_scope IS NULL OR linked_player_scope IN ('regular', 'playoffs')",
            name="ck_posts_player_scope_values",
        ),
        # Both self-referential FKs indexed for thread-traversal reads, per
        # wiki/CodeContext/Modules/0x03-posts.md "AWS mapping".
        Index("ix_posts_parent_post_id", "parent_post_id"),
        Index("ix_posts_original_post_id", "original_post_id"),
        Index("ix_posts_search_vector", "search_vector", postgresql_using="gin"),
        # app.posts.moderation.PostCountRateLimiter counts one author's
        # recent posts: an index range scan, not a table scan.
        Index("ix_posts_author_id_created_at", "author_id", "created_at"),
    )

    @property
    def data_link(self) -> DataLink | None:
        """The attachment the link columns store, or None (read by
        app.posts.schemas.PostOut)."""
        return DataLink.from_columns(
            linked_game_id=self.linked_game_id,
            linked_player_game_stats_id=self.linked_player_game_stats_id,
            linked_player_id=self.linked_player_id,
            linked_player_scope=self.linked_player_scope,
        )


class PostLike(Base):
    """Join-table state: who-liked-what. No `like_count` on Post — counts
    are derived from this table, never duplicated. See
    wiki/CodeContext/Modules/0x03-posts.md."""

    __tablename__ = "post_likes"

    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    post_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("posts.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        # Composite PK doubles as the "one like per user per post"
        # uniqueness constraint — same pattern as app.users.models.Follow.
        PrimaryKeyConstraint("user_id", "post_id"),
    )


class EventMention(Base):
    """Join table linking a Post to a Game row via a parsed mention token
    (e.g. `#GameId123`, `$LAL`). `Game` is owned by events/ — referenced
    only by FK, never by importing events/'s internal classes. See
    wiki/CodeContext/Modules/0x03-posts.md."""

    __tablename__ = "event_mentions"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    post_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("posts.id"), nullable=False)
    game_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("games.id"), nullable=False)
    # The matched text as authored, kept for display/audit — treated
    # strictly as data for a parameterized lookup, never eval'd or used to
    # build dynamic SQL/templates.
    raw_token: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Report(Base):
    """The only reporting-related table for v1 — no justification text,
    no status/workflow field. `Post.reported` is set true on the first
    Report row for a post and never unset (app.posts.service, a later
    unit). See wiki/CodeContext/Modules/0x03-posts.md."""

    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    post_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("posts.id"), nullable=False)
    reporter_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        # One report per user per post; re-submitting is a service-layer
        # no-op, not a duplicate row.
        UniqueConstraint("post_id", "reporter_id", name="uq_reports_post_reporter"),
    )
