"""assemble_post_views -- the shared view-assembly function feed/'s routes
call, and that search/ (a later unit, per this unit's task brief) is
expected to reuse as-is. Kept public and module-level for exactly that
reason: it is a cross-module contract, not a private helper.

Batches every cross-module read into one call per read function per page
(no N+1): app.users.service.get_public_profiles, app.posts.service.
like_counts/liked_post_ids/mentioned_game_ids_by_post,
app.media.service.processed_media_for_posts, app.events.service.
games_by_ids. feed/ owns no tables of its own (0x00-architecture.md
Connection rule) -- every field below is assembled from those modules'
public read interfaces, never a direct query against their tables.

Live scores: only for mentioned games whose `date` falls within the last
4 hours. `Game` (app.events.models) has no status column to check "is this
actually in progress" -- this fixed window is a documented heuristic
standing in for that, per wiki/CodeContext/Modules/0x06-feed.md. Any
exception raised by, or a None returned from, `CachedEventProxy.
get_live_score` is treated identically: no score for that game, a logged
warning (game id only -- never any user-identifying data), and the feed
request itself never fails because of it.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.events.proxy import CachedEventProxy
from app.events.service import GameRef, games_by_ids
from app.media.service import processed_media_for_posts
from app.posts.models import Post
from app.posts.service import like_counts, liked_post_ids, mentioned_game_ids_by_post
from app.users.service import get_public_profiles

logger = logging.getLogger(__name__)

# Documented heuristic, not derived from real game state -- see module
# docstring. A game whose `date` is more than this far in the past (or any
# time in the future) is treated as "not live," full stop.
_LIVE_SCORE_WINDOW = timedelta(hours=4)


class AuthorView(BaseModel):
    id: int
    username: str
    profile_picture_media_id: int | None


class MediaItemView(BaseModel):
    id: int
    s3_key_public: str | None
    s3_key_thumbnail: str | None


class LiveScoreView(BaseModel):
    game_id: int
    home_score: int
    away_score: int
    status: str


class PostView(BaseModel):
    """feed/'s (and, per this unit's brief, search/'s) response shape for a
    single post. Deliberately its own schema, not app.posts.schemas.PostOut
    -- it carries fields (author, like_count, media, mentioned_game_ids,
    live_scores) PostOut doesn't, assembled from other modules' read
    interfaces rather than the Post row alone."""

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
    live_scores: list[LiveScoreView]


def assemble_post_views(
    session: Session,
    posts: Sequence[Post],
    *,
    viewer_id: int | None,
    live_scores: CachedEventProxy | None,
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

    all_game_ids = {game_id for game_ids in mentions_by_post.values() for game_id in game_ids}
    games = games_by_ids(session, all_game_ids)
    live_score_by_game = _live_scores_for_games(games, live_scores)

    views: list[PostView] = []
    for post in posts:
        author = authors.get(post.author_id)
        if author is None:
            continue

        mentioned = mentions_by_post.get(post.id, [])
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
                mentioned_game_ids=mentioned,
                live_scores=[
                    live_score_by_game[game_id]
                    for game_id in mentioned
                    if game_id in live_score_by_game
                ],
            )
        )
    return views


def _live_scores_for_games(
    games: dict[int, GameRef], proxy: CachedEventProxy | None
) -> dict[int, LiveScoreView]:
    if proxy is None or not games:
        return {}

    now = datetime.now(UTC)
    window_start = now - _LIVE_SCORE_WINDOW

    result: dict[int, LiveScoreView] = {}
    for game_id, game in games.items():
        game_date = game.date if game.date.tzinfo is not None else game.date.replace(tzinfo=UTC)
        if not (window_start <= game_date <= now):
            continue

        try:
            score = proxy.get_live_score(game.api_sports_game_id)
        except Exception:
            # Never PII: game_id is our own internal id, not user data.
            # Any exception from the proxy (vendor timeout, bad response,
            # etc.) must never fail the feed request -- see module
            # docstring.
            logger.warning("live score lookup failed for game_id=%s", game_id, exc_info=True)
            continue

        if score is None:
            continue

        result[game_id] = LiveScoreView(
            game_id=game_id,
            home_score=score.home_score,
            away_score=score.away_score,
            status=score.status,
        )
    return result
