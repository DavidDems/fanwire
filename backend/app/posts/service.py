"""Plain functions operating on an injected Session -- no service class, no
hidden session/state (KISS, wiki/CodeContext/Standards/design-principles.md,
matching app.users.service's exact style).

See wiki/CodeContext/Modules/0x03-posts.md "Report"/"PostLike" sections for
the report_post/like_post/unlike_post behavior these implement.

Per wiki/CodeContext/Modules/0x00-architecture.md "Connection rule", this
module imports app.posts.models and app.eventbus only -- nothing else
cross-module.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.eventbus import PostEventBus
from app.posts.models import Post, PostLike, Report

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
