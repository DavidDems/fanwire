"""assemble_post_views -- the shared view-assembly function feed/'s routes
call, and that search/ (a later unit, per this unit's task brief) is
expected to reuse as-is. Kept public and module-level for exactly that
reason: it is a cross-module contract, not a private helper.

Batches every cross-module read into one call per read function per page
(no N+1): app.users.service.get_public_profiles, app.posts.service.
like_counts/liked_post_ids/mentioned_game_ids_by_post,
app.media.service.processed_media_for_posts. feed/ owns no tables of its
own (0x00-architecture.md Connection rule) -- every field below is
assembled from those modules' public read interfaces, never a direct query
against their tables.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.media.service import processed_media_for_posts
from app.posts.models import Post
from app.posts.service import like_counts, liked_post_ids, mentioned_game_ids_by_post
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
    than the Post row alone."""

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
    media: list[MediaItemView]
    mentioned_game_ids: list[int]


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

    post_ids = [post.id for post in posts]
    author_ids = {post.author_id for post in posts}

    authors = get_public_profiles(session, author_ids)
    counts = like_counts(session, post_ids)
    liked = liked_post_ids(session, viewer_id, post_ids) if viewer_id is not None else set()
    mentions_by_post = mentioned_game_ids_by_post(session, post_ids)
    media_by_post = processed_media_for_posts(session, post_ids)

    views: list[PostView] = []
    for post in posts:
        author = authors.get(post.author_id)
        if author is None:
            continue

        views.append(
            PostView(
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
                like_count=counts.get(post.id, 0),
                liked_by_viewer=post.id in liked,
                media=[
                    MediaItemView(
                        id=media.id,
                        s3_key_public=media.s3_key_public,
                        s3_key_thumbnail=media.s3_key_thumbnail,
                    )
                    for media in media_by_post.get(post.id, [])
                ],
                mentioned_game_ids=mentions_by_post.get(post.id, []),
            )
        )
    return views
