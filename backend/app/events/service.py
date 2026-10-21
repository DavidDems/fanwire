"""Plain functions operating on an injected Session -- no service class, no
hidden session/state (KISS, wiki/CodeContext/Standards/design-principles.md,
matching app.users.service/app.posts.service/app.media.service's exact
style).

game_ids_for_team/games_by_ids are events/'s public read interface for
feed/ (a later unit, per wiki/CodeContext/Modules/0x06-feed.md's Connection
rule): feed/ owns no tables of its own, so it reads Game through here
instead of querying app.events.models directly.

validate_*/*_previews are the same for posts/' sports-data attachments
(EVENTS-009): posts/ never imports app.events.models.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy import (
    RowMapping,
    Select,
    SQLColumnExpression,
    Text,
    case,
    exists,
    func,
    literal,
    or_,
    select,
)
from sqlalchemy.orm import Session, aliased
from sqlalchemy.sql.elements import ColumnElement

from app.events.errors import (
    GameNotCompletedError,
    LinkTargetNotFoundError,
    NoGamesInScopeError,
    PlayerDidNotPlayError,
)
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
    # The player_game_stats row's id: a `player_game` attachment's target.
    line_id: int
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
# Every counting stat: the shooting pairs, then the summed-as-they-are ones.
_COUNTING_STATS: tuple[str, ...] = (
    "field_goals_made",
    "field_goals_attempted",
    "three_pointers_made",
    "three_pointers_attempted",
    "free_throws_made",
    "free_throws_attempted",
    *_SUMMED_STATS,
)


def _pct(made: int, attempted: int) -> float | None:
    """A fraction from 0 to 1, three places, as nba.com shows it; null
    when nothing was attempted. Computed, never stored."""
    return round(made / attempted, 3) if attempted else None


def _shooting(lines: Sequence[PlayerGameStats]) -> Shooting:
    """Sums of the given played lines, percentages computed from the sums:
    one line for a player's row, all of a team's for its totals."""

    totals = {stat: sum(getattr(line, stat) for line in lines) for stat in _COUNTING_STATS}
    return _shooting_from_totals(sum(line.seconds_played or 0 for line in lines), totals)


def _shooting_from_totals(seconds_played: int, totals: Mapping[str, int]) -> Shooting:
    """A Shooting from already-summed counting stats (keyed by
    _COUNTING_STATS): the box score sums in Python, the player lines in
    Postgres, and both get their percentages here."""
    return Shooting(
        seconds_played=seconds_played,
        field_goal_pct=_pct(totals["field_goals_made"], totals["field_goals_attempted"]),
        three_point_pct=_pct(totals["three_pointers_made"], totals["three_pointers_attempted"]),
        free_throw_pct=_pct(totals["free_throws_made"], totals["free_throws_attempted"]),
        **{stat: totals[stat] for stat in _COUNTING_STATS},
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
                line_id=line.id,
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


# ------------------------------------------------------------------ players
#
# EVENTS-006. Every line is computed at read time from player_game_stats:
# no aggregate table (YAGNI, wiki/CodeContext/Modules/0x02-events.md).


@dataclass(frozen=True)
class PlayerListItem:
    """One player in GET /events/players' list (PlayerListItemOut)."""

    id: int
    first_name: str | None
    last_name: str | None
    position: str | None
    jersey: str | None
    first_season: str | None
    last_season: str | None
    latest_team_abbreviation: str | None


@dataclass(frozen=True)
class StatLine(Shooting):
    """A career or season line (app.events.schemas.StatLineOut)."""

    games_played: int
    games_started: int
    points_per_game: float | None
    rebounds_per_game: float | None
    assists_per_game: float | None
    steals_per_game: float | None
    blocks_per_game: float | None
    turnovers_per_game: float | None
    three_pointers_made_per_game: float | None
    minutes_per_game: float | None


@dataclass(frozen=True)
class SeasonLine(StatLine):
    season: str
    game_type: str
    teams: list[str]


@dataclass(frozen=True)
class PlayerDetail:
    """The read model behind GET /events/players/{id} (PlayerDetailOut)."""

    id: int
    first_name: str | None
    last_name: str | None
    birth_date: date | None
    height_inches: int | None
    weight_lbs: int | None
    country: str | None
    school: str | None
    jersey: str | None
    position: str | None
    draft_year: int | None
    draft_round: int | None
    draft_number: int | None
    first_season: str | None
    last_season: str | None
    career_regular: StatLine
    career_playoffs: StatLine
    seasons: list[SeasonLine]


