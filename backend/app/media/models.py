"""SQLAlchemy 2.0 declarative model for media/: Media.

Schema and rationale: wiki/CodeContext/Modules/0x04-media.md.
Every table uses a bigint identity primary key, never UUID, per
wiki/CodeContext/Modules/0x00-architecture.md "Cross-cutting conventions".

Per wiki/CodeContext/Modules/0x00-architecture.md "Connection rule", media/
may only reach into users/ through its User table (a real FK target for
uploader_id) — it must not import from app.events or app.posts (posts/
doesn't exist yet).

`Media.status` must only ever be mutated via app.media.state.transition —
see that module's docstring for why (State pattern, GoF tie-in in
wiki/CodeContext/Modules/0x04-media.md).
"""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, Identity, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db import Base
from app.users.models import User  # noqa: F401 — real FK target for uploader_id


class MediaStatus(enum.Enum):
    """Linear state chain: UPLOADED -> SCANNING -> PROCESSED | REJECTED.
    See app.media.state for the State pattern enforcing legal transitions."""

    UPLOADED = "uploaded"
    SCANNING = "scanning"
    PROCESSED = "processed"
    REJECTED = "rejected"


class Media(Base):
    """An uploaded image and its pipeline state. RDS-tracked system of
    record even though the bytes themselves live in S3 — this row is the
    only place that links a User, an optional Post, and the object's
    current pipeline state. See wiki/CodeContext/Modules/0x04-media.md."""

    __tablename__ = "media"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    uploader_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    # Deliberately a plain column, NOT a ForeignKey, for now: posts/ (which
    # will own Post) doesn't exist yet in this branch. Same deferred-FK
    # precedent as User.profile_picture_media_id -> media.id. The real
    # `ForeignKey("posts.id")` constraint gets added once posts/'s Post
    # table lands in Phase 2. Null while uploaded-but-unattached (compose
    # flow uploads before the post exists, or a profile-picture use); set
    # once attached to a post. See wiki/CodeContext/Modules/0x04-media.md.
    post_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Key in the private quarantine bucket. Present from Uploaded through
    # Scanning; cleared once the object is deleted post-processing (either
    # on successful publish or on fail-closed rejection cleanup) — see
    # app.media.pipeline.
    s3_key_quarantine: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Key in the public media bucket. Null until Processed.
    s3_key_thumbnail: Mapped[str | None] = mapped_column(Text, nullable=True)
    s3_key_public: Mapped[str | None] = mapped_column(Text, nullable=True)
    # The verified type from actually opening/parsing the file with Pillow,
    # never the client-declared Content-Type or file extension — see
    # wiki/CodeContext/Standards/security.md "User-generated content".
    mime_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Unknown until the object exists in the quarantine bucket and is
    # observed there (validate_type sets this from the actual S3 object,
    # never a client-declared value).
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    status: Mapped[MediaStatus] = mapped_column(
        Enum(MediaStatus, name="media_status"),
        nullable=False,
        default=MediaStatus.UPLOADED,
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
