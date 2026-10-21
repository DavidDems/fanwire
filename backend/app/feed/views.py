"""assemble_post_views -- the shared view-assembly function feed/'s routes
call, and that search/ (a later unit, per this unit's task brief) is
expected to reuse as-is. Kept public and module-level for exactly that
reason: it is a cross-module contract, not a private helper.

Batches every cross-module read into one call per read function per page
(no N+1): app.users.service.get_public_profiles, app.posts.service.
posts_by_ids/like_counts/liked_post_ids/reply_counts/repost_counts/
reposted_post_ids/mentioned_game_ids_by_post,
app.media.service.processed_media_for_posts. feed/ owns no tables of its
own (0x00-architecture.md Connection rule) -- every field below is
assembled from those modules' public read interfaces, never a direct query
against their tables.

A repost's `reposted_post` (POSTS-001) is built in the same pass: the
page's reposted originals are fetched in one query, added to the set every
batched read runs over, and their views built alongside the page's own --
one level deep, never recursing, so a page of 20 costs the same number of
statements as a page of 2. Which of those originals their owner deleted
(POSTS-004's `reposted_post_deleted`) is one more batched read,
app.posts.service.deleted_post_ids, in the same pass.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.media.service import processed_media_for_posts
from app.posts.models import Post
from app.posts.service import (
    deleted_post_ids,
    like_counts,
    liked_post_ids,
    mentioned_game_ids_by_post,
    posts_by_ids,
    reply_counts,
    repost_counts,
    reposted_post_ids,
)
from app.users.service import get_public_profiles


class AuthorView(BaseModel):
    id: int
    username: str
    profile_picture_media_id: int | None


class MediaItemView(BaseModel):
    id: int
    s3_key_public: str | None
    s3_key_thumbnail: str | None


class PostView(BaseModel):
    """feed/'s (and, per this unit's brief, search/'s) response shape for a
    single post. Deliberately its own schema, not app.posts.schemas.PostOut
    -- it carries fields (author, like_count, media, mentioned_game_ids)
    PostOut doesn't, assembled from other modules' read interfaces rather
    than the Post row alone.

    `reply_count` counts direct replies, `repost_count` reposts plain and
    quote, both leaving out soft-deleted authors. `reposted_by_viewer` is
    whether the viewer has a *plain* repost of this post (false for a
    guest). `reposted_post` is, on a repost, the view of the post it
    reposts, one level deep (its own `reposted_post` is always null); null
    on every other post and when the original is hidden.
    `reposted_post_deleted` is true on a repost whose original its owner
    deleted (its `reposted_post` is then null, and the client shows a "Post
    deleted" placeholder); false everywhere else, including a repost whose
    original is hidden only because its author is deactivated."""

    id: int
    text: str | None
    is_reply: bool
    parent_post_id: int | None
    is_repost: bool
    original_post_id: int | None
    created_at: datetime
    author: AuthorView
    like_count: int
    liked_by_viewer: bool
    reply_count: int
    repost_count: int
    reposted_by_viewer: bool
    media: list[MediaItemView]
    mentioned_game_ids: list[int]
    reposted_post: PostView | None
    reposted_post_deleted: bool


def assemble_post_views(
    session: Session,
    posts: Sequence[Post],
    *,
    viewer_id: int | None,
) -> list[PostView]:
    """Builds one PostView per post in `posts`, preserving order. A post
    whose author can't be resolved via get_public_profiles (soft-deleted --
    normally already excluded by app.posts.service.query_feed_posts/
    replies_to, but handled defensively here too, e.g. a soft-delete
    racing this call) is silently dropped rather than raised on."""
    if not posts:
        return []

    original_ids = {
        post.original_post_id
        for post in posts
        if post.is_repost and post.original_post_id is not None
    }
    # The page's own rows win over a refetched copy of the same id.
    every_post: dict[int, Post] = {**posts_by_ids(session, original_ids)}
    every_post.update({post.id: post for post in posts})
    deleted_originals = deleted_post_ids(session, original_ids)

    post_ids = list(every_post)
    author_ids = {post.author_id for post in every_post.values()}

    authors = get_public_profiles(session, author_ids)
    likes = like_counts(session, post_ids)
    liked = liked_post_ids(session, viewer_id, post_ids) if viewer_id is not None else set()
    replies = reply_counts(session, post_ids)
    reposts = repost_counts(session, post_ids)
    reposted = reposted_post_ids(session, viewer_id, post_ids) if viewer_id is not None else set()
    mentions_by_post = mentioned_game_ids_by_post(session, post_ids)
    media_by_post = processed_media_for_posts(session, post_ids)

    # Every view without its reposted_post first: these are both the page's
    # views and the one-level-deep inner views.
    flat: dict[int, PostView] = {}
    for post in every_post.values():
        author = authors.get(post.author_id)
        if author is None:
            continue

        flat[post.id] = PostView(
            id=post.id,
            text=post.text,
            is_reply=post.is_reply,
            parent_post_id=post.parent_post_id,
            is_repost=post.is_repost,
            original_post_id=post.original_post_id,
            created_at=post.created_at,
            author=AuthorView(
                id=author.id,
                username=author.username,
                profile_picture_media_id=author.profile_picture_media_id,
            ),
            like_count=likes.get(post.id, 0),
            liked_by_viewer=post.id in liked,
            reply_count=replies.get(post.id, 0),
            repost_count=reposts.get(post.id, 0),
            reposted_by_viewer=post.id in reposted,
            media=[
                MediaItemView(
                    id=media.id,
                    s3_key_public=media.s3_key_public,
                    s3_key_thumbnail=media.s3_key_thumbnail,
                )
                for media in media_by_post.get(post.id, [])
            ],
            mentioned_game_ids=mentions_by_post.get(post.id, []),
            reposted_post=None,
            reposted_post_deleted=False,
        )

    views: list[PostView] = []
    for post in posts:
        view = flat.get(post.id)
        if view is None:
            continue
        if post.is_repost and post.original_post_id is not None:
            if post.original_post_id in deleted_originals:
                view = view.model_copy(update={"reposted_post_deleted": True})
            elif (inner := flat.get(post.original_post_id)) is not None:
                view = view.model_copy(update={"reposted_post": inner})
        views.append(view)
    return views
