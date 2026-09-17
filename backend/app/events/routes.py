"""Public, read-only events/ routes — no auth, per the guest feed
requirement (sports data is public). Closes the "Create an API to serve the
data of these game from the database to the website" business rule in
wiki/CodeContext/Modules/0x02-events.md.

Not wired into app.main yet — a later unit wires all three modules'
routers (events/users/media) in together.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.dependencies import get_session
from app.events.models import Game, Team
from app.events.schemas import GameOut, TeamOut

router = APIRouter(prefix="/events", tags=["events"])


@router.get("/teams", response_model=list[TeamOut])
def list_teams(session: Session = Depends(get_session)) -> list[Team]:
    """No pagination — the NBA team set is ~30 rows, small and stable
    (YAGNI, wiki/CodeContext/Modules/0x02-events.md)."""
    return list(session.scalars(select(Team)).all())


@router.get("/teams/{team_id}", response_model=TeamOut)
def get_team(team_id: int, session: Session = Depends(get_session)) -> Team:
    team = session.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    return team


@router.get("/games", response_model=list[GameOut])
def list_games(
    team_id: int | None = None,
    season: str | None = None,
    session: Session = Depends(get_session),
) -> list[Game]:
    """No pagination (YAGNI, same reasoning as list_teams) — revisit if the
    games table grows large enough that this becomes a real concern."""
    stmt = select(Game)
    if team_id is not None:
        stmt = stmt.where(or_(Game.home_team_id == team_id, Game.away_team_id == team_id))
    if season is not None:
        stmt = stmt.where(Game.season == season)
    stmt = stmt.order_by(Game.date.desc())
    return list(session.scalars(stmt).all())


@router.get("/games/{game_id}", response_model=GameOut)
def get_game(game_id: int, session: Session = Depends(get_session)) -> Game:
    """The read endpoint posts/'s EventMention.game_id will point to once
    posts/ exists (Phase 2 proper, not this unit)."""
    game = session.get(Game, game_id)
    if game is None:
        raise HTTPException(status_code=404, detail="Game not found")
    return game
