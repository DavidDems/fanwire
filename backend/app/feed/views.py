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

A post's sports-data attachment (POSTS-006) is carried as `data_link`, read
from the Post row itself, and `data_link_preview`, assembled from events/'
batch reads: the links of every post in the pass, reposted originals
included, are gathered into three key sets, and app.events.service's
game_final_previews, player_game_previews and player_career_previews are
each called once, and not at all when their set is empty. So links cost a
fixed number of statements whatever the page size, and a page without
links reads no events/ table.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Collection, Sequence
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.events.service import (
    game_final_previews,
    player_career_previews,
    player_game_previews,
)
from app.media.service import processed_media_for_posts
from app.posts.data_link import DataLink
from app.posts.models import Post
from app.posts.schemas import DataLinkOut
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


class TeamRefView(BaseModel):
    id: int
    name: str
    abbreviation: str


class GameFinalPreviewView(BaseModel):
    """A game_final link's preview: every field of
    app.events.service.GameFinalPreview."""

    type: Literal["game_final"]
    game_id: int
    date: datetime
    season: str
    game_type: str | None
    label: str | None
    sub_label: str | None
    series_game_number: int | None
    home_team: TeamRefView
    away_team: TeamRefView
    home_score: int
    away_score: int


class PlayerGamePreviewView(BaseModel):
    """A player_game link's preview: every field of
    app.events.service.PlayerGamePreview. A DNP line is as stored (null
    seconds_played, its dnp_reason, zeros)."""

    type: Literal["player_game"]
    line_id: int
    game_id: int
    player_id: int
    first_name: str | None
    last_name: str | None
    team: TeamRefView
    opponent: TeamRefView
    is_home: bool
    team_score: int
    opponent_score: int
    date: datetime
    season: str
    game_type: str | None
    label: str | None
    starter: bool
    seconds_played: int | None
    points: int
    rebounds: int
    assists: int
    steals: int
    blocks: int
    turnovers: int
    field_goals_made: int
    field_goals_attempted: int
    field_goal_pct: float | None
    three_pointers_made: int
    three_pointers_attempted: int
    three_point_pct: float | None
    free_throws_made: int
    free_throws_attempted: int
    free_throw_pct: float | None
    plus_minus: int
    dnp_reason: str | None


class PlayerCareerPreviewView(BaseModel):
    """A player_career link's preview: every field of
    app.events.service.PlayerCareerPreview, computed at read time, not a
    snapshot from the post's creation; a scope with no games has null
    averages."""

    type: Literal["player_career"]
    player_id: int
    first_name: str | None
    last_name: str | None
    position: str | None
    first_season: str | None
    last_season: str | None
    scope: str
    games_played: int
    points_per_game: float | None
    rebounds_per_game: float | None
    assists_per_game: float | None
    minutes_per_game: float | None
    field_goal_pct: float | None
    three_point_pct: float | None
    free_throw_pct: float | None


DataLinkPreview = Annotated[
    GameFinalPreviewView | PlayerGamePreviewView | PlayerCareerPreviewView,
    Field(discriminator="type"),
]


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
    original is hidden only because its author is deactivated.

    `data_link` is the post's own attachment in PostOut's shape (a plain
    repost has none; its `reposted_post` carries the original's), and
    `data_link_preview` that attachment's events/ preview: null without a
    link, or when its target has no preview. Legacy EventMention rows
    produce `mentioned_game_ids` only, never either field."""

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
    data_link: DataLinkOut | None
    data_link_preview: DataLinkPreview | None


class _Previews:
    """The events/ previews of every link in one assemble_post_views pass:
    one batch read per link type, skipped when no link has that type."""

    def __init__(self, session: Session, links: Collection[DataLink]) -> None:
        game_ids = {link.ref_id for link in links if link.type == "game_final"}
        line_ids = {link.ref_id for link in links if link.type == "player_game"}
        career_keys = {
            (link.ref_id, link.scope or "") for link in links if link.type == "player_career"
        }
        self._games = game_final_previews(session, game_ids) if game_ids else {}
        self._lines = player_game_previews(session, line_ids) if line_ids else {}
        self._careers = player_career_previews(session, career_keys) if career_keys else {}

    def for_link(self, link: DataLink | None) -> DataLinkPreview | None:
        """`link`'s preview: the dataclass's fields plus the link's type, a
        TeamRef as a nested object. None without a link or a preview."""
        if link is None:
            return None
        if link.type == "game_final":
            game = self._games.get(link.ref_id)
            if game is None:
                return None
            return GameFinalPreviewView(type="game_final", **dataclasses.asdict(game))
        if link.type == "player_game":
            line = self._lines.get(link.ref_id)
            if line is None:
                return None
            return PlayerGamePreviewView(type="player_game", **dataclasses.asdict(line))
        career = self._careers.get((link.ref_id, link.scope or ""))
        if career is None:
            return None
        return PlayerCareerPreviewView(type="player_career", **dataclasses.asdict(career))


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
    links = {post.id: post.data_link for post in every_post.values()}

    authors = get_public_profiles(session, author_ids)
    likes = like_counts(session, post_ids)
    liked = liked_post_ids(session, viewer_id, post_ids) if viewer_id is not None else set()
    replies = reply_counts(session, post_ids)
    reposts = repost_counts(session, post_ids)
    reposted = reposted_post_ids(session, viewer_id, post_ids) if viewer_id is not None else set()
    mentions_by_post = mentioned_game_ids_by_post(session, post_ids)
    media_by_post = processed_media_for_posts(session, post_ids)
    previews = _Previews(session, [link for link in links.values() if link is not None])

    # Every view without its reposted_post first: these are both the page's
    # views and the one-level-deep inner views.
    flat: dict[int, PostView] = {}
    for post in every_post.values():
        author = authors.get(post.author_id)
        if author is None:
            continue

        link = links[post.id]
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
            data_link=None if link is None else DataLinkOut.model_validate(link),
            data_link_preview=previews.for_link(link),
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
