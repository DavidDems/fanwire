"""Public, read-only events/ routes — no auth, per the guest feed
requirement (sports data is public). Closes the "Create an API to serve the
data of these game from the database to the website" business rule in
wiki/CodeContext/Modules/0x02-events.md. Routes stay thin: queries and
read models are app.events.service's.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from pydantic import StringConstraints
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dependencies import get_session
from app.events import records, service
from app.events.models import Game, Team
from app.events.schemas import (
    CareerGameType,
    ChampionOut,
    GameDetailOut,
    GameOut,
    GameType,
    LeadersOut,
    LeaderStat,
    PlayerDetailOut,
    PlayerGameOut,
    PlayerListItemOut,
    RecordListOut,
    RecordsSummaryOut,
    StandingsOut,
    TeamOut,
    TeamSeasonOut,
)

router = APIRouter(prefix="/events", tags=["events"])

# "YYYY-YY", Game.season's format (wiki/CodeContext/Modules/0x02-events.md).
SEASON_PATTERN = r"^\d{4}-\d{2}$"

# A player name search: measured after trimming, so "  " is a 422 rather
# than an unfiltered list.
NameQuery = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]

# A season in a path: a malformed one is a 422.
SeasonPath = Annotated[str, Path(pattern=SEASON_PATTERN)]

SEASON_NOT_FOUND = "Season not found"

# The records routes only (EVENTS-010): public, the same for every caller,
# so cacheable at the edge for five minutes (infra/lib/cdn-stack.ts's
# /api/events/records* behaviour). They never read the caller, which is
# what keeps Authorization out of the cache key safe.
RECORDS_CACHE_CONTROL = "public, max-age=300"


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


@router.get("/seasons", response_model=list[str])
def list_seasons(session: Session = Depends(get_session)) -> list[str]:
    """Every season with at least one stored game, of any type, newest
    first, as "YYYY-YY"."""
    return service.distinct_seasons(session)


@router.get("/seasons/{season}/standings", response_model=StandingsOut)
def get_standings(season: SeasonPath, session: Session = Depends(get_session)) -> service.Standings:
    """Regular-season standings by conference, then division. Within a
    conference: win percentage, then wins, then team name (`tie_break`;
    the NBA's own tie-breakers are not applied). Only `regular` games count.

    422: a malformed season (not "YYYY-YY"). 404: a well-formed season with
    no stored game."""
    found = service.standings(session, season)
    if found is None:
        raise HTTPException(status_code=404, detail=SEASON_NOT_FOUND)
    return found


@router.get("/seasons/{season}/champion", response_model=ChampionOut)
def get_champion(season: SeasonPath, session: Session = Depends(get_session)) -> service.Champion:
    """The team that won four of the season's playoff games labelled "NBA
    Finals", the runner-up and the series result. Until then all three are
    null, in a 200.

    422: a malformed season (not "YYYY-YY"). 404: a well-formed season with
    no stored game."""
    found = service.champion(session, season)
    if found is None:
        raise HTTPException(status_code=404, detail=SEASON_NOT_FOUND)
    return found


@router.get("/seasons/{season}/leaders", response_model=LeadersOut)
def get_leaders(
    season: SeasonPath,
    stat: LeaderStat,
    game_type: CareerGameType = "regular",
    limit: int = Query(10, ge=1, le=50),
    session: Session = Depends(get_session),
) -> service.Leaders:
    """The top players by per-game average of `stat` (`threes`: three-
    pointers made) over their played games of `game_type`, then by player
    id. Regular season: 65 games from 2023-24 on, before that 70 % of the
    most games any team played, rounded up; the playoffs have no minimum.
    The response names the rule and the minimum.

    422: a malformed season, an unknown `stat` or `game_type`, or `limit`
    outside 1-50. 404: a well-formed season with no stored game."""
    found = service.leaders(session, season, stat=stat, game_type=game_type, limit=limit)
    if found is None:
        raise HTTPException(status_code=404, detail=SEASON_NOT_FOUND)
    return found


@router.get("/teams/{team_id}/seasons/{season}", response_model=TeamSeasonOut)
def get_team_season(
    team_id: int, season: SeasonPath, session: Session = Depends(get_session)
) -> service.TeamSeason:
    """One team's season: its regular-season record with home and away
    splits, and every one of its games that season, of every type, newest
    first.

    422: a malformed season (not "YYYY-YY"). 404: an unknown team, or a
    well-formed season with no stored game."""
    found = service.team_season(session, team_id, season)
    if found is None:
        raise HTTPException(status_code=404, detail="Team or season not found")
    return found


@router.get("/records", response_model=RecordsSummaryOut)
def get_records(
    response: Response, session: Session = Depends(get_session)
) -> records.RecordsSummary:
    """Every historical record, team records then player records, each
    with its rule and its holder: the first entry of its list and
    `tied_count`, how many share that value; null when no stored data
    qualifies. `since_season` and `through_season` are the stored data's
    window. Cacheable: `Cache-Control: public, max-age=300`."""
    response.headers["Cache-Control"] = RECORDS_CACHE_CONTROL
    return records.records_summary(session)


@router.get("/records/{record_id}", response_model=RecordListOut)
def get_record(
    record_id: str,
    response: Response,
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0, le=99),
    session: Session = Depends(get_session),
) -> records.RecordList:
    """One page of a record's ranked list, which holds at most its top 100
    entries (a tie at the 100th place is cut by the list's order); `total`
    is how many it holds. Ordered by value (ascending for
    team-worst-season, descending for every other), then date or season,
    then id. Cacheable: `Cache-Control: public, max-age=300`.

    404: an unknown record id. 422: `limit` outside 1-100 or `offset`
    outside 0-99."""
    found = records.record_list(session, record_id, limit=limit, offset=offset)
    if found is None:
        raise HTTPException(status_code=404, detail="Record not found")
    response.headers["Cache-Control"] = RECORDS_CACHE_CONTROL
    return found