@dataclass(frozen=True)
class PlayerGame:
    """One row of a player's game log (PlayerGameOut)."""

    game_id: int
    date: datetime
    season: str
    game_type: str | None
    label: str | None
    team: TeamRef
    opponent: TeamRef
    is_home: bool
    team_score: int
    opponent_score: int
    starter: bool
    starting_position: str | None
    seconds_played: int | None
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
    plus_minus: int
    dnp_reason: str | None


# The game types a career or season line counts: play-in and the NBA Cup
# final are in neither, the NBA's own rule (Prompts/06, decision 5).
LINE_GAME_TYPES: tuple[str, ...] = ("regular", "playoffs")

# The aggregates a line is built from, named as StatLine names them.
_LINE_KEYS: tuple[str, ...] = (
    "games_played",
    "games_started",
    "seconds_played",
    *_COUNTING_STATS,
)

_PCTS: tuple[str, ...] = ("field_goal_pct", "three_point_pct", "free_throw_pct")

# LIKE's escape character for the name search's patterns.
_LIKE_ESCAPE = "\\"


def _folded(value: SQLColumnExpression[str | None]) -> ColumnElement[str]:
    """Lower-cased and accent-stripped (Postgres `unaccent`), so a name
    typed without its diacritics or in any case still compares equal."""
    return func.lower(func.unaccent(value, type_=Text), type_=Text)


def _escape_like(word: str) -> str:
    """`word` with LIKE's wildcards and the escape character made literal."""
    return (
        word.replace(_LIKE_ESCAPE, _LIKE_ESCAPE * 2)
        .replace("%", _LIKE_ESCAPE + "%")
        .replace("_", _LIKE_ESCAPE + "_")
    )


def _name_word_matches(word: str) -> ColumnElement[bool]:
    """`word` is a prefix of the first or the last name, case- and accent-
    insensitively. The word is a bound parameter, never string SQL."""
    pattern = _folded(literal(_escape_like(word), Text)).concat("%")
    return or_(
        _folded(Player.first_name).like(pattern, escape=_LIKE_ESCAPE),
        _folded(Player.last_name).like(pattern, escape=_LIKE_ESCAPE),
    )


def list_players(
    session: Session,
    *,
    q: str | None,
    season: str | None,
    limit: int,
    offset: int,
) -> list[PlayerListItem]:
    """GET /events/players: one page ordered by last name, first name, id.
    `q` (already trimmed and length-checked at the route) matches when
    every whitespace-separated word is a prefix of either name. `season`
    keeps players with a played row in it. Two queries: the page, then each
    paged player's newest box-score row's team (DNP rows included), by game
    date then game id. No index: unaccent() is not IMMUTABLE, and ~2,400
    players are a sequential scan (measured, 0x02-events.md)."""
    stmt = select(Player)
    if q is not None:
        stmt = stmt.where(*(_name_word_matches(word) for word in q.split()))
    if season is not None:
        stmt = stmt.where(
            exists()
            .where(
                PlayerGameStats.player_id == Player.id,
                PlayerGameStats.played,
                Game.id == PlayerGameStats.game_id,
                Game.season == season,
            )
            .correlate(Player)
        )
    stmt = stmt.order_by(Player.last_name, Player.first_name, Player.id).limit(limit).offset(offset)
    players = list(session.scalars(stmt).all())
    if not players:
        return []

    # A Result has .keys(), so dict() would read it as a mapping.
    latest = {
        player_id: abbreviation
        for player_id, abbreviation in session.execute(
            select(PlayerGameStats.player_id, Team.abbreviation)
            .join(Game, Game.id == PlayerGameStats.game_id)
            .join(Team, Team.id == PlayerGameStats.team_id)
            .where(PlayerGameStats.player_id.in_([player.id for player in players]))
            .distinct(PlayerGameStats.player_id)
            .order_by(PlayerGameStats.player_id, Game.date.desc(), Game.id.desc())
        ).tuples()
    }
    return [
        PlayerListItem(
            id=player.id,
            first_name=player.first_name,
            last_name=player.last_name,
            position=player.position,
            jersey=player.jersey,
            first_season=player.first_season,
            last_season=player.last_season,
            latest_team_abbreviation=latest.get(player.id),
        )
        for player in players
    ]


