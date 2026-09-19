"""Plain functions operating on an injected Session -- no service class, no
hidden session/state (KISS, wiki/CodeContext/Standards/design-principles.md,
matching app.users.service/app.posts.service/app.media.service's exact
style).

game_ids_for_team/games_by_ids are events/'s public read interface for
feed/ (a later unit, per wiki/CodeContext/Modules/0x06-feed.md's Connection
rule): feed/ owns no tables of its own, so it reads Game through here
instead of querying app.events.models directly.
"""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.events.models import Game

# Allow-list for search/'s position filter (wiki/CodeContext/Modules/
# 0x07-search.md), validated at the API boundary (unknown -> 422) --
# never interpolated into a query, only ever compared against this fixed
# set. Standard basketball position set; the fixture data this codebase
# has seen so far only uses "SF" (see ApiSportsAdapter, 0x02-events.md
# "Resolved decisions"), and this set is unverified against a live
# API-SPORTS payload, same caveat as the rest of that adapter's
# vendor-shape parsing.
ALLOWED_POSITIONS: tuple[str, ...] = ("PG", "SG", "SF", "PF", "C", "G", "F")


def game_ids_for_team(session: Session, team_id: int) -> list[int]:
    """The ids of every Game team_id played, home or away."""
    return list(
        session.scalars(
            select(Game.id).where(or_(Game.home_team_id == team_id, Game.away_team_id == team_id))
        ).all()
    )


@dataclass(frozen=True)
class GameRef:
    """The subset of a Game row other modules (feed/, search/) may read
    through this module's public interface -- never the ORM row itself, per
    wiki/CodeContext/Modules/0x00-architecture.md "Connection rule". Same
    shape/reasoning as app.users.service.PublicProfile /
    app.media.service.MediaView."""

    id: int
    api_sports_game_id: int
    date: datetime


def games_by_ids(session: Session, ids: Collection[int]) -> dict[int, GameRef]:
    """Batch lookup of the narrow GameRef projection, keyed by id -- feed/
    needs api_sports_game_id (to query CachedEventProxy) and date (for its
    live-score-window heuristic), nothing else about the Game row."""
    if not ids:
        return {}

    rows = session.scalars(select(Game).where(Game.id.in_(ids))).all()
    return {
        row.id: GameRef(id=row.id, api_sports_game_id=row.api_sports_game_id, date=row.date)
        for row in rows
    }


def filter_games(
    session: Session,
    *,
    season: str | None,
    team_id: int | None,
    position: str | None,
    limit: int,
    offset: int,
) -> list[Game]:
    """search/'s sports-data filter (wiki/CodeContext/Modules/
    0x07-search.md): plain WHERE-clause filtering, not full-text search.
    All filters are optional and AND'd together. `team_id` matches either
    home or away. `position` filters via JSONB containment on
    `player_stats` (`player_stats @> '[{"position": "<P>"}]'`), built here
    with SQLAlchemy's JSONB `.contains()` comparator -- never string SQL,
    the bound value is passed as a parameter like any other. Ordered by
    date desc."""
    stmt = select(Game)
    if season is not None:
        stmt = stmt.where(Game.season == season)
    if team_id is not None:
        stmt = stmt.where(or_(Game.home_team_id == team_id, Game.away_team_id == team_id))
    if position is not None:
        stmt = stmt.where(Game.player_stats.contains([{"position": position}]))
    stmt = stmt.order_by(Game.date.desc()).limit(limit).offset(offset)
    return list(session.scalars(stmt).all())


def distinct_seasons(session: Session) -> list[str]:
    """Distinct `season` values across all Game rows, for search/'s "year"
    filter dropdown. Newest first (judgment call -- no ordering is
    specified by wiki/CodeContext/Modules/0x07-search.md, and most-recent-
    first is the more useful default for a dropdown)."""
    return list(session.scalars(select(Game.season).distinct().order_by(Game.season.desc())).all())
