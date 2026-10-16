"""Plain functions operating on an injected Session -- no service class, no
hidden session/state (KISS, wiki/CodeContext/Standards/design-principles.md,
matching app.users.service's exact style).

See wiki/CodeContext/Modules/0x03-posts.md "Report"/"PostLike" sections for
the report_post/like_post/unlike_post behavior these implement.

Per wiki/CodeContext/Modules/0x00-architecture.md "Connection rule", this
module imports app.posts.models and app.eventbus, plus app.users.models.User
-- the same narrow, already-sanctioned cross-module read posts/models.py's
own docstring establishes (Post.author_id is a real FK target into
users.User) -- plus media/'s public read function
app.media.service.processed_media_for_posts (see the repost toggle below),
and nothing else cross-module.

query_feed_posts/like_counts/liked_post_ids/reply_counts/repost_counts/
reposted_post_ids/posts_by_ids/mentioned_game_ids_by_post/replies_to are
this module's public read interface for feed/ (a later unit, per
wiki/CodeContext/Modules/0x06-feed.md): feed/ owns no tables of its own, so
every Post-related read it needs is exposed here instead of feed/ querying
app.posts.models directly.

repost_post/unrepost_post (POSTS-001) are the one-click repost toggle. A
*plain* repost is `is_repost` with no text (null or empty) and no attached
media -- a share with no content of its own. Whether a repost carries media
is read through media/'s public read interface
(app.media.service.processed_media_for_posts; attached media is always
Processed, PublishPostFacade refuses anything else), never by querying
media/'s table. A new repost publishes through PublishPostFacade (the one
publish path); un-reposting is the first delete of a post, limited to the
caller's own plain reposts (wiki/CodeContext/Modules/0x03-posts.md).
"""

from __future__ import annotations

from collections.abc import Collection

from sqlalchemy import ColumnElement, delete, func, or_, select
from sqlalchemy.orm import Session

from app.eventbus import PostEventBus
from app.media.service import processed_media_for_posts
from app.posts.facade import CreatePostRequest, PublishPostFacade
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


class RepostInUseError(ValueError):
    """Raised by unrepost_post when one of the caller's plain reposts is
    itself replied to or reposted: removing it would mean re-parenting
    someone else's post, which un-reposting does not do."""


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


def _live_author() -> ColumnElement[bool]:
    """`Post.author_id` names a user who is not soft-deleted -- the same
    visibility rule as replies_to, as an `IN (subquery)` so the GROUP BY
    counts below need no join."""
    return Post.author_id.in_(select(User.id).where(User.deleted_at.is_(None)))


def _has_no_text() -> ColumnElement[bool]:
    return or_(Post.text.is_(None), Post.text == "")


def reply_counts(session: Session, post_ids: Collection[int]) -> dict[int, int]:
    """Direct replies per post, excluding replies whose author is
    soft-deleted, so the count matches the thread replies_to shows. Absent
    means zero, as like_counts."""
    if not post_ids:
        return {}

    rows = session.execute(
        select(Post.parent_post_id, func.count())
        .where(Post.parent_post_id.in_(post_ids), Post.is_reply.is_(True), _live_author())
        .group_by(Post.parent_post_id)
    ).all()
    # The IN filter already excludes NULL; the guard narrows the nullable FK for mypy.
    return {post_id: count for post_id, count in rows if post_id is not None}


def repost_counts(session: Session, post_ids: Collection[int]) -> dict[int, int]:
    """Reposts per post, plain and quote alike, excluding reposts whose
    author is soft-deleted. Absent means zero, as like_counts."""
    if not post_ids:
        return {}

    rows = session.execute(
        select(Post.original_post_id, func.count())
        .where(Post.original_post_id.in_(post_ids), Post.is_repost.is_(True), _live_author())
        .group_by(Post.original_post_id)
    ).all()
    # The IN filter already excludes NULL; the guard narrows the nullable FK for mypy.
    return {post_id: count for post_id, count in rows if post_id is not None}


def _without_media(session: Session, posts: list[Post]) -> list[Post]:
    """Drops the posts that carry attached media (one batched lookup
    through media/'s read interface): a text-less repost with an image has
    content of its own, so it is not a plain repost."""
    if not posts:
        return []
    with_media = processed_media_for_posts(session, [post.id for post in posts])
    return [post for post in posts if post.id not in with_media]


def _plain_reposts_by(session: Session, user_id: int, original_id: int) -> list[Post]:
    """`user_id`'s plain reposts of `original_id`, oldest first. /compose
    never prevented duplicates, so there can be more than one."""
    candidates = session.scalars(
        select(Post)
        .where(
            Post.author_id == user_id,
            Post.is_repost.is_(True),
            Post.original_post_id == original_id,
            _has_no_text(),
        )
        .order_by(Post.id)
    ).all()
    return _without_media(session, list(candidates))