def _line_columns() -> list[ColumnElement[int] | ColumnElement[int | None]]:
    """The aggregates of a line, labelled with _LINE_KEYS."""
    return [
        func.count().label("games_played"),
        func.count().filter(PlayerGameStats.starter).label("games_started"),
        func.sum(PlayerGameStats.seconds_played).label("seconds_played"),
        *(func.sum(getattr(PlayerGameStats, stat)).label(stat) for stat in _COUNTING_STATS),
    ]


def _per_game(total: float, games: int) -> float | None:
    return round(total / games, 1) if games else None


def _line_values(row: RowMapping) -> dict[str, int]:
    """One GROUP BY row of _line_columns(), keyed by _LINE_KEYS. A group
    has at least one played row, so no sum is null."""
    return {key: int(row[key]) for key in _LINE_KEYS}


# A line with no game: zeros, so null averages and percentages.
_NO_GAMES: dict[str, int] = dict.fromkeys(_LINE_KEYS, 0)


def _stat_line(values: Mapping[str, int]) -> StatLine:
    """A StatLine from summed values keyed by _LINE_KEYS. Percentages are
    the box score's (_shooting_from_totals, _pct); averages one place."""
    games = values["games_played"]
    totals = {stat: values[stat] for stat in _COUNTING_STATS}
    return StatLine(
        **asdict(_shooting_from_totals(values["seconds_played"], totals)),
        games_played=games,
        games_started=values["games_started"],
        points_per_game=_per_game(totals["points"], games),
        rebounds_per_game=_per_game(totals["rebounds"], games),
        assists_per_game=_per_game(totals["assists"], games),
        steals_per_game=_per_game(totals["steals"], games),
        blocks_per_game=_per_game(totals["blocks"], games),
        turnovers_per_game=_per_game(totals["turnovers"], games),
        three_pointers_made_per_game=_per_game(totals["three_pointers_made"], games),
        minutes_per_game=_per_game(values["seconds_played"] / 60, games),
    )


def player_detail(session: Session, player_id: int) -> PlayerDetail | None:
    """GET /events/players/{id}'s read model, or None for an unknown id.
    Four queries whatever the career's length: the player, the career lines
    (GROUP BY game type), the season lines (GROUP BY season and game type)
    and each season's teams in the order first played. Only played rows of
    LINE_GAME_TYPES games count."""
    player = session.get(Player, player_id)
    if player is None:
        return None

    counted = (
        PlayerGameStats.player_id == player_id,
        PlayerGameStats.played,
        Game.game_type.in_(LINE_GAME_TYPES),
    )
    joined = select().select_from(PlayerGameStats).join(Game, Game.id == PlayerGameStats.game_id)

    careers = {
        row.game_type: _stat_line(_line_values(row._mapping))
        for row in session.execute(
            joined.add_columns(Game.game_type, *_line_columns())
            .where(*counted)
            .group_by(Game.game_type)
        )
    }

    teams: dict[tuple[str, str], list[str]] = {}
    for season, game_type, abbreviation in session.execute(
        joined.add_columns(Game.season, Game.game_type, Team.abbreviation)
        .join(Team, Team.id == PlayerGameStats.team_id)
        .where(*counted)
        .group_by(Game.season, Game.game_type, Team.id, Team.abbreviation)
        .order_by(func.min(Game.date), func.min(Game.id))
    ).tuples():
        teams.setdefault((season, game_type), []).append(abbreviation)

    seasons = [
        SeasonLine(
            **asdict(_stat_line(_line_values(row._mapping))),
            season=row.season,
            game_type=row.game_type,
            teams=teams[(row.season, row.game_type)],
        )
        for row in session.execute(
            joined.add_columns(Game.season, Game.game_type, *_line_columns())
            .where(*counted)
            .group_by(Game.season, Game.game_type)
            # Newest season first; within one, "regular" before "playoffs".
            .order_by(Game.season.desc(), Game.game_type.desc())
        )
    ]

    return PlayerDetail(
        id=player.id,
        first_name=player.first_name,
        last_name=player.last_name,
        birth_date=player.birth_date,
        height_inches=player.height_inches,
        weight_lbs=player.weight_lbs,
        country=player.country,
        school=player.school,
        jersey=player.jersey,
        position=player.position,
        draft_year=player.draft_year,
        draft_round=player.draft_round,
        draft_number=player.draft_number,
        first_season=player.first_season,
        last_season=player.last_season,
        career_regular=careers.get("regular") or _stat_line(_NO_GAMES),
        career_playoffs=careers.get("playoffs") or _stat_line(_NO_GAMES),
        seasons=seasons,
    )


