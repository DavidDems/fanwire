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
