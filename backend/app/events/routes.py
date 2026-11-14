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
    LeaderBoardsOut,
    LeadersOut,
    LeaderStat,
    PlayerDetailOut,
    PlayerGameOut,
    PlayerListItemOut,
    RecentGameOut,
    RecordHoldersOut,
    RecordListOut,
    RecordsCatalogOut,
    ScheduleOut,
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


@router.get("/games/recent", response_model=list[RecentGameOut])
def get_recent_games(
    limit: int = Query(5, ge=1, le=10),
    session: Session = Depends(get_session),
) -> list[service.RecentGame]:
    """Completed games on the newest `limit` calendar dates: newest date first,
    then strongest league-wide matchup (lowest season rank sum) within a date."""
    return service.recent_games(session, limit)


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
    id. Regular season: from 2023-24, 65 games once the season has a
    champion and, while it is in progress, the games on pace for 65:
    ceil(65 x T / 82), at most 65, T the most games any team has played;
    before 2023-24, 70 % of T, rounded up. The playoffs have no minimum.
    The response names the rule and the minimum.

    422: a malformed season, an unknown `stat` or `game_type`, or `limit`
    outside 1-50. 404: a well-formed season with no stored game."""
    found = service.leaders(session, season, stat=stat, game_type=game_type, limit=limit)
    if found is None:
        raise HTTPException(status_code=404, detail=SEASON_NOT_FOUND)
    return found


@router.get("/seasons/{season}/leader-boards", response_model=LeaderBoardsOut)
def get_leader_boards(
    season: SeasonPath,
    limit: int = Query(10, ge=1, le=10),
    session: Session = Depends(get_session),
) -> service.LeaderBoards:
    """The season's regular-season leader boards in one read, each its top
    `limit`: points, assists, rebounds, blocks, steals, field goals made,
    threes (per-game averages, then player id), field-goal and three-point
    percentage (total made / attempted, then player id) and field goals and
    threes attempted (per-game averages).

    `complete` is true once the season has a champion. Every board needs
    the games rule `GET .../leaders` applies to the regular season: from
    2023-24, 65 games when complete and ceil(65 x T / 82), at most 65,
    while in progress (T the most games any team has played); before that,
    70 % of T, rounded up. The percentage boards also need 300 field goals
    or 82 threes made, ceil(base x T / 82), at most the base, while in
    progress. Each rule is named in the response.

    422: a malformed season or `limit` outside 1-10. 404: a well-formed
    season with no stored game."""
    found = service.leader_boards(session, season, limit=limit)
    if found is None:
        raise HTTPException(status_code=404, detail=SEASON_NOT_FOUND)
    return found


@router.get("/seasons/{season}/schedule", response_model=ScheduleOut)
def get_schedule(
    season: SeasonPath,
    team_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    session: Session = Depends(get_session),
) -> service.Schedule:
    """The season's played and upcoming games together, by date, then
    nba_game_id: every stored game (`final`, with its `game_id` and score)
    and every published schedule row not yet played (`scheduled`, no
    `game_id` or score). A game in both is listed once, as `final`, with the
    stored game's fields. No other route returns unplayed games.

    Optional filters: `team_id` (that team's home and away games),
    `date_from` and `date_to` (inclusive, on the game's US Eastern calendar
    date). Filters that match nothing are an empty `games` list.

    422: a malformed season (not "YYYY-YY") or date, or `date_from` after
    `date_to`. 404: a well-formed season with neither a stored game nor a
    schedule row, or an unknown `team_id`."""
    if date_from is not None and date_to is not None and date_from > date_to:
        raise HTTPException(status_code=422, detail="date_from is after date_to")
    found = service.season_schedule(
        session, season, team_id=team_id, date_from=date_from, date_to=date_to
    )
    if found is None:
        raise HTTPException(status_code=404, detail="Season or team not found")
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


@router.get("/records", response_model=RecordsCatalogOut)
def get_records(
    response: Response, session: Session = Depends(get_session)
) -> records.RecordsCatalog:
    """The records library's catalog: every record, team records first, with
    its category, rule, `value_kind` (which of an entry's figures it fills),
    search `keywords` and `featured_rank`, and no holder (GET
    /events/records/holders). `since_season` and `through_season` are the
    stored data's window. Cacheable: `Cache-Control: public, max-age=300`."""
    response.headers["Cache-Control"] = RECORDS_CACHE_CONTROL
    return records.records_catalog(session)


# Declared before /records/{record_id}, or "holders" would be read as an id.
@router.get("/records/holders", response_model=RecordHoldersOut)
def get_record_holders(
    response: Response,
    ids: str = Query(
        ...,
        description="1 to 24 distinct record ids, comma-separated. Sort them, so the same"
        " set is the same cache entry.",
    ),
    session: Session = Depends(get_session),
) -> records.RecordHolders:
    """Each named record's holder: the first entry of its list,
    `tied_count`, how many share that value, and `top`, the list's first
    three entries exactly as GET /events/records/{record_id} returns them;
    null when no stored data qualifies. Cacheable: `Cache-Control: public, max-age=300`.

    422: `ids` missing or empty, naming more than 24 records, repeating one,
    or naming an unknown record."""
    try:
        wanted = records.holder_ids(ids)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    response.headers["Cache-Control"] = RECORDS_CACHE_CONTROL
    return records.record_holders(session, wanted)


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