def player_games(
    session: Session,
    player_id: int,
    *,
    season: str | None,
    game_type: str | None,
    limit: int,
    offset: int,
) -> list[PlayerGame] | None:
    """GET /events/players/{id}/games: one page of the player's box-score
    rows, played and did-not-play, every game type, newest first by game
    date then game id; None for an unknown player. Two queries whatever the
    career's length: the player, then the page with both teams. Filters are
    optional and ANDed; their values are validated at the route."""
    if session.get(Player, player_id) is None:
        return None

    team, opponent = aliased(Team), aliased(Team)
    is_home = Game.home_team_id == PlayerGameStats.team_id
    stmt = (
        select(PlayerGameStats, Game, team, opponent)
        .join(Game, Game.id == PlayerGameStats.game_id)
        .join(team, team.id == PlayerGameStats.team_id)
        .join(
            opponent,
            opponent.id == case((is_home, Game.away_team_id), else_=Game.home_team_id),
        )
        .where(PlayerGameStats.player_id == player_id)
    )
    if season is not None:
        stmt = stmt.where(Game.season == season)
    if game_type is not None:
        stmt = stmt.where(Game.game_type == game_type)
    stmt = stmt.order_by(Game.date.desc(), Game.id.desc()).limit(limit).offset(offset)

    rows: list[PlayerGame] = []
    for line, game, own, other in session.execute(stmt).tuples():
        home = game.home_team_id == line.team_id
        shooting = _shooting([line])
        rows.append(
            PlayerGame(
                **{stat: getattr(shooting, stat) for stat in (*_COUNTING_STATS, *_PCTS)},
                game_id=game.id,
                date=game.date,
                season=game.season,
                game_type=game.game_type,
                label=game.label,
                team=_team_ref(own),
                opponent=_team_ref(other),
                is_home=home,
                team_score=game.home_score if home else game.away_score,
                opponent_score=game.away_score if home else game.home_score,
                starter=line.starter,
                starting_position=line.starting_position,
                seconds_played=line.seconds_played,
                plus_minus=line.plus_minus,
                dnp_reason=line.dnp_reason,
            )
        )
    return rows


# ------------------------------------------------------------------ seasons
#
# EVENTS-007. Standings, the champion, stat leaders and a team's season,
# computed at read time with GROUP BY in Postgres: no aggregate table.
# Each read model is None for a season with no stored game (the route's 404).

# Only `regular` games make a record: NBA Cup group and knockout games are
# regular; play-in, playoffs and the cup final are not (decision 5).
REGULAR = "regular"

# The ordering standings apply; the NBA's own tie-breakers are not.
STANDINGS_TIE_BREAK = "Win percentage, then wins, then team name (NBA tie-breakers not applied)"

# The dataset's label on every Finals game (tests/fixtures/nba_data/Games.csv).
FINALS_LABEL = "NBA Finals"
FINALS_WINS = 4

# The box-score column behind each leaders `stat`; threes are made threes.
LEADER_STATS: dict[str, str] = {
    "points": "points",
    "rebounds": "rebounds",
    "assists": "assists",
    "steals": "steals",
    "blocks": "blocks",
    "threes": "three_pointers_made",
}

# From 2023-24 the NBA requires 65 games for awards and leaderboards.
GAMES_RULE_FROM = "2023-24"
GAMES_RULE_MINIMUM = 65
# Before it, 70 % of the most games any team played, rounded up: the proxy
# the human accepted for the NBA's per-stat minimums (Prompts/06).
TEAM_GAMES_PERCENT = 70


@dataclass(frozen=True)
class Record:
    """A team's regular-season record, with home and away splits."""

    wins: int
    losses: int
    home_wins: int
    home_losses: int
    away_wins: int
    away_losses: int


_NO_RECORD = Record(0, 0, 0, 0, 0, 0)


@dataclass(frozen=True)
class StandingRow(Record):
    team: TeamRef
    win_pct: float
    games_behind: float


@dataclass(frozen=True)
class DivisionStandings:
    division: str
    teams: list[StandingRow]


@dataclass(frozen=True)
class ConferenceStandings:
    conference: str
    divisions: list[DivisionStandings]


@dataclass(frozen=True)
class Standings:
    """The read model behind GET /events/seasons/{season}/standings."""

    season: str
    tie_break: str
    conferences: list[ConferenceStandings]


