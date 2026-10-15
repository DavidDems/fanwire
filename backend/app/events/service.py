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

from collections.abc import Collection, Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import date, datetime, time, timedelta

from sqlalchemy import (
    RowMapping,
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
