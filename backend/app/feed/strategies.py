"""FeedRankingStrategy -- Strategy pattern
(wiki/CodeContext/Standards/gof-patterns.md "Strategy"): chronological,
engagement-weighted, and following-only variants are swappable at runtime
without branching in feed/. Only the chronological/follows-and-
preferred-team variant and the guest fallback are implemented now --
engagement-weighted is a documented extension point, not built (YAGNI, per
wiki/CodeContext/Modules/0x06-feed.md).

feed/ owns no tables of its own (0x00-architecture.md Connection rule), so
both strategies below are built entirely on the other modules' public read
functions (app.posts.service.query_feed_posts, app.users.service.
followed_user_ids, app.events.service.game_ids_for_team) -- never a direct
query against another module's tables.
"""

from __future__ import annotations

import abc

from sqlalchemy.orm import Session

from app.events.service import game_ids_for_team
from app.posts.models import Post
from app.posts.service import query_feed_posts
from app.users.models import User
from app.users.service import followed_user_ids


class FeedRankingStrategy(abc.ABC):
    """Callers (feed/'s routes) depend on this interface only, never a
    concrete strategy class -- see strategy_for()."""

    @abc.abstractmethod
    def select_posts(self, session: Session, *, before_id: int | None, limit: int) -> list[Post]:
        """Up to `limit` top-level posts, newest first, with `id <
        before_id` when given."""


class FollowsAndPreferredTeamStrategy(FeedRankingStrategy):
    """Reverse-chronological: authors = the viewer's followed ids plus the
    viewer themself (a viewer sees their own posts in their own feed --
    judgment call, see wiki/CodeContext/Modules/0x06-feed.md), OR'd with
    mentions of the viewer's preferred team's games when one is set."""

    def __init__(self, viewer_id: int, preferred_team_id: int | None) -> None:
        self._viewer_id = viewer_id
        self._preferred_team_id = preferred_team_id

    def select_posts(self, session: Session, *, before_id: int | None, limit: int) -> list[Post]:
        author_ids = set(followed_user_ids(session, self._viewer_id))
        author_ids.add(self._viewer_id)

        mentioned_game_ids = (
            game_ids_for_team(session, self._preferred_team_id)
            if self._preferred_team_id is not None
            else None
        )

        return query_feed_posts(
            session,
            author_ids=author_ids,
            mentioned_game_ids=mentioned_game_ids,
            before_id=before_id,
            limit=limit,
        )


class GuestRecentStrategy(FeedRankingStrategy):
    """Most-recent top-level posts globally -- the guest default. Resolves
    wiki/CodeContext/Modules/0x06-feed.md's previously-open "guest-feed
    algorithm" decision: no Follow/PostLike/preferred_team to personalize
    from for an unauthenticated visitor, so this is KISS's simplest
    defensible reading of the business rule, not a scored variant."""

    def select_posts(self, session: Session, *, before_id: int | None, limit: int) -> list[Post]:
        return query_feed_posts(
            session,
            author_ids=None,
            mentioned_game_ids=None,
            before_id=before_id,
            limit=limit,
        )


def strategy_for(viewer: User | None) -> FeedRankingStrategy:
    """Picks the strategy for a request -- callers (feed/'s routes) never
    branch on the concrete type themselves."""
    if viewer is None:
        return GuestRecentStrategy()
    return FollowsAndPreferredTeamStrategy(viewer.id, viewer.preferred_team_id)