@dataclass(frozen=True)
class Champion:
    """GET /events/seasons/{season}/champion: all three null until a team
    has won FINALS_WINS Finals games."""

    season: str
    champion: TeamRef | None
    runner_up: TeamRef | None
    result: str | None


@dataclass(frozen=True)
class Leader:
    player_id: int
    first_name: str | None
    last_name: str | None
    teams: list[str]
    games_played: int
    average: float


@dataclass(frozen=True)
class Leaders:
    """GET /events/seasons/{season}/leaders: the rule applied, its minimum
    (0 for the playoffs) and the leaders."""

    season: str
    stat: str
    game_type: str
    rule: str
    minimum_games: int
    leaders: list[Leader]


@dataclass(frozen=True)
class TeamSeasonGame:
    game_id: int
    date: datetime
    game_type: str | None
    label: str | None
    sub_label: str | None
    opponent: TeamRef
    is_home: bool
    team_score: int
    opponent_score: int
    won: bool


@dataclass(frozen=True)
class TeamSeason:
    """GET /events/teams/{team_id}/seasons/{season}."""

    season: str
    team: Team
    record: Record
    games: list[TeamSeasonGame]


def season_has_games(session: Session, season: str) -> bool:
    """Whether any game of any type is stored for `season`."""
    return bool(session.scalar(select(exists().where(Game.season == season))))


def _team_won() -> ColumnElement[bool]:
    """In a query joining Team to the games it played: it won this one."""
    return case(
        (Game.home_team_id == Team.id, Game.home_score > Game.away_score),
        else_=Game.away_score > Game.home_score,
    )


def _team_games(*columns: ColumnElement[Any]) -> Select[Any]:
    """Team joined to every game it played, home or away, one group per
    team: `columns` are its aggregates."""
    return (
        select(Team, *columns)
        .join(Game, or_(Game.home_team_id == Team.id, Game.away_team_id == Team.id))
        .group_by(Team.id)
    )


def _records(
    session: Session, season: str, team_id: int | None = None
) -> list[tuple[Team, Record]]:
    """Every team's regular-season record in `season` (one GROUP BY), or
    only `team_id`'s. A team without a regular game has no row."""
    won, is_home = _team_won(), Game.home_team_id == Team.id
    stmt = _team_games(
        func.count().filter(won),
        func.count().filter(~won),
        func.count().filter(is_home, won),
        func.count().filter(is_home, ~won),
        func.count().filter(~is_home, won),
        func.count().filter(~is_home, ~won),
    ).where(Game.season == season, Game.game_type == REGULAR)
    if team_id is not None:
        stmt = stmt.where(Team.id == team_id)
    return [(team, Record(*counts)) for team, *counts in session.execute(stmt).tuples()]


def standings(session: Session, season: str) -> Standings | None:
    """Regular-season standings by conference, then division. Two queries:
    the season check and one GROUP BY. Within a conference, teams are
    ordered by win percentage (exact, not the rounded figure), then wins,
    then name; games behind is against the first of that order."""
    if not season_has_games(session, season):
        return None

    def order(entry: tuple[Team, Record]) -> tuple[float, int, str]:
        team, record = entry
        return (-record.wins / (record.wins + record.losses), -record.wins, team.name)

    by_conference: dict[str, list[tuple[Team, Record]]] = {}
    for entry in sorted(_records(session, season), key=order):
        by_conference.setdefault(entry[0].conference, []).append(entry)

    conferences = []
    for conference, entries in sorted(by_conference.items()):
        leader = entries[0][1]
        divisions: dict[str, list[StandingRow]] = {}
        for team, record in entries:
            behind = (leader.wins - record.wins) + (record.losses - leader.losses)
            divisions.setdefault(team.division, []).append(
                StandingRow(
                    **asdict(record),
                    team=_team_ref(team),
                    # A listed team has played, so the percentage is never null.
                    win_pct=_pct(record.wins, record.wins + record.losses) or 0.0,
                    games_behind=behind / 2,
                )
            )
        conferences.append(
            ConferenceStandings(
                conference=conference,
                divisions=[
                    DivisionStandings(division=division, teams=rows)
                    for division, rows in sorted(divisions.items())
                ],
            )
        )
    return Standings(season=season, tie_break=STANDINGS_TIE_BREAK, conferences=conferences)


