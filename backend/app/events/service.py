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

from collections.abc import Collection, Sequence
from dataclasses import asdict, dataclass
from datetime import date, datetime, time, timedelta

from sqlalchemy import exists, or_, select
from sqlalchemy.orm import Session, aliased

from app.events.models import Game, Player, PlayerGameStats, Team

# Allow-list for search/'s position filter (wiki/CodeContext/Modules/
# 0x07-search.md), validated at the API boundary (unknown -> 422) --
# never interpolated into a query, only ever compared against this fixed
# set. Standard basketball position set. The NBA dataset's box scores carry
# a starter's position as G, F or C only (PlayerGameStats.starting_position,
# loaded by app.events.nba_history), so PG/SG/SF/PF never match a loaded game.
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


def games_by_ids(session: Session, ids: Collection[int]) -> dict[int, GameRef]:
    """Batch lookup of the narrow GameRef projection, keyed by id."""
    if not ids:
        return {}

    found = session.scalars(select(Game.id).where(Game.id.in_(ids))).all()
    return {game_id: GameRef(id=game_id) for game_id in found}


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
    home or away. `position` matches a game when any player in its box score
    started at that position: an EXISTS on PlayerGameStats (bench rows have
    no position, so only starters can match), with the position a bound
    parameter, never string SQL. Ordered by date desc."""
    stmt = select(Game)
    if season is not None:
        stmt = stmt.where(Game.season == season)
    if team_id is not None:
        stmt = stmt.where(or_(Game.home_team_id == team_id, Game.away_team_id == team_id))
    if position is not None:
        stmt = stmt.where(
            exists().where(
                PlayerGameStats.game_id == Game.id,
                PlayerGameStats.starting_position == position,
            )
        )
    stmt = stmt.order_by(Game.date.desc()).limit(limit).offset(offset)
    return list(session.scalars(stmt).all())


def distinct_seasons(session: Session) -> list[str]:
    """Distinct `season` values across all Game rows, for search/'s "year"
    filter dropdown. Newest first (judgment call -- no ordering is
    specified by wiki/CodeContext/Modules/0x07-search.md, and most-recent-
    first is the more useful default for a dropdown)."""
    return list(session.scalars(select(Game.season).distinct().order_by(Game.season.desc())).all())


def list_games(
    session: Session,
    *,
    season: str | None,
    team_id: int | None,
    game_type: str | None,
    date_from: date | None,
    date_to: date | None,
    limit: int,
    offset: int,
) -> list[Game]:
    """GET /events/games: one page of games, newest first. Filters are
    optional and ANDed; their values are validated at the route.
    `Game.date` is a naive US-Eastern timestamp, so the bounds are whole
    calendar days and `date_to` compares against the start of the next day.
    The id tie-break keeps pages over one evening from overlapping or
    skipping a game."""
    stmt = select(Game)
    if season is not None:
        stmt = stmt.where(Game.season == season)
    if team_id is not None:
        stmt = stmt.where(or_(Game.home_team_id == team_id, Game.away_team_id == team_id))
    if game_type is not None:
        stmt = stmt.where(Game.game_type == game_type)
    if date_from is not None:
        stmt = stmt.where(Game.date >= datetime.combine(date_from, time.min))
    if date_to is not None:
        stmt = stmt.where(Game.date < datetime.combine(date_to + timedelta(days=1), time.min))
    stmt = stmt.order_by(Game.date.desc(), Game.id.desc()).limit(limit).offset(offset)
    return list(session.scalars(stmt).all())


@dataclass(frozen=True)
class TeamRef:
    id: int
    name: str
    abbreviation: str


@dataclass(frozen=True)
class Shooting:
    """Counting stats with computed percentages, for one player's line or a
    team's totals (app.events.schemas.ShootingOut)."""

    seconds_played: int
    field_goals_made: int
    field_goals_attempted: int
    field_goal_pct: float | None
    three_pointers_made: int
    three_pointers_attempted: int
    three_point_pct: float | None
    free_throws_made: int
    free_throws_attempted: int
    free_throw_pct: float | None
    offensive_rebounds: int
    defensive_rebounds: int
    rebounds: int
    assists: int
    steals: int
    blocks: int
    turnovers: int
    personal_fouls: int
    points: int


@dataclass(frozen=True)
class BoxScorePlayer(Shooting):
    player_id: int
    first_name: str | None
    last_name: str | None
    starter: bool
    starting_position: str | None
    plus_minus: int


@dataclass(frozen=True)
class DidNotPlay:
    player_id: int
    first_name: str | None
    last_name: str | None
    dnp_reason: str | None


@dataclass(frozen=True)
class TeamBoxScore:
    players: list[BoxScorePlayer]
    did_not_play: list[DidNotPlay]
    totals: Shooting


