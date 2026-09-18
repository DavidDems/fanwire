"""Plain functions operating on an injected Session -- no service class, no
hidden session/state (KISS, wiki/CodeContext/Standards/design-principles.md,
matching app.users.service's exact style).

See wiki/CodeContext/Modules/0x03-posts.md "Report"/"PostLike" sections for
the report_post/like_post/unlike_post behavior these implement.

Per wiki/CodeContext/Modules/0x00-architecture.md "Connection rule", this
module imports app.posts.models and app.eventbus, plus app.users.models.User
-- the same narrow, already-sanctioned cross-module read posts/models.py's
own docstring establishes (Post.author_id is a real FK target into
users.User) -- and nothing else cross-module.

query_feed_posts/like_counts/liked_post_ids/mentioned_game_ids_by_post/
replies_to are this module's public read interface for feed/ (a later
unit, per wiki/CodeContext/Modules/0x06-feed.md): feed/ owns no tables of
its own, so every Post-related read it needs is exposed here instead of
feed/ querying app.posts.models directly.
"""

from __future__ import annotations

from collections.abc import Collection

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.eventbus import PostEventBus
from app.posts.models import EventMention, Post, PostLike, Report
from app.users.models import User

POST_REPORTED = "PostReported"


class PostNotFoundError(ValueError):
    """Raised by report_post when post_id doesn't resolve to an existing
    Post."""


class AlreadyLikedError(ValueError):
    """Raised by like_post when the (user_id, post_id) pair already
    exists."""


class NotLikedError(ValueError):
    """Raised by unlike_post when the (user_id, post_id) pair doesn't
    exist."""


def report_post(
    session: Session, event_bus: PostEventBus, *, post_id: int, reporter_id: int
) -> Report | None:
    """Idempotent per wiki/CodeContext/Modules/0x03-posts.md: a repeat
    (post_id, reporter_id) is a no-op returning None, not an error. On a
    genuinely new report: creates the Report row, sets Post.reported = True
    if it wasn't already (never unset once true), commits, and publishes
    PostReported -- published on every new (non-duplicate) Report row, not
    only the very first one for a post, since each new report is itself
    meaningful information even though the Post.reported flag only flips
    once. Raises PostNotFoundError if post_id doesn't resolve to an
    existing Post."""
    post = session.get(Post, post_id)
    if post is None:
        raise PostNotFoundError(f"No Post with id={post_id!r}")

    existing = session.scalar(
        select(Report).where(Report.post_id == post_id, Report.reporter_id == reporter_id)
    )
    if existing is not None:
        return None

    report = Report(post_id=post_id, reporter_id=reporter_id)
    session.add(report)
    if not post.reported:
        post.reported = True
    session.commit()

    event_bus.publish(POST_REPORTED, {"post_id": post_id, "reporter_id": reporter_id})
    return report


def like_post(session: Session, *, user_id: int, post_id: int) -> PostLike:
    """Same fail-fast-on-duplicate shape as app.users.service.follow():
    raises AlreadyLikedError (checked first, for a clearer error than a raw
    IntegrityError) if (user_id, post_id) already exists."""
    existing = session.scalar(
        select(PostLike).where(PostLike.user_id == user_id, PostLike.post_id == post_id)
    )
    if existing is not None:
        raise AlreadyLikedError(f"User {user_id!r} has already liked post {post_id!r}")

    row = PostLike(user_id=user_id, post_id=post_id)
    session.add(row)
    session.commit()
    return row


def unlike_post(session: Session, *, user_id: int, post_id: int) -> None:
    """Same shape as app.users.service.unfollow(): raises NotLikedError if
    the pair doesn't exist, else hard-deletes the PostLike row (no
    soft-delete on likes, same as Follow)."""
    row = session.scalar(
        select(PostLike).where(PostLike.user_id == user_id, PostLike.post_id == post_id)
    )
    if row is None:
        raise NotLikedError(f"User {user_id!r} has not liked post {post_id!r}")

    session.delete(row)
    session.commit()