def champion(session: Session, season: str) -> Champion | None:
    """The team with FINALS_WINS wins in the season's `playoffs` games
    labelled FINALS_LABEL, the other Finals team and the series score. Two
    queries: the season check and one GROUP BY of Finals wins per team."""
    if not season_has_games(session, season):
        return None

    wins = func.count().filter(_team_won())
    finals = (
        session.execute(
            _team_games(wins)
            .where(
                Game.season == season,
                Game.game_type == "playoffs",
                Game.label == FINALS_LABEL,
            )
            .order_by(wins.desc(), Team.id)
        )
        .tuples()
        .all()
    )
    if not finals or finals[0][1] < FINALS_WINS:
        return Champion(season=season, champion=None, runner_up=None, result=None)
    (winner, won), *others = finals
    runner_up, lost = others[0] if others else (None, 0)
    return Champion(
        season=season,
        champion=_team_ref(winner),
        runner_up=_team_ref(runner_up) if runner_up is not None else None,
        result=f"{won}-{lost}",
    )


def _qualifier(session: Session, season: str, game_type: str) -> tuple[int, str]:
    """The minimum games a leader must have played, and the rule's name."""
    if game_type != REGULAR:
        return 0, "No minimum in the playoffs"
    # "YYYY-YY" strings order as their seasons do.
    if season >= GAMES_RULE_FROM:
        return GAMES_RULE_MINIMUM, f"{GAMES_RULE_MINIMUM} games (NBA rule from {GAMES_RULE_FROM})"
    per_team = (
        _team_games(func.count().label("games"))
        .where(Game.season == season, Game.game_type == REGULAR)
        .subquery()
    )
    team_games = int(session.scalar(select(func.max(per_team.c.games))) or 0)
    # Rounded up in integers: 0.7 * 10 is 7.000000000000001 in floating point.
    minimum = -(-team_games * TEAM_GAMES_PERCENT // 100)
    return minimum, f"{TEAM_GAMES_PERCENT}% of {team_games} team games, rounded up: {minimum}"


def leaders(
    session: Session, season: str, *, stat: str, game_type: str, limit: int
) -> Leaders | None:
    """The top `limit` players by per-game average of `stat` over their
    played rows of `game_type` games, among those with the qualifier's
    minimum games; ordered by the exact average, then player id. Two or
    three queries: the season check, the regular season's most team games
    (before 2023-24 only), and one GROUP BY per player."""
    if not season_has_games(session, season):
        return None

    minimum, rule = _qualifier(session, season, game_type)
    column = getattr(PlayerGameStats, LEADER_STATS[stat])
    games = func.count()
    rows = session.execute(
        select(
            Player.id,
            Player.first_name,
            Player.last_name,
            func.array_agg(Team.abbreviation.distinct()),
            games,
            func.sum(column),
        )
        .select_from(PlayerGameStats)
        .join(Game, Game.id == PlayerGameStats.game_id)
        .join(Player, Player.id == PlayerGameStats.player_id)
        .join(Team, Team.id == PlayerGameStats.team_id)
        .where(Game.season == season, Game.game_type == game_type, PlayerGameStats.played)
        .group_by(Player.id)
        .having(games >= minimum)
        .order_by(func.avg(column).desc(), Player.id)
        .limit(limit)
    ).tuples()
    return Leaders(
        season=season,
        stat=stat,
        game_type=game_type,
        rule=rule,
        minimum_games=minimum,
        leaders=[
            Leader(
                player_id=player_id,
                first_name=first_name,
                last_name=last_name,
                teams=list(teams),
                games_played=played,
                # A group has at least one played row, so never null.
                average=_per_game(total, played) or 0.0,
            )
            for player_id, first_name, last_name, teams, played, total in rows
        ],
    )


def team_season(session: Session, team_id: int, season: str) -> TeamSeason | None:
    """One team's season: its regular-season record and every one of its
    games, of every type, newest first. Four queries whatever the season's
    size: the team, the season check, the record and the games with their
    opponents. None for an unknown team or a season with no stored game."""
    team = session.get(Team, team_id)
    if team is None or not season_has_games(session, season):
        return None

    record = next((found for _, found in _records(session, season, team_id)), _NO_RECORD)
    opponent = aliased(Team)
    is_home = Game.home_team_id == team_id
    games = []
    for game, other in session.execute(
        select(Game, opponent)
        .join(opponent, opponent.id == case((is_home, Game.away_team_id), else_=Game.home_team_id))
        .where(Game.season == season, or_(is_home, Game.away_team_id == team_id))
        .order_by(Game.date.desc(), Game.id.desc())
    ).tuples():
        home = game.home_team_id == team_id
        own, theirs = (
            (game.home_score, game.away_score) if home else (game.away_score, game.home_score)
        )
        games.append(
            TeamSeasonGame(
                game_id=game.id,
                date=game.date,
                game_type=game.game_type,
                label=game.label,
                sub_label=game.sub_label,
                opponent=_team_ref(other),
                is_home=home,
                team_score=own,
                opponent_score=theirs,
                won=own > theirs,
            )
        )
    return TeamSeason(season=season, team=team, record=record, games=games)


# -------------------------------------------------------------- attachments
#
# EVENTS-009. posts/' sports-data attachments: `game_final` (a game id),
# `player_game` (a player_game_stats id) and `player_career` (a player id
# and a scope, computed live). Create validates one target with a precise
# refusal (app.events.errors); reads take previews in batches and leave out
# an id with no row, so one odd target never fails a page.

# A career attachment's scopes: the game types a career line counts.
CAREER_SCOPES: tuple[str, ...] = LINE_GAME_TYPES


@dataclass(frozen=True)
class GameFinalPreview:
    """A `game_final` attachment's preview: the game and its final score."""

    game_id: int
    date: datetime
    season: str
    game_type: str | None
    label: str | None
    sub_label: str | None
    series_game_number: int | None
    home_team: TeamRef
    away_team: TeamRef
    home_score: int
    away_score: int


@dataclass(frozen=True)
class PlayerGamePreview:
    """A `player_game` attachment's preview: one box-score line and its
    game, from the player's side. A DNP line is as stored: no minutes, its
    reason, zeros."""

    line_id: int
    game_id: int
    player_id: int
    first_name: str | None
    last_name: str | None
    team: TeamRef
    opponent: TeamRef
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


# The box-score figures a line preview carries: every counting stat and
# percentage but the rebound split and fouls.
_PLAYER_GAME_STATS: tuple[str, ...] = tuple(
    stat
    for stat in (*_COUNTING_STATS, *_PCTS)
    if stat not in ("offensive_rebounds", "defensive_rebounds", "personal_fouls")
)

# The StatLine figures a career preview carries.
_CAREER_FIGURES: tuple[str, ...] = (
    "games_played",
    "points_per_game",
    "rebounds_per_game",
    "assists_per_game",
    "minutes_per_game",
    *_PCTS,
)


@dataclass(frozen=True)
class PlayerCareerPreview:
    """A `player_career` attachment's preview: the player and the career
    line of one scope, player_detail's career_regular or career_playoffs."""

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


def validate_game_final(session: Session, game_id: int) -> None:
    """A `game_final` target must be a completed game."""
    game = session.get(Game, game_id)
    if game is None:
        raise LinkTargetNotFoundError(f"no game {game_id}")
    if not game.completed:
        raise GameNotCompletedError(f"game {game_id} has no result")


def validate_player_game(session: Session, line_id: int) -> None:
    """A `player_game` target must be a played line (zero seconds counts)."""
    line = session.get(PlayerGameStats, line_id)
    if line is None:
        raise LinkTargetNotFoundError(f"no box-score line {line_id}")
    if not line.played:
        raise PlayerDidNotPlayError(f"box-score line {line_id} did not play")


def validate_player_career(session: Session, player_id: int, scope: str) -> None:
    """A `player_career` target must be a player with a played row in a game
    of `scope`'s type, player_detail's counting rule. A scope outside
    CAREER_SCOPES is a plain ValueError: the request is wrong, not the
    target, so it is checked before any query."""
    if scope not in CAREER_SCOPES:
        raise ValueError(f"unknown career scope {scope!r}")
    if session.get(Player, player_id) is None:
        raise LinkTargetNotFoundError(f"no player {player_id}")
    has_games = session.scalar(
        select(
            exists().where(
                PlayerGameStats.player_id == player_id,
                PlayerGameStats.played,
                Game.id == PlayerGameStats.game_id,
                Game.game_type == scope,
            )
        )
    )
    if not has_games:
        raise NoGamesInScopeError(f"player {player_id} has no {scope} game")


def game_final_previews(session: Session, game_ids: Collection[int]) -> dict[int, GameFinalPreview]:
    """Previews keyed by game id; an unknown id is absent. One query
    whatever the number of ids (the games with both teams), none for none."""
    if not game_ids:
        return {}

    home, away = aliased(Team), aliased(Team)
    rows = session.execute(
        select(Game, home, away)
        .join(home, home.id == Game.home_team_id)
        .join(away, away.id == Game.away_team_id)
        .where(Game.id.in_(game_ids))
    ).tuples()
    return {
        game.id: GameFinalPreview(
            game_id=game.id,
            date=game.date,
            season=game.season,
            game_type=game.game_type,
            label=game.label,
            sub_label=game.sub_label,
            series_game_number=game.series_game_number,
            home_team=_team_ref(home_team),
            away_team=_team_ref(away_team),
            home_score=game.home_score,
            away_score=game.away_score,
        )
        for game, home_team, away_team in rows
    }


def player_game_previews(
    session: Session, line_ids: Collection[int]
) -> dict[int, PlayerGamePreview]:
    """Previews keyed by line id; an unknown id is absent, a DNP line is
    returned as stored. One query whatever the number of ids (the lines with
    their game, player and both teams), none for none."""
    if not line_ids:
        return {}

    team, opponent = aliased(Team), aliased(Team)
    is_home = Game.home_team_id == PlayerGameStats.team_id
    rows = session.execute(
        select(PlayerGameStats, Game, Player, team, opponent)
        .join(Game, Game.id == PlayerGameStats.game_id)
        .join(Player, Player.id == PlayerGameStats.player_id)
        .join(team, team.id == PlayerGameStats.team_id)
        .join(
            opponent,
            opponent.id == case((is_home, Game.away_team_id), else_=Game.home_team_id),
        )
        .where(PlayerGameStats.id.in_(line_ids))
    ).tuples()

    previews: dict[int, PlayerGamePreview] = {}
    for line, game, player, own, other in rows:
        home = game.home_team_id == line.team_id
        shooting = _shooting([line])
        previews[line.id] = PlayerGamePreview(
            **{stat: getattr(shooting, stat) for stat in _PLAYER_GAME_STATS},
            line_id=line.id,
            game_id=game.id,
            player_id=player.id,
            first_name=player.first_name,
            last_name=player.last_name,
            team=_team_ref(own),
            opponent=_team_ref(other),
            is_home=home,
            team_score=game.home_score if home else game.away_score,
            opponent_score=game.away_score if home else game.home_score,
            date=game.date,
            season=game.season,
            game_type=game.game_type,
            label=game.label,
            starter=line.starter,
            seconds_played=line.seconds_played,
            plus_minus=line.plus_minus,
            dnp_reason=line.dnp_reason,
        )
    return previews


def player_career_previews(
    session: Session, keys: Collection[tuple[int, str]]
) -> dict[tuple[int, str], PlayerCareerPreview]:
    """Previews keyed by (player_id, scope); an unknown player, or a scope
    outside CAREER_SCOPES, is absent. The figures are player_detail's career
    line by construction (_line_columns, _stat_line, played rows of
    LINE_GAME_TYPES games only); a scope with no games is _NO_GAMES' null
    averages. Two queries whatever the number of keys: the players, then one
    GROUP BY player and game type over all of them; none for none."""
    wanted = [key for key in keys if key[1] in CAREER_SCOPES]
    if not wanted:
        return {}

    players = {
        player.id: player
        for player in session.scalars(
            select(Player).where(Player.id.in_({player_id for player_id, _ in wanted}))
        )
    }
    if not players:
        return {}

    lines = {
        (row.player_id, row.game_type): _stat_line(_line_values(row._mapping))
        for row in session.execute(
            select(PlayerGameStats.player_id, Game.game_type, *_line_columns())
            .join(Game, Game.id == PlayerGameStats.game_id)
            .where(
                PlayerGameStats.player_id.in_(players),
                PlayerGameStats.played,
                Game.game_type.in_(LINE_GAME_TYPES),
            )
            .group_by(PlayerGameStats.player_id, Game.game_type)
        )
    }

    previews: dict[tuple[int, str], PlayerCareerPreview] = {}
    for player_id, scope in wanted:
        player = players.get(player_id)
        if player is None:
            continue
        line = lines.get((player_id, scope)) or _stat_line(_NO_GAMES)
        previews[(player_id, scope)] = PlayerCareerPreview(
            **{figure: getattr(line, figure) for figure in _CAREER_FIGURES},
            player_id=player.id,
            first_name=player.first_name,
            last_name=player.last_name,
            position=player.position,
            first_season=player.first_season,
            last_season=player.last_season,
            scope=scope,
        )
    return previews