@dataclass(frozen=True)
class GameDetail:
    """The read model behind GET /events/games/{id} (GameDetailOut)."""

    id: int
    nba_game_id: int
    date: datetime
    season: str
    game_type: str | None
    label: str | None
    sub_label: str | None
    series_game_number: int | None
    venue: str | None
    home_score: int
    away_score: int
    home_team: TeamRef
    away_team: TeamRef
    home_line_score: list[int] | None
    away_line_score: list[int] | None
    home_box_score: TeamBoxScore
    away_box_score: TeamBoxScore


# Summed as they are; the shooting pairs also get a percentage.
# Plus-minus is a player's figure only, never totalled.
_SUMMED_STATS: tuple[str, ...] = (
    "offensive_rebounds",
    "defensive_rebounds",
    "rebounds",
    "assists",
    "steals",
    "blocks",
    "turnovers",
    "personal_fouls",
    "points",
)


def _pct(made: int, attempted: int) -> float | None:
    """A fraction from 0 to 1, three places, as nba.com shows it; null
    when nothing was attempted. Computed, never stored."""
    return round(made / attempted, 3) if attempted else None


def _shooting(lines: Sequence[PlayerGameStats]) -> Shooting:
    """Sums of the given played lines, percentages computed from the sums:
    one line for a player's row, all of a team's for its totals."""

    def total(stat: str) -> int:
        return sum(getattr(line, stat) for line in lines)

    fgm, fga = total("field_goals_made"), total("field_goals_attempted")
    tpm, tpa = total("three_pointers_made"), total("three_pointers_attempted")
    ftm, fta = total("free_throws_made"), total("free_throws_attempted")
    return Shooting(
        seconds_played=sum(line.seconds_played or 0 for line in lines),
        field_goals_made=fgm,
        field_goals_attempted=fga,
        field_goal_pct=_pct(fgm, fga),
        three_pointers_made=tpm,
        three_pointers_attempted=tpa,
        three_point_pct=_pct(tpm, tpa),
        free_throws_made=ftm,
        free_throws_attempted=fta,
        free_throw_pct=_pct(ftm, fta),
        **{stat: total(stat) for stat in _SUMMED_STATS},
    )


def _team_box_score(rows: Sequence[tuple[PlayerGameStats, Player]]) -> TeamBoxScore:
    """Played rows starters first, then by seconds played (most first),
    then player id; DNP rows apart, by player id; totals summed from the
    played rows only, never adjusted to the final score."""
    played = sorted(
        (row for row in rows if row[0].played),
        key=lambda row: (not row[0].starter, -(row[0].seconds_played or 0), row[1].id),
    )
    benched = sorted((row for row in rows if not row[0].played), key=lambda row: row[1].id)
    return TeamBoxScore(
        players=[
            BoxScorePlayer(
                **asdict(_shooting([line])),
                player_id=player.id,
                first_name=player.first_name,
                last_name=player.last_name,
                starter=line.starter,
                starting_position=line.starting_position,
                plus_minus=line.plus_minus,
            )
            for line, player in played
        ],
        did_not_play=[
            DidNotPlay(
                player_id=player.id,
                first_name=player.first_name,
                last_name=player.last_name,
                dnp_reason=line.dnp_reason,
            )
            for line, player in benched
        ],
        totals=_shooting([line for line, _ in played]),
    )


def _team_ref(team: Team) -> TeamRef:
    return TeamRef(id=team.id, name=team.name, abbreviation=team.abbreviation)


def game_detail(session: Session, game_id: int) -> GameDetail | None:
    """GET /events/games/{id}'s read model, or None for an unknown id. Two
    queries whatever the box score's size: the game with both teams, then
    every box-score row of the game with its player, grouped here by team.
    A game without rows gets empty lists and zero totals."""
    home, away = aliased(Team), aliased(Team)
    found = session.execute(
        select(Game, home, away)
        .join(home, home.id == Game.home_team_id)
        .join(away, away.id == Game.away_team_id)
        .where(Game.id == game_id)
    ).one_or_none()
    if found is None:
        return None
    game, home_team, away_team = found

    by_team: dict[int, list[tuple[PlayerGameStats, Player]]] = {
        game.home_team_id: [],
        game.away_team_id: [],
    }
    rows = session.execute(
        select(PlayerGameStats, Player)
        .join(Player, Player.id == PlayerGameStats.player_id)
        .where(PlayerGameStats.game_id == game_id)
    ).tuples()
    for line, player in rows:
        # The loader stores rows for the game's two teams only.
        by_team[line.team_id].append((line, player))

    return GameDetail(
        id=game.id,
        nba_game_id=game.nba_game_id,
        date=game.date,
        season=game.season,
        game_type=game.game_type,
        label=game.label,
        sub_label=game.sub_label,
        series_game_number=game.series_game_number,
        venue=game.venue,
        home_score=game.home_score,
        away_score=game.away_score,
        home_team=_team_ref(home_team),
        away_team=_team_ref(away_team),
        home_line_score=game.home_line_score,
        away_line_score=game.away_line_score,
        home_box_score=_team_box_score(by_team[game.home_team_id]),
        away_box_score=_team_box_score(by_team[game.away_team_id]),
    )
