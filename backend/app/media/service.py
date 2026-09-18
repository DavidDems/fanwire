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

from sqlalchemy import select
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
        result.setdefault(row.post_id, []).append(
            MediaView(
                id=row.id,
                s3_key_public=row.s3_key_public,
                s3_key_thumbnail=row.s3_key_thumbnail,
            )
        )
    return result