def reposted_post_ids(session: Session, user_id: int, post_ids: Collection[int]) -> set[int]:
    """Which of `post_ids` `user_id` has a *plain* repost of (a quote
    repost doesn't count) -- for feed/'s `reposted_by_viewer`, one query
    per page plus one media lookup for what it finds."""
    if not post_ids:
        return set()

    candidates = session.scalars(
        select(Post).where(
            Post.author_id == user_id,
            Post.is_repost.is_(True),
            Post.original_post_id.in_(post_ids),
            _has_no_text(),
        )
    ).all()
    return {
        post.original_post_id
        for post in _without_media(session, list(candidates))
        if post.original_post_id is not None
    }


def posts_by_ids(session: Session, post_ids: Collection[int]) -> dict[int, Post]:
    """Batch Post lookup keyed by id, posts whose author is soft-deleted
    left out -- for feed/'s `reposted_post`, one query for a page's
    originals."""
    if not post_ids:
        return {}

    rows = session.scalars(select(Post).where(Post.id.in_(post_ids), _live_author())).all()
    return {post.id: post for post in rows}


def _is_plain_repost(session: Session, post: Post) -> bool:
    return bool(post.is_repost and not post.text and _without_media(session, [post]))


def _repost_target(session: Session, post_id: int) -> Post | None:
    """What a repost of `post_id` points at: the post itself, or, for a
    plain repost, what it reposts -- so a new repost never points at a plain
    repost. Loops because rows made through /compose may already chain
    plain reposts; an original always has a smaller id, so it ends."""
    post = session.get(Post, post_id)
    while post is not None and post.original_post_id is not None and _is_plain_repost(session, post):
        post = session.get(Post, post.original_post_id)
    return post


def _lock_reposts(session: Session, *, user_id: int, original_id: int) -> None:
    """Transaction-scoped advisory lock on (user, post), taken before the
    existence check: serializes "does the caller already have a plain
    repost? if not, publish one" (and the un-repost) for one pair, without
    a unique index -- existing data may already hold duplicates, which a
    unique index would refuse. Released by whichever commit or rollback
    ends the transaction. The key is a 64-bit hash of the pair; a collision
    only makes two unrelated pairs wait for each other."""
    key = f"posts.repost:{user_id}:{original_id}"
    session.execute(select(func.pg_advisory_xact_lock(func.hashtextextended(key, 0))))


def repost_post(
    session: Session, facade: PublishPostFacade, *, user_id: int, post_id: int
) -> tuple[Post, bool]:
    """Idempotent plain repost: returns (the repost, whether it was created
    by this call). Reposting a plain repost reposts its original; a quote
    repost is reposted as itself. Raises PostNotFoundError for an unknown
    post. A new repost goes through PublishPostFacade.publish, so
    moderation, the commit and PostCreated behave exactly as for
    POST /posts; the facade's own exceptions propagate unchanged."""
    target = _repost_target(session, post_id)
    if target is None:
        raise PostNotFoundError(f"No Post with id={post_id!r}")
    target_id = target.id

    _lock_reposts(session, user_id=user_id, original_id=target_id)
    existing = _plain_reposts_by(session, user_id, target_id)
    if existing:
        session.commit()  # ends the transaction, releasing the lock
        return existing[0], False

    try:
        post = facade.publish(
            CreatePostRequest(author_id=user_id, is_repost=True, original_post_id=target_id)
        )
    except Exception:
        session.rollback()  # releases the lock before the error propagates
        raise
    return post, True


def unrepost_post(session: Session, *, user_id: int, post_id: int) -> None:
    """Removes every plain repost `user_id` has of `post_id` (resolved as
    repost_post resolves it, so the toggle is symmetric), together with the
    PostLike, Report and EventMention rows that reference them, in one
    transaction. Nothing to remove, or an unknown post, is not an error.
    Never touches a quote repost, a repost carrying media, or another
    user's repost. Raises RepostInUseError, removing nothing, when one of
    them is replied to or reposted."""
    target = _repost_target(session, post_id)
    if target is None:
        session.rollback()
        return
    target_id = target.id

    _lock_reposts(session, user_id=user_id, original_id=target_id)
    ids = [post.id for post in _plain_reposts_by(session, user_id, target_id)]
    if not ids:
        session.commit()
        return

    in_use = session.scalar(
        select(Post.id)
        .where(or_(Post.parent_post_id.in_(ids), Post.original_post_id.in_(ids)))
        .limit(1)
    )
    if in_use is not None:
        session.rollback()
        raise RepostInUseError(
            "A repost to remove has a reply or a repost of its own; nothing was removed"
        )

    session.execute(delete(PostLike).where(PostLike.post_id.in_(ids)))
    session.execute(delete(Report).where(Report.post_id.in_(ids)))
    session.execute(delete(EventMention).where(EventMention.post_id.in_(ids)))
    session.execute(delete(Post).where(Post.id.in_(ids)))
    session.commit()