def query_feed_posts(
    session: Session,
    *,
    author_ids: Collection[int] | None,
    mentioned_game_ids: Collection[int] | None,
    before_id: int | None,
    limit: int,
) -> list[Post]:
    """Top-level posts only (`is_reply=False`; reposts included -- a repost
    row also has `is_reply=False`), newest first by id, `id < before_id`
    when given. `author_ids`/`mentioned_game_ids` are OR'd, never producing
    duplicates (the mention condition is expressed as a `Post.id.in_(...)`
    subquery, not a join, specifically to avoid row multiplication from a
    post with several EventMention rows). Both None means no filter at all
    (the guest feed: all posts). Posts whose author is soft-deleted are
    excluded."""
    stmt = (
        select(Post)
        .join(User, User.id == Post.author_id)
        .where(Post.is_reply.is_(False), User.deleted_at.is_(None))
    )

    conditions = []
    if author_ids is not None:
        conditions.append(Post.author_id.in_(author_ids))
    if mentioned_game_ids is not None:
        conditions.append(
            Post.id.in_(
                select(EventMention.post_id).where(EventMention.game_id.in_(mentioned_game_ids))
            )
        )
    if conditions:
        stmt = stmt.where(or_(*conditions))

    if before_id is not None:
        stmt = stmt.where(Post.id < before_id)

    stmt = stmt.order_by(Post.id.desc()).limit(limit)
    return list(session.scalars(stmt).all())


def like_counts(session: Session, post_ids: Collection[int]) -> dict[int, int]:
    """Batch like-count lookup, keyed by post id. A post with zero likes is
    absent from the result entirely (callers use `.get(post_id, 0)`), same
    "absent means zero/none" shape as mentioned_game_ids_by_post."""
    if not post_ids:
        return {}

    rows = session.execute(
        select(PostLike.post_id, func.count())
        .where(PostLike.post_id.in_(post_ids))
        .group_by(PostLike.post_id)
    ).all()
    return {post_id: count for post_id, count in rows}


def liked_post_ids(session: Session, user_id: int, post_ids: Collection[int]) -> set[int]:
    """Which of `post_ids` has `user_id` liked -- for feed/'s
    `liked_by_viewer` field, one query per page rather than one per post."""
    if not post_ids:
        return set()

    return set(
        session.scalars(
            select(PostLike.post_id).where(
                PostLike.user_id == user_id, PostLike.post_id.in_(post_ids)
            )
        ).all()
    )


def mentioned_game_ids_by_post(session: Session, post_ids: Collection[int]) -> dict[int, list[int]]:
    """Batch EventMention lookup, keyed by post id. A post with no mentions
    is absent from the result entirely."""
    if not post_ids:
        return {}

    rows = session.execute(
        select(EventMention.post_id, EventMention.game_id).where(EventMention.post_id.in_(post_ids))
    ).all()
    result: dict[int, list[int]] = {}
    for post_id, game_id in rows:
        result.setdefault(post_id, []).append(game_id)
    return result


def search_posts(session: Session, query: str, *, limit: int, offset: int) -> list[Post]:
    """Full-text search over Post.search_vector (post text), per
    wiki/CodeContext/Modules/0x07-search.md. Queried with
    websearch_to_tsquery('english', :q) -- func.websearch_to_tsquery(...)
    below passes `query` as a bind parameter, never interpolated into SQL
    text, and websearch_to_tsquery itself tolerates arbitrary user input
    (quotes, operators, etc.) without raising. Replies are included (no
    is_reply filter); posts whose author is soft-deleted are excluded.
    Ordered by rank desc, then newest first."""
    tsquery = func.websearch_to_tsquery("english", query)
    stmt = (
        select(Post)
        .join(User, User.id == Post.author_id)
        .where(User.deleted_at.is_(None))
        .where(Post.search_vector.op("@@")(tsquery))
        .order_by(func.ts_rank(Post.search_vector, tsquery).desc(), Post.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(session.scalars(stmt).all())


def replies_to(session: Session, post_id: int) -> list[Post]:
    """Direct replies only, oldest first (natural thread reading order),
    excluding soft-deleted authors -- same author-visibility rule as
    query_feed_posts. Not wired into GET /posts/{id}/replies: that route's
    existing behaviour doesn't exclude soft-deleted authors, so reusing this
    here would be a behaviour change, not a pure refactor (see this unit's
    task brief)."""
    stmt = (
        select(Post)
        .join(User, User.id == Post.author_id)
        .where(Post.parent_post_id == post_id, User.deleted_at.is_(None))
        .order_by(Post.created_at.asc())
    )
    return list(session.scalars(stmt).all())
