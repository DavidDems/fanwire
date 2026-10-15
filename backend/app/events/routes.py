"""Public, read-only events/ routes — no auth, per the guest feed
requirement (sports data is public). Closes the "Create an API to serve the
data of these game from the database to the website" business rule in
wiki/CodeContext/Modules/0x02-events.md. Routes stay thin: queries and
read models are app.events.service's.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import StringConstraints
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dependencies import get_session
from app.events import service
from app.events.models import Game, Team
from app.events.schemas import (
    GameDetailOut,
    GameOut,
    GameType,
    PlayerDetailOut,
    PlayerGameOut,
    PlayerListItemOut,
    TeamOut,
)

router = APIRouter(prefix="/events", tags=["events"])

# "YYYY-YY", Game.season's format (wiki/CodeContext/Modules/0x02-events.md).
SEASON_PATTERN = r"^\d{4}-\d{2}$"

# A player name search: measured after trimming, so "  " is a 422 rather
# than an unfiltered list.
NameQuery = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


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
    season: str | None = Query(None, pattern=SEASON_PATTERN),
    team_id: int | None = None,
    game_type: GameType | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
) -> list[Game]:
    """One page, newest first (date, then id). Paged because a full load is
    ~30,000 games, over a Lambda response's 6 MB as one list (EVENTS-005).
    Still a list, so the compose picker reads the 50 newest unchanged."""
    if date_from is not None and date_to is not None and date_from > date_to:
        raise HTTPException(status_code=422, detail="date_from is after date_to")
    return service.list_games(
        session,
        season=season,
        team_id=team_id,
        game_type=game_type,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
    )


@router.get("/games/{game_id}", response_model=GameDetailOut)
def get_game(game_id: int, session: Session = Depends(get_session)) -> service.GameDetail:
    """The game page: both teams, line scores and the box score per team.
    posts/'s EventMention.game_id points here."""
    detail = service.game_detail(session, game_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Game not found")
    return detail


@router.get("/players", response_model=list[PlayerListItemOut])
def list_players(
    q: NameQuery | None = None,
    season: str | None = Query(None, pattern=SEASON_PATTERN),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
) -> list[service.PlayerListItem]:
    """One page of players by last name, first name, id. `q` matches when
    every word of it is a prefix of the first or last name, case- and
    accent-insensitively; `season` keeps players who played in it."""
    return service.list_players(session, q=q, season=season, limit=limit, offset=offset)


@router.get("/players/{player_id}", response_model=PlayerDetailOut)
def get_player(player_id: int, session: Session = Depends(get_session)) -> service.PlayerDetail:
    """The player page: attributes, regular-season and playoff career
    lines, and one line per season and game type, newest first."""
    detail = service.player_detail(session, player_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Player not found")
    return detail


@router.get("/players/{player_id}/games", response_model=list[PlayerGameOut])
def list_player_games(
    player_id: int,
    season: str | None = Query(None, pattern=SEASON_PATTERN),
    game_type: GameType | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
) -> list[service.PlayerGame]:
    """The player's game log, played and did-not-play, newest first."""
    games = service.player_games(
        session, player_id, season=season, game_type=game_type, limit=limit, offset=offset
    )
    if games is None:
        raise HTTPException(status_code=404, detail="Player not found")
    return games
