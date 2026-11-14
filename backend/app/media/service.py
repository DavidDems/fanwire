"""Plain functions operating on an injected Session -- no service class, no
hidden session/state (KISS, wiki/CodeContext/Standards/design-principles.md,
matching app.users.service/app.posts.service's exact style).

processed_media_for_posts is media/'s public read interface for feed/ (a
later unit, per wiki/CodeContext/Modules/0x06-feed.md's Connection rule):
feed/ owns no tables of its own, so it reads Media through here instead of
querying app.media.models directly.
"""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.media.models import Media, MediaStatus


@dataclass(frozen=True)
class MediaView:
    """The subset of a Media row other modules (feed/, search/) may read
    through this module's public interface -- never the ORM row itself, per
    wiki/CodeContext/Modules/0x00-architecture.md "Connection rule". Same
    shape/reasoning as app.users.service.PublicProfile."""

    id: int
    s3_key_public: str | None
    s3_key_thumbnail: str | None


def processed_media_for_posts(
    session: Session, post_ids: Collection[int]
) -> dict[int, list[MediaView]]:
    """Batch lookup of a page's attached media, keyed by post id, Processed
    status only -- a still-scanning or rejected upload is never surfaced
    past this module. A post with no Processed media is absent from the
    result entirely. Ordered by Media.id for deterministic output."""
    if not post_ids:
        return {}

    rows = session.scalars(
        select(Media)
        .where(Media.post_id.in_(post_ids), Media.status == MediaStatus.PROCESSED)
        .order_by(Media.id)
    ).all()

    result: dict[int, list[MediaView]] = {}
    for row in rows:
        assert row.post_id is not None  # the query's `post_id IN (...)` excludes NULL
        result.setdefault(row.post_id, []).append(
            MediaView(
                id=row.id,
                s3_key_public=row.s3_key_public,
                s3_key_thumbnail=row.s3_key_thumbnail,
            )
        )
    return result


def account_media_objects(
    session: Session, user_id: int, post_ids: Collection[int]
) -> tuple[list[str], list[str]]:
    """Lock and snapshot stored keys after any in-flight publication commits."""
    rows = session.scalars(
        select(Media)
        .where(
            or_(
                Media.uploader_id == user_id,
                Media.post_id.in_(post_ids),
            )
        )
        .order_by(Media.id)
        .with_for_update()
    ).all()
    quarantine = sorted({row.s3_key_quarantine for row in rows if row.s3_key_quarantine}
        | {f"uploads/{row.id}/original.{extension}" for row in rows
           for extension in ("jpg", "png", "webp")})
    public = sorted(
        {key for row in rows for key in (row.s3_key_public, row.s3_key_thumbnail) if key}
        | {f"media/{row.id}/{variant}.{extension}" for row in rows
           for variant in ("public", "thumbnail") for extension in ("jpg", "png", "webp")}
    )
    return quarantine, public


def remove_account_media(session: Session, user_id: int, post_ids: Collection[int]) -> None:
    session.execute(
        delete(Media).where(
            or_(
                Media.uploader_id == user_id,
                Media.post_id.in_(post_ids),
            )
        )
    )
