"""Historical records (EVENTS-010, grown into a library by EVENTS-012):
GET /events/records (the catalog), GET /events/records/holders and
GET /events/records/{record_id}.

The registry, RECORDS, is the library: at least 100 named records in seven
categories (team-franchise, team-season, team-game, player-game,
player-season, player-career, player-playoffs), sixteen of them featured
(FEATURED, in order). Each record names its id, group, category, title,
unit, rule text and search keywords, and holds its query builder: a
Strategy (wiki/CodeContext/Standards/gof-patterns.md) that returns the
record's *candidates*, every qualifying row with its value, and the list's
order. Families of records are built by factories (_player_game, _season,
_careers, _team_seasons, _team_games, _team_franchise), so the two read
models below run any record's candidates the same way: a new record is one
more entry in RECORDS, never a branch here.

Everything is computed in Postgres at read time. Single-game player records
and the EVENTS-010 records the records indexes serve read games and
player_game_stats directly (an index scan where app.events.models declares
one); season, career and team-game records read the two aggregate tables,
player_season_totals and team_game_totals (0x02a-events-schema.md: an aggregate
table once a measured query is too slow), which rebuild_record_totals
(app.events.record_totals) replaces whenever data loads. The top of a list
is FETCH FIRST ... WITH TIES on the ranked value, ranks are RANK()
(competition ranking) over that top, `tied_count` a count in the same
statement. No box-score or game row is ever loaded into Python.

Query counts, whatever the data's size: the catalog is 1 statement (the data
window; the records themselves are CATALOG, built at import), holders are
len(ids) (one per record, each at most TOP rows: the list's first entries)
and a list is 2 (the data window, then the page with its total).

Counting rules, stated in each rule text: single-game records count
`regular` and `playoffs` games only (not the play-in or the NBA Cup final);
season records count `regular` games, and only seasons with a champion (a
season in progress never holds one); championships use the champion rule
of GET /events/seasons/{season}/champion, through the same helper
(service.season_champions); career records count played lines of `regular`
games; playoff records say so. A did-not-play line (no minutes) never
counts. A percentage needs the brief's minimum of attempts, a player's
average its minimum of games, both stated in the rule.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
from datetime import datetime
from functools import cache
from typing import Any, Literal

from sqlalchemy import (
    BigInteger,
    Integer,
    Numeric,
    RowMapping,
    Select,
    Subquery,
    Text,
    and_,
    case,
    cast,
    func,
    literal,
    literal_column,
    null,
    select,
    true,
    union_all,
)
from sqlalchemy.orm import QueryableAttribute, Session, aliased
from sqlalchemy.sql.elements import ColumnElement
from sqlalchemy.sql.selectable import CTE

from app.events.models import (
    FINALS_LABEL,
    MINUTES_PLAYED,
    TRIPLE_DOUBLE,
    Game,
    Player,
    PlayerGameStats,
    PlayerSeasonTotals,
    Team,
    TeamGameTotals,
)

# Re-exported: records.rebuild_record_totals is the library's one writer.
from app.events.record_totals import rebuild_record_totals  # noqa: F401
from app.events.service import REGULAR, TeamRef, _pct, season_champions

# A list holds at most its top LIST_CAP entries; ties at the cut are cut by
# the list's order.
LIST_CAP = 100

# The most records one GET /events/records/holders may name (a page of the
# library's grid, EVENTS-012).
HOLDERS_CAP = 24

# How many of a list's first entries each holder carries as `top`
# (EVENTS-016: a Historical card's top three).
TOP = 3

# The game types a single-game record counts.
SINGLE_GAME_TYPES: tuple[str, ...] = (REGULAR, "playoffs")

RecordGroup = Literal["team", "player"]

# What a record's value is, and so which figures its entries carry beside it
# (EVENTS-011): a count fills none; win_loss fills wins, losses and pct (value
# stays the win percentage); made_total fills made, attempted and pct (value
# is the made count). shot_pct and average are named for the records to come.
ValueKind = Literal["count", "win_loss", "made_total", "shot_pct", "average"]

# Where a record sits in the library (EVENTS-012), for the catalog's search.
RecordCategory = Literal[
    "team-franchise",
    "team-season",
    "team-game",
    "player-game",
    "player-season",
    "player-career",
    "player-playoffs",
]

# A column a candidates query labels: an expression or a mapped attribute.
_Column = ColumnElement[Any] | QueryableAttribute[Any]
# A factory's column, built when its record's candidates are: fresh
# expressions per statement, as season_champions() is.
_Builds = Callable[[], _Column]

# ---------------------------------------------------------------- read models


@dataclass(frozen=True)
class RecordPlayer:
    id: int
    first_name: str | None
    last_name: str | None


@dataclass(frozen=True)
class RecordGame:
    id: int
    date: datetime
    game_type: str | None
    opponent_abbreviation: str | None


@dataclass(frozen=True)
class RecordEntry:
    rank: int
    value: int | float
    team: TeamRef | None
    player: RecordPlayer | None
    season: str | None
    game: RecordGame | None
    # The figures behind the value, null where the record's kind has none.
    wins: int | None
    losses: int | None
    made: int | None
    attempted: int | None
    pct: float | None


@dataclass(frozen=True)
class RecordHolder(RecordEntry):
    """The list's first entry, how many entries share its value, and the
    list's first TOP entries (EVENTS-016) as the list returns them."""

    tied_count: int
    top: list[RecordEntry]


@dataclass(frozen=True)
class RecordCatalogEntry:
    """One record of the catalog: what it is, never who holds it."""

    id: str
    group: RecordGroup
    category: RecordCategory
    title: str
    unit: str
    rule: str
    value_kind: ValueKind
    keywords: list[str]
    featured_rank: int | None


@dataclass(frozen=True)
class RecordsCatalog:
    """GET /events/records."""

    since_season: str | None
    through_season: str | None
    records: list[RecordCatalogEntry]


@dataclass(frozen=True)
class RecordHolders:
    """GET /events/records/holders: each asked id's holder, or None."""

    holders: dict[str, RecordHolder | None]


@dataclass(frozen=True)
class RecordList:
    """GET /events/records/{record_id}: one page of the top LIST_CAP."""

    id: str
    group: RecordGroup
    title: str
    unit: str
    rule: str
    value_kind: ValueKind
    since_season: str | None
    through_season: str | None
    total: int
    entries: list[RecordEntry]


# ------------------------------------------------------------- the strategy


@dataclass(frozen=True)
class Candidates:
    """What a record's query builder returns.

    `rows`: every qualifying row, labelled value, team_id, player_id,
    season, game_id and opponent_id (null where a record has no such thing,
    see _columns) and the columns `order` names. `order`: the list's order as (column, descending)
    pairs, ending in a unique key; its first column is the value entries are
    ranked on (equal values share a rank)."""

    rows: Select[Any]
    order: tuple[tuple[str, bool], ...]


@dataclass(frozen=True)
class RecordDefinition:
    id: str
    group: RecordGroup
    title: str
    unit: str
    rule: str
    candidates: Callable[[], Candidates]
    # No default: a record cannot be registered without saying what its value
    # is. win_loss candidates label `wins`, `losses` and `games`; made_total
    # candidates label `attempted` (the value is the made count); shot_pct
    # candidates label `made` and `attempted` (the value is the exact
    # fraction); an average's value is the exact mean.
    value_kind: ValueKind
    # EVENTS-012. Set by the registry's sections (_in) and FEATURED; the
    # catalog refuses, at import, a registered record without a category or
    # keywords (_catalog_entry).
    category: RecordCategory | None = None
    keywords: tuple[str, ...] = ()
    featured_rank: int | None = None


def _typed_null(type_: Any) -> ColumnElement[Any]:
    """A null with a type, so a join or comparison on it type-checks."""
    return cast(null(), type_)


def _columns(
    value: _Column,
    *,
    team_id: _Column | None = None,
    player_id: _Column | None = None,
    season: _Column | None = None,
    game_id: _Column | None = None,
    opponent_id: _Column | None = None,
    **extra: _Column,
) -> list[ColumnElement[Any]]:
    given = {
        "value": value,
        "team_id": team_id if team_id is not None else _typed_null(BigInteger),
        "player_id": player_id if player_id is not None else _typed_null(BigInteger),
        "season": season if season is not None else _typed_null(Text),
        "game_id": game_id if game_id is not None else _typed_null(BigInteger),
        "opponent_id": opponent_id if opponent_id is not None else _typed_null(BigInteger),
    }
    return [column.label(name) for name, column in {**given, **extra}.items()]


def _team_sides(*game_types: str) -> Subquery:
    """Each completed game of `game_types` twice, once per team: its score
    and its opponent's."""

    def side(
        team: _Column,
        opponent: _Column,
        score: _Column,
        opponent_score: _Column,
    ) -> Select[Any]:
        columns: list[ColumnElement[Any]] = [
            Game.id.label("game_id"),
            Game.season.label("season"),
            Game.date.label("date"),
            team.label("team_id"),
            opponent.label("opponent_id"),
            score.label("score"),
            opponent_score.label("opponent_score"),
        ]
        return select(*columns).where(Game.game_type.in_(game_types), Game.completed)

    return union_all(
        side(Game.home_team_id, Game.away_team_id, Game.home_score, Game.away_score),
        side(Game.away_team_id, Game.home_team_id, Game.away_score, Game.home_score),
    ).subquery("sides")


def _team_championships() -> Candidates:
    champions = season_champions()
    return Candidates(
        rows=select(*_columns(func.count(), team_id=champions.c.team_id)).group_by(
            champions.c.team_id
        ),
        order=(("value", True), ("team_id", False)),
    )


def _season_record(*, best: bool) -> Candidates:
    champions = season_champions()

    def side(team: _Column, won: ColumnElement[bool]) -> Select[Any]:
        """Per season, each team's games and wins on one side, grouped on
        games directly: a few hundred rows, not one per game."""
        columns: list[ColumnElement[Any]] = [
            Game.season.label("season"),
            team.label("team_id"),
            func.count().label("games"),
            func.count().filter(won).label("wins"),
        ]
        return (
            select(*columns)
            .where(
                Game.game_type == REGULAR,
                Game.completed,
                Game.season.in_(select(champions.c.season)),
            )
            .group_by(Game.season, team)
        )

    sides = union_all(
        side(Game.home_team_id, Game.home_score > Game.away_score),
        side(Game.away_team_id, Game.away_score > Game.home_score),
    ).subquery("season_sides")
    # sum() of a count is numeric in Postgres; these are whole numbers.
    wins = cast(func.sum(sides.c.wins), BigInteger)
    games = cast(func.sum(sides.c.games), BigInteger)
    # The exact fraction ranks; the value shown is three places.
    fraction = cast(wins, Numeric) / games
    rows = select(
        *_columns(
            fraction,
            team_id=sides.c.team_id,
            season=sides.c.season,
            fraction=fraction,
            wins=wins,
            losses=games - wins,
            games=games,
        )
    ).group_by(sides.c.season, sides.c.team_id)
    return Candidates(
        rows=rows,
        order=(("fraction", best), ("wins", best), ("season", False), ("team_id", False)),
    )


def _team_most_points_game() -> Candidates:
    sides = _team_sides(*SINGLE_GAME_TYPES)
    return Candidates(
        rows=select(
            *_columns(
                sides.c.score,
                team_id=sides.c.team_id,
                season=sides.c.season,
                game_id=sides.c.game_id,
                opponent_id=sides.c.opponent_id,
                date=sides.c.date,
            )
        ),
        order=(("value", True), ("date", False), ("team_id", False)),
    )


def _team_largest_win() -> Candidates:
    home_won = Game.home_score > Game.away_score
    return Candidates(
        rows=select(
            *_columns(
                func.abs(Game.home_score - Game.away_score),
                team_id=case((home_won, Game.home_team_id), else_=Game.away_team_id),
                season=Game.season,
                game_id=Game.id,
                opponent_id=case((home_won, Game.away_team_id), else_=Game.home_team_id),
                date=Game.date,
            )
        ).where(Game.game_type.in_(SINGLE_GAME_TYPES), Game.completed),
        order=(("value", True), ("date", False), ("team_id", False)),
    )


def _player_championships() -> Candidates:
    champions = season_champions()
    rows = (
        select(*_columns(func.count(Game.season.distinct()), player_id=PlayerGameStats.player_id))
        .select_from(PlayerGameStats)
        .join(Game, Game.id == PlayerGameStats.game_id)
        .join(
            champions,
            and_(
                champions.c.season == Game.season,
                champions.c.team_id == PlayerGameStats.team_id,
            ),
        )
        .where(
            PlayerGameStats.played,
            Game.game_type == "playoffs",
            Game.label == FINALS_LABEL,
        )
        .group_by(PlayerGameStats.player_id)
    )
    return Candidates(rows=rows, order=(("value", True), ("player_id", False)))


def _player_game(
    value: _Column,
    *,
    game_types: tuple[str, ...] = SINGLE_GAME_TYPES,
    minimum: tuple[_Column, int] | None = None,
    **extra: _Column,
) -> Callable[[], Candidates]:
    """One player's played line in one game of `game_types`. `extra`: the
    figures beside the value (made_total's `attempted`, shot_pct's `made`
    and `attempted`), fetched columns, never a key, so the index that serves
    a stat's value still does. `minimum`: (column, n), only lines with
    column >= n are listed."""

    def candidates() -> Candidates:
        opponent = case(
            (Game.home_team_id == PlayerGameStats.team_id, Game.away_team_id),
            else_=Game.home_team_id,
        )
        where = [PlayerGameStats.played, Game.game_type.in_(game_types)]
        if minimum is not None:
            where.append(minimum[0] >= minimum[1])
        rows = (
            select(
                *_columns(
                    value,
                    team_id=PlayerGameStats.team_id,
                    player_id=PlayerGameStats.player_id,
                    season=Game.season,
                    game_id=Game.id,
                    opponent_id=opponent,
                    date=Game.date,
                    line_id=PlayerGameStats.id,
                    **extra,
                )
            )
            .select_from(PlayerGameStats)
            .join(Game, Game.id == PlayerGameStats.game_id)
            .where(*where)
        )
        return Candidates(
            rows=rows,
            order=(("value", True), ("date", False), ("player_id", False), ("line_id", False)),
        )

    return candidates


def _player_game_made(
    made: _Column, attempted: _Column, *, game_types: tuple[str, ...] = SINGLE_GAME_TYPES
) -> Callable[[], Candidates]:
    """made_total: the made count, with its attempts beside it."""
    return _player_game(made, game_types=game_types, attempted=attempted)


def _player_game_pct(made: _Column, attempted: _Column, minimum: int) -> Callable[[], Candidates]:
    """shot_pct: the exact fraction, on lines of at least `minimum` attempts."""
    return _player_game(
        cast(made, Numeric) / attempted,
        minimum=(attempted, minimum),
        made=made,
        attempted=attempted,
    )


def _career(value: ColumnElement[Any], *where: ColumnElement[bool]) -> Candidates:
    """Per player, over its played lines of `regular` games; only players
    above zero are listed. Reads the box scores: for the one career record
    an index serves (triple-doubles)."""
    rows = (
        select(*_columns(value, player_id=PlayerGameStats.player_id))
        .select_from(PlayerGameStats)
        .join(Game, Game.id == PlayerGameStats.game_id)
        .where(PlayerGameStats.played, Game.game_type == REGULAR, *where)
        .group_by(PlayerGameStats.player_id)
        .having(value > 0)
    )
    return Candidates(rows=rows, order=(("value", True), ("player_id", False)))


def _career_triple_doubles() -> Candidates:
    # models.TRIPLE_DOUBLE: also the predicate of the index that serves this.
    # Counted as distinct games (the same number: a player has one line per
    # game), so the aggregate wants its lines in (player_id, game_id) order,
    # which ix_player_game_stats_triple_doubles yields and no other index
    # over played lines does. With count(*) the planner was free to hash any
    # of them, and on a small table with constant minutes it took
    # ix_player_game_stats_minutes_played, whose key's correlation is 1.
    return _career(func.count(PlayerGameStats.game_id.distinct()), TRIPLE_DOUBLE)


# ------------------------------------------ the aggregate tables' families

# A player's season, from player_season_totals (EVENTS-012).
_PST = PlayerSeasonTotals
# A team's game, from team_game_totals (EVENTS-012).
_TGT = TeamGameTotals


def _minutes(seconds: _Column) -> ColumnElement[Any]:
    """Whole minutes (integer division), 60 written into the SQL as
    models.MINUTES_PLAYED writes it."""
    return seconds // literal_column("60", Integer)


def _fraction(made: _Column, attempted: _Column) -> ColumnElement[Any]:
    return cast(made, Numeric) / attempted


def _season(
    value: _Builds,
    *,
    where: _Builds,
    then: tuple[tuple[str, bool], ...] = (),
    **extra: _Builds,
) -> Callable[[], Candidates]:
    """One player's regular season, in seasons with a champion, from
    player_season_totals: a row per player and season, already summed."""

    def candidates() -> Candidates:
        champions = season_champions()
        rows = select(
            *_columns(
                value(),
                team_id=_PST.team_id,
                player_id=_PST.player_id,
                season=_PST.season,
                **{name: column() for name, column in extra.items()},
            )
        ).where(
            _PST.game_type == REGULAR,
            _PST.season.in_(select(champions.c.season)),
            where(),
        )
        return Candidates(
            rows=rows,
            order=(("value", True), *then, ("season", False), ("player_id", False)),
        )

    return candidates


def _season_total(column: _Column) -> Callable[[], Candidates]:
    return _season(lambda: column, where=lambda: column > 0)


def _season_minutes() -> Callable[[], Candidates]:
    return _season(
        lambda: _minutes(_PST.seconds_played), where=lambda: _minutes(_PST.seconds_played) > 0
    )


def _season_made(made: _Column, attempted: _Column) -> Callable[[], Candidates]:
    return _season(lambda: made, where=lambda: made > 0, attempted=lambda: attempted)


def _season_pct(made: _Column, attempted: _Column, minimum: int) -> Callable[[], Candidates]:
    return _season(
        lambda: _fraction(made, attempted),
        where=lambda: attempted >= minimum,
        then=(("made", True),),
        made=lambda: made,
        attempted=lambda: attempted,
    )


def _season_average(total: _Column) -> Callable[[], Candidates]:
    return _season(
        lambda: cast(total, Numeric) / _PST.games,
        where=lambda: _PST.games >= SEASON_AVERAGE_GAMES,
    )


def _careers(
    value: _Builds,
    *,
    having: _Builds,
    game_type: str = REGULAR,
    then: tuple[tuple[str, bool], ...] = (),
    **extra: _Builds,
) -> Callable[[], Candidates]:
    """Per player, over every stored season of `game_type`, from
    player_season_totals: a GROUP BY over its few thousand rows."""

    def candidates() -> Candidates:
        rows = (
            select(
                *_columns(
                    value(),
                    player_id=_PST.player_id,
                    **{name: column() for name, column in extra.items()},
                )
            )
            .where(_PST.game_type == game_type)
            .group_by(_PST.player_id)
            .having(having())
        )
        return Candidates(rows=rows, order=(("value", True), *then, ("player_id", False)))

    return candidates


def _career_total(column: _Column, *, game_type: str = REGULAR) -> Callable[[], Candidates]:
    return _careers(
        lambda: func.sum(column), having=lambda: func.sum(column) > 0, game_type=game_type
    )


def _career_minutes() -> Callable[[], Candidates]:
    def total() -> ColumnElement[Any]:
        return _minutes(func.sum(_PST.seconds_played))

    return _careers(total, having=lambda: total() > 0)


def _career_made(
    made: _Column, attempted: _Column, *, game_type: str = REGULAR
) -> Callable[[], Candidates]:
    return _careers(
        lambda: func.sum(made),
        having=lambda: func.sum(made) > 0,
        game_type=game_type,
        attempted=lambda: func.sum(attempted),
    )


def _career_pct(made: _Column, attempted: _Column, minimum: int) -> Callable[[], Candidates]:
    return _careers(
        lambda: _fraction(func.sum(made), func.sum(attempted)),
        having=lambda: func.sum(attempted) >= minimum,
        then=(("made", True),),
        made=lambda: func.sum(made),
        attempted=lambda: func.sum(attempted),
    )


def _career_average(total: _Column) -> Callable[[], Candidates]:
    return _careers(
        lambda: cast(func.sum(total), Numeric) / func.sum(_PST.games),
        having=lambda: func.sum(_PST.games) >= CAREER_AVERAGE_GAMES,
    )


def _team_seasons(
    value: _Builds,
    *,
    best: bool = True,
    having: _Builds | None = None,
    then: tuple[tuple[str, bool], ...] = (),
    **extra: _Builds,
) -> Callable[[], Candidates]:
    """One team's regular season, in seasons with a champion, from
    team_game_totals. `best`: the highest value first, else the lowest."""

    def candidates() -> Candidates:
        champions = season_champions()
        rows = (
            select(
                *_columns(
                    value(),
                    team_id=_TGT.team_id,
                    season=_TGT.season,
                    **{name: column() for name, column in extra.items()},
                )
            )
            .where(_TGT.game_type == REGULAR, _TGT.season.in_(select(champions.c.season)))
            .group_by(_TGT.team_id, _TGT.season)
            .having(having() if having is not None else value().is_not(None))
        )
        return Candidates(
            rows=rows,
            order=(("value", best), *then, ("season", False), ("team_id", False)),
        )

    return candidates


def _team_season_average(column: _Column, *, best: bool = True) -> Callable[[], Candidates]:
    """The mean over the season's games (only games with a box score, for a
    box-score stat)."""
    return _team_seasons(lambda: func.avg(column), best=best)


def _team_season_made(made: _Column, attempted: _Column) -> Callable[[], Candidates]:
    return _team_seasons(
        lambda: func.sum(made),
        having=lambda: func.sum(made) > 0,
        attempted=lambda: func.sum(attempted),
    )


def _team_season_pct(made: _Column, attempted: _Column) -> Callable[[], Candidates]:
    return _team_seasons(
        lambda: _fraction(func.sum(made), func.sum(attempted)),
        having=lambda: func.sum(attempted) > 0,
        then=(("made", True),),
        made=lambda: func.sum(made),
        attempted=lambda: func.sum(attempted),
    )


def _streak(*, won: bool) -> Callable[[], Candidates]:
    """The longest run of wins (or losses) in a season: team_game_totals'
    `streak` is the run's length at each game, by date."""
    result = _TGT.won if won else ~_TGT.won
    return _team_seasons(lambda: func.max(_TGT.streak).filter(result))


def _team_games(
    value: _Builds,
    *,
    where: _Builds = true,
    game_types: tuple[str, ...] = SINGLE_GAME_TYPES,
    best: bool = True,
    **extra: _Builds,
) -> Callable[[], Candidates]:
    """One team's game of `game_types`, from team_game_totals."""

    def candidates() -> Candidates:
        rows = select(
            *_columns(
                value(),
                team_id=_TGT.team_id,
                season=_TGT.season,
                game_id=_TGT.game_id,
                opponent_id=_TGT.opponent_id,
                date=_TGT.date,
                **{name: column() for name, column in extra.items()},
            )
        ).where(_TGT.game_type.in_(game_types), where())
        return Candidates(rows=rows, order=(("value", best), ("date", False), ("team_id", False)))

    return candidates


def _team_game_stat(column: _Column) -> Callable[[], Candidates]:
    """A box-score sum: games without the team's box score are not listed."""
    return _team_games(lambda: column, where=lambda: column.is_not(None))


def _team_franchise(value: _Builds, *, game_type: str = REGULAR) -> Callable[[], Candidates]:
    """Per team, over every stored season's `game_type` games, from
    team_game_totals."""

    def candidates() -> Candidates:
        rows = (
            select(*_columns(value(), team_id=_TGT.team_id))
            .where(_TGT.game_type == game_type)
            .group_by(_TGT.team_id)
        )
        return Candidates(rows=rows, order=(("value", True), ("team_id", False)))

    return candidates


def _best_win_pct_all_time() -> Candidates:
    wins = func.count().filter(_TGT.won)
    games = func.count()
    fraction = cast(wins, Numeric) / games
    rows = (
        select(
            *_columns(
                fraction,
                team_id=_TGT.team_id,
                fraction=fraction,
                wins=wins,
                losses=games - wins,
                games=games,
            )
        )
        .where(_TGT.game_type == REGULAR)
        .group_by(_TGT.team_id)
    )
    return Candidates(rows=rows, order=(("fraction", True), ("wins", True), ("team_id", False)))


def _finals_appearances() -> Candidates:
    """Seasons with an NBA Finals game, per team (ix_games_nba_finals)."""
    finals = (Game.game_type == "playoffs", Game.label == FINALS_LABEL)
    sides = union_all(
        select(Game.season.label("season"), Game.home_team_id.label("team_id")).where(*finals),
        select(Game.season.label("season"), Game.away_team_id.label("team_id")).where(*finals),
    ).subquery("finals_sides")
    rows = select(
        *_columns(func.count(sides.c.season.distinct()), team_id=sides.c.team_id)
    ).group_by(sides.c.team_id)
    return Candidates(rows=rows, order=(("value", True), ("team_id", False)))


# ----------------------------------------------------------- the registry

# The brief's minimums (.ai/tasks/EVENTS-012/brief.md "Minimums"): attempts
# for a percentage, games for a player's average. Flat across seasons.
GAME_MINIMUMS = {"fg": 15, "3pt": 8, "ft": 10}
SEASON_MINIMUMS = {"fg": 500, "3pt": 200, "ft": 150}
CAREER_MINIMUMS = {"fg": 3000, "3pt": 1000, "ft": 1000}
SEASON_AVERAGE_GAMES = 58
CAREER_AVERAGE_GAMES = 400

_SINGLE_GAME = "Regular-season and playoff games only (not the play-in or the NBA Cup final)"
_SEASONS = (
    "Regular-season games only, in seasons with a champion (a season in progress never holds it)"
)
_CAREER = "Regular-season games only, over every played game"
_PLAYOFF_GAME = "Playoff games only"
_PLAYOFF_CAREER = "Playoff games only, over every played game"
_ALL_TIME = "Regular-season games only, over every stored season"
_FINALS = (
    "Champion: the team that wins four of a season's playoff games labelled NBA Finals,"
    " as GET /events/seasons/{season}/champion decides"
)


def _attempts(minimum: int) -> str:
    return f"At least {minimum:,} attempts"


def _games(minimum: int) -> str:
    return f"At least {minimum} games played"


# Search words, as fans type them; the catalog's search is a case-insensitive
# substring match over these and the title.
_THREES = ("threes", "3pt", "3-pointers", "three-pointers", "3pm")
_FG = ("field goals", "fg", "shooting", "buckets")
_FT = ("free throws", "ft", "foul shots")
_POINTS = ("points", "scoring", "pts")
_REBOUNDS = ("rebounds", "boards", "reb")
_ASSISTS = ("assists", "dimes", "ast")
_STEALS = ("steals", "stl", "defense")
_BLOCKS = ("blocks", "blk", "rejections", "defense")
_MINUTES = ("minutes", "min", "playing time")
_PCT = ("percentage", "pct", "%", "efficiency")
_AVG = ("per game", "average")
_GAME = ("game", "single game")
_SEASON = ("season",)
_CAREER_WORDS = ("career", "all-time")
_PLAYOFFS = ("playoffs", "postseason")
_TITLES = ("championships", "titles", "rings")

# The featured sixteen, in the brief's order: featured_rank is the position.
FEATURED: tuple[str, ...] = (
    "team-best-season",
    "player-points-game",
    "team-championships",
    "player-career-points",
    "player-threes-season",
    "player-three-pct-season",
    "player-ppg-season",
    "team-worst-season",
    "player-rebounds-game",
    "player-assists-game",
    "player-threes-game",
    "team-longest-win-streak",
    "player-career-triple-doubles",
    "player-championships",
    "team-most-points-game",
    "team-largest-win",
)


def _r(
    id: str,
    title: str,
    unit: str,
    rule: str,
    candidates: Callable[[], Candidates],
    value_kind: ValueKind,
    *keywords: tuple[str, ...] | str,
) -> RecordDefinition:
    """One definition; its group is its id's prefix."""
    words: list[str] = []
    for word in keywords:
        for each in (word,) if isinstance(word, str) else word:
            if each not in words:
                words.append(each)
    return RecordDefinition(
        id=id,
        group="team" if id.startswith("team-") else "player",
        title=title,
        unit=unit,
        rule=rule,
        candidates=candidates,
        value_kind=value_kind,
        keywords=tuple(words),
    )


def _in(category: RecordCategory, *records: RecordDefinition) -> tuple[RecordDefinition, ...]:
    return tuple(replace(record, category=category) for record in records)


_P = PlayerGameStats

_TEAM_FRANCHISE = _in(
    "team-franchise",
    _r(
        "team-championships",
        "Most championships",
        "titles",
        f"NBA titles won. {_FINALS}.",
        _team_championships,
        "count",
        _TITLES,
        "franchise",
    ),
    _r(
        "team-finals-appearances",
        "Most NBA Finals appearances",
        "Finals",
        "Seasons with at least one playoff game labelled NBA Finals.",
        _finals_appearances,
        "count",
        "finals",
        "appearances",
        _PLAYOFFS,
        "franchise",
    ),
    _r(
        "team-playoff-appearances",
        "Most playoff appearances",
        "seasons",
        "Seasons with at least one playoff game (not the play-in).",
        _team_franchise(lambda: func.count(_TGT.season.distinct()), game_type="playoffs"),
        "count",
        _PLAYOFFS,
        "appearances",
        "franchise",
    ),
    _r(
        "team-most-wins-all-time",
        "Most wins, all time",
        "wins",
        f"Regular-season wins. {_ALL_TIME}.",
        _team_franchise(lambda: func.count().filter(_TGT.won)),
        "count",
        "wins",
        "all-time",
        "franchise",
    ),
    _r(
        "team-best-win-pct-all-time",
        "Best win percentage, all time",
        "record",
        f"Highest win percentage, then most wins. {_ALL_TIME}.",
        _best_win_pct_all_time,
        "win_loss",
        "win percentage",
        "record",
        "all-time",
        "franchise",
    ),
)

_TEAM_SEASON = _in(
    "team-season",
    _r(
        "team-best-season",
        "Best regular season",
        "record",
        f"Highest win percentage in one season, then most wins. {_SEASONS}.",
        lambda: _season_record(best=True),
        "win_loss",
        "best season",
        "record",
        "wins",
        _SEASON,
    ),
    _r(
        "team-worst-season",
        "Worst regular season",
        "record",
        f"Lowest win percentage in one season, then fewest wins. {_SEASONS}.",
        lambda: _season_record(best=False),
        "win_loss",
        "worst season",
        "record",
        "losses",
        _SEASON,
    ),
    _r(
        "team-most-wins-season",
        "Most wins in a season",
        "wins",
        f"Wins in one season. {_SEASONS}.",
        _team_seasons(lambda: func.count().filter(_TGT.won)),
        "count",
        "wins",
        _SEASON,
    ),
    _r(
        "team-most-losses-season",
        "Most losses in a season",
        "losses",
        f"Losses in one season. {_SEASONS}.",
        _team_seasons(lambda: func.count().filter(~_TGT.won)),
        "count",
        "losses",
        _SEASON,
    ),
    _r(
        "team-longest-win-streak",
        "Longest winning streak",
        "wins",
        f"Wins in a row within one season, by date. {_SEASONS}.",
        _streak(won=True),
        "count",
        "streak",
        "winning streak",
        "wins",
        _SEASON,
    ),
    _r(
        "team-longest-losing-streak",
        "Longest losing streak",
        "losses",
        f"Losses in a row within one season, by date. {_SEASONS}.",
        _streak(won=False),
        "count",
        "streak",
        "losing streak",
        "losses",
        _SEASON,
    ),
    _r(
        "team-highest-ppg-season",
        "Most points per game in a season",
        "points per game",
        f"Points scored per game over one season. {_SEASONS}.",
        _team_season_average(_TGT.score),
        "average",
        _POINTS,
        "ppg",
        "offense",
        _AVG,
        _SEASON,
    ),
    _r(
        "team-lowest-opp-ppg-season",
        "Fewest points allowed per game in a season",
        "points allowed per game",
        f"Opponents' points per game over one season, lowest first. {_SEASONS}.",
        _team_season_average(_TGT.opponent_score, best=False),
        "average",
        "points allowed",
        "opponent ppg",
        "defense",
        _AVG,
        _SEASON,
    ),
    _r(
        "team-best-point-diff-season",
        "Best point differential in a season",
        "points per game",
        f"Points scored minus points allowed, per game over one season. {_SEASONS}.",
        _team_season_average(_TGT.score - _TGT.opponent_score),
        "average",
        "point differential",
        "margin",
        "net rating",
        _AVG,
        _SEASON,
    ),
    _r(
        "team-most-threes-season",
        "Most threes in a season",
        "threes",
        f"Three-pointers made by one team over one season. {_SEASONS}.",
        _team_season_made(_TGT.three_pointers_made, _TGT.three_pointers_attempted),
        "made_total",
        _THREES,
        _SEASON,
    ),
    _r(
        "team-three-pct-season",
        "Best three-point percentage in a season",
        "3P%",
        f"Three-pointers made over attempted, one team over one season. {_SEASONS}.",
        _team_season_pct(_TGT.three_pointers_made, _TGT.three_pointers_attempted),
        "shot_pct",
        _THREES,
        _PCT,
        _SEASON,
    ),
    _r(
        "team-field-goal-pct-season",
        "Best field-goal percentage in a season",
        "FG%",
        f"Field goals made over attempted, one team over one season. {_SEASONS}.",
        _team_season_pct(_TGT.field_goals_made, _TGT.field_goals_attempted),
        "shot_pct",
        _FG,
        _PCT,
        _SEASON,
    ),
    _r(
        "team-free-throw-pct-season",
        "Best free-throw percentage in a season",
        "FT%",
        f"Free throws made over attempted, one team over one season. {_SEASONS}.",
        _team_season_pct(_TGT.free_throws_made, _TGT.free_throws_attempted),
        "shot_pct",
        _FT,
        _PCT,
        _SEASON,
    ),
    _r(
        "team-apg-season",
        "Most assists per game in a season",
        "assists per game",
        f"Assists per game over one season, games with a box score. {_SEASONS}.",
        _team_season_average(_TGT.assists),
        "average",
        _ASSISTS,
        "apg",
        _AVG,
        _SEASON,
    ),
    _r(
        "team-rpg-season",
        "Most rebounds per game in a season",
        "rebounds per game",
        f"Rebounds per game over one season, games with a box score. {_SEASONS}.",
        _team_season_average(_TGT.rebounds),
        "average",
        _REBOUNDS,
        "rpg",
        _AVG,
        _SEASON,
    ),
    _r(
        "team-spg-season",
        "Most steals per game in a season",
        "steals per game",
        f"Steals per game over one season, games with a box score. {_SEASONS}.",
        _team_season_average(_TGT.steals),
        "average",
        _STEALS,
        "spg",
        _AVG,
        _SEASON,
    ),
    _r(
        "team-bpg-season",
        "Most blocks per game in a season",
        "blocks per game",
        f"Blocks per game over one season, games with a box score. {_SEASONS}.",
        _team_season_average(_TGT.blocks),
        "average",
        _BLOCKS,
        "bpg",
        _AVG,
        _SEASON,
    ),
    _r(
        "team-fewest-turnovers-season",
        "Fewest turnovers per game in a season",
        "turnovers per game",
        f"Turnovers per game over one season, lowest first, games with a box score. {_SEASONS}.",
        _team_season_average(_TGT.turnovers, best=False),
        "average",
        "turnovers",
        "tov",
        "ball security",
        _AVG,
        _SEASON,
    ),
)

_TEAM_GAME = _in(
    "team-game",
    _r(
        "team-most-points-game",
        "Most points in a game",
        "points",
        f"Points scored by one team in one game. {_SINGLE_GAME}.",
        _team_most_points_game,
        "count",
        _POINTS,
        _GAME,
    ),
    _r(
        "team-fewest-points-game",
        "Fewest points in a game",
        "points",
        f"Points scored by one team in one completed game, lowest first. {_SINGLE_GAME}.",
        _team_games(lambda: _TGT.score, best=False),
        "count",
        _POINTS,
        "fewest",
        _GAME,
    ),
    _r(
        "team-largest-win",
        "Largest win",
        "points",
        f"Margin of victory in one game. {_SINGLE_GAME}.",
        _team_largest_win,
        "count",
        "margin",
        "blowout",
        "largest win",
        _GAME,
    ),
    _r(
        "team-most-threes-game",
        "Most threes in a game",
        "threes",
        f"Three-pointers made by one team in one game. {_SINGLE_GAME}.",
        _team_games(
            lambda: _TGT.three_pointers_made,
            where=lambda: _TGT.three_pointers_made.is_not(None),
            attempted=lambda: _TGT.three_pointers_attempted,
        ),
        "made_total",
        _THREES,
        _GAME,
    ),
    _r(
        "team-most-assists-game",
        "Most assists in a game",
        "assists",
        f"Assists by one team in one game. {_SINGLE_GAME}.",
        _team_game_stat(_TGT.assists),
        "count",
        _ASSISTS,
        _GAME,
    ),
    _r(
        "team-most-rebounds-game",
        "Most rebounds in a game",
        "rebounds",
        f"Rebounds by one team in one game. {_SINGLE_GAME}.",
        _team_game_stat(_TGT.rebounds),
        "count",
        _REBOUNDS,
        _GAME,
    ),
    _r(
        "team-most-steals-game",
        "Most steals in a game",
        "steals",
        f"Steals by one team in one game. {_SINGLE_GAME}.",
        _team_game_stat(_TGT.steals),
        "count",
        _STEALS,
        _GAME,
    ),
    _r(
        "team-most-blocks-game",
        "Most blocks in a game",
        "blocks",
        f"Blocks by one team in one game. {_SINGLE_GAME}.",
        _team_game_stat(_TGT.blocks),
        "count",
        _BLOCKS,
        _GAME,
    ),
    _r(
        "team-highest-combined-points-game",
        "Most combined points in a game",
        "points",
        f"Both teams' points in one game, listed under the winner. {_SINGLE_GAME}.",
        _team_games(lambda: _TGT.score + _TGT.opponent_score, where=lambda: _TGT.won),
        "count",
        _POINTS,
        "combined",
        "shootout",
        _GAME,
    ),
    _r(
        "team-playoff-most-points-game",
        "Most points in a playoff game",
        "points",
        f"Points scored by one team in one game. {_PLAYOFF_GAME}.",
        _team_games(lambda: _TGT.score, game_types=("playoffs",)),
        "count",
        _POINTS,
        _PLAYOFFS,
        _GAME,
    ),
    _r(
        "team-playoff-largest-win",
        "Largest playoff win",
        "points",
        f"Margin of victory in one game. {_PLAYOFF_GAME}.",
        _team_games(
            lambda: _TGT.score - _TGT.opponent_score,
            where=lambda: _TGT.won,
            game_types=("playoffs",),
        ),
        "count",
        "margin",
        "blowout",
        "largest win",
        _PLAYOFFS,
        _GAME,
    ),
)

_PLAYER_GAME = _in(
    "player-game",
    _r(
        "player-points-game",
        "Most points in a game",
        "points",
        f"Points by one player in one game. {_SINGLE_GAME}.",
        _player_game(_P.points),
        "count",
        _POINTS,
        _GAME,
    ),
    _r(
        "player-rebounds-game",
        "Most rebounds in a game",
        "rebounds",
        f"Rebounds by one player in one game. {_SINGLE_GAME}.",
        _player_game(_P.rebounds),
        "count",
        _REBOUNDS,
        _GAME,
    ),
    _r(
        "player-offensive-rebounds-game",
        "Most offensive rebounds in a game",
        "offensive rebounds",
        f"Offensive rebounds by one player in one game. {_SINGLE_GAME}.",
        _player_game(_P.offensive_rebounds),
        "count",
        "offensive rebounds",
        "oreb",
        _REBOUNDS,
        _GAME,
    ),
    _r(
        "player-defensive-rebounds-game",
        "Most defensive rebounds in a game",
        "defensive rebounds",
        f"Defensive rebounds by one player in one game. {_SINGLE_GAME}.",
        _player_game(_P.defensive_rebounds),
        "count",
        "defensive rebounds",
        "dreb",
        _REBOUNDS,
        _GAME,
    ),
    _r(
        "player-assists-game",
        "Most assists in a game",
        "assists",
        f"Assists by one player in one game. {_SINGLE_GAME}.",
        _player_game(_P.assists),
        "count",
        _ASSISTS,
        _GAME,
    ),
    _r(
        "player-steals-game",
        "Most steals in a game",
        "steals",
        f"Steals by one player in one game. {_SINGLE_GAME}.",
        _player_game(_P.steals),
        "count",
        _STEALS,
        _GAME,
    ),
    _r(
        "player-blocks-game",
        "Most blocks in a game",
        "blocks",
        f"Blocks by one player in one game. {_SINGLE_GAME}.",
        _player_game(_P.blocks),
        "count",
        _BLOCKS,
        _GAME,
    ),
    _r(
        "player-threes-game",
        "Most threes in a game",
        "threes",
        f"Three-pointers made by one player in one game. {_SINGLE_GAME}.",
        _player_game_made(_P.three_pointers_made, _P.three_pointers_attempted),
        "made_total",
        _THREES,
        _GAME,
    ),
    _r(
        "player-three-pct-game",
        "Best three-point shooting in a game",
        "3P%",
        f"Three-pointers made over attempted by one player in one game."
        f" {_attempts(GAME_MINIMUMS['3pt'])}. {_SINGLE_GAME}.",
        _player_game_pct(_P.three_pointers_made, _P.three_pointers_attempted, GAME_MINIMUMS["3pt"]),
        "shot_pct",
        _THREES,
        _PCT,
        _GAME,
    ),
    _r(
        "player-field-goals-game",
        "Most field goals in a game",
        "field goals",
        f"Field goals made by one player in one game. {_SINGLE_GAME}.",
        _player_game_made(_P.field_goals_made, _P.field_goals_attempted),
        "made_total",
        _FG,
        _GAME,
    ),
    _r(
        "player-field-goal-pct-game",
        "Best field-goal shooting in a game",
        "FG%",
        f"Field goals made over attempted by one player in one game."
        f" {_attempts(GAME_MINIMUMS['fg'])}. {_SINGLE_GAME}.",
        _player_game_pct(_P.field_goals_made, _P.field_goals_attempted, GAME_MINIMUMS["fg"]),
        "shot_pct",
        _FG,
        _PCT,
        _GAME,
    ),
    _r(
        "player-free-throws-game",
        "Most free throws in a game",
        "free throws",
        f"Free throws made by one player in one game. {_SINGLE_GAME}.",
        _player_game_made(_P.free_throws_made, _P.free_throws_attempted),
        "made_total",
        _FT,
        _GAME,
    ),
    _r(
        "player-free-throw-pct-game",
        "Best free-throw shooting in a game",
        "FT%",
        f"Free throws made over attempted by one player in one game."
        f" {_attempts(GAME_MINIMUMS['ft'])}. {_SINGLE_GAME}.",
        _player_game_pct(_P.free_throws_made, _P.free_throws_attempted, GAME_MINIMUMS["ft"]),
        "shot_pct",
        _FT,
        _PCT,
        _GAME,
    ),
    _r(
        "player-minutes-game",
        "Most minutes in a game",
        "minutes",
        f"Whole minutes played by one player in one game. {_SINGLE_GAME}.",
        _player_game(MINUTES_PLAYED),
        "count",
        _MINUTES,
        _GAME,
    ),
    _r(
        "player-plus-minus-game",
        "Best plus-minus in a game",
        "plus-minus",
        "The team's points minus its opponent's while one player was on the court,"
        f" in one game. {_SINGLE_GAME}.",
        _player_game(_P.plus_minus),
        "count",
        "plus-minus",
        "+/-",
        "plus minus",
        _GAME,
    ),
)

_PLAYER_SEASON = _in(
    "player-season",
    _r(
        "player-points-season",
        "Most points in a season",
        "points",
        f"Points by one player over one season, summed across teams. {_SEASONS}.",
        _season_total(_PST.points),
        "count",
        _POINTS,
        _SEASON,
    ),
    _r(
        "player-rebounds-season",
        "Most rebounds in a season",
        "rebounds",
        f"Rebounds by one player over one season, summed across teams. {_SEASONS}.",
        _season_total(_PST.rebounds),
        "count",
        _REBOUNDS,
        _SEASON,
    ),
    _r(
        "player-offensive-rebounds-season",
        "Most offensive rebounds in a season",
        "offensive rebounds",
        f"Offensive rebounds by one player over one season, summed across teams. {_SEASONS}.",
        _season_total(_PST.offensive_rebounds),
        "count",
        "offensive rebounds",
        "oreb",
        _REBOUNDS,
        _SEASON,
    ),
    _r(
        "player-assists-season",
        "Most assists in a season",
        "assists",
        f"Assists by one player over one season, summed across teams. {_SEASONS}.",
        _season_total(_PST.assists),
        "count",
        _ASSISTS,
        _SEASON,
    ),
    _r(
        "player-steals-season",
        "Most steals in a season",
        "steals",
        f"Steals by one player over one season, summed across teams. {_SEASONS}.",
        _season_total(_PST.steals),
        "count",
        _STEALS,
        _SEASON,
    ),
    _r(
        "player-blocks-season",
        "Most blocks in a season",
        "blocks",
        f"Blocks by one player over one season, summed across teams. {_SEASONS}.",
        _season_total(_PST.blocks),
        "count",
        _BLOCKS,
        _SEASON,
    ),
    _r(
        "player-minutes-season",
        "Most minutes in a season",
        "minutes",
        f"Whole minutes played by one player over one season. {_SEASONS}.",
        _season_minutes(),
        "count",
        _MINUTES,
        _SEASON,
    ),
    _r(
        "player-triple-doubles-season",
        "Most triple-doubles in a season",
        "triple-doubles",
        "Games with 10 or more in at least three of points, rebounds, assists, steals and"
        f" blocks, over one season. {_SEASONS}.",
        _season_total(_PST.triple_doubles),
        "count",
        "triple-doubles",
        "triple doubles",
        _SEASON,
    ),
    _r(
        "player-double-doubles-season",
        "Most double-doubles in a season",
        "double-doubles",
        "Games with 10 or more in at least two of points, rebounds, assists, steals and"
        f" blocks, over one season. {_SEASONS}.",
        _season_total(_PST.double_doubles),
        "count",
        "double-doubles",
        "double doubles",
        _SEASON,
    ),
    _r(
        "player-threes-season",
        "Most threes in a season",
        "threes",
        f"Three-pointers made by one player over one season. {_SEASONS}.",
        _season_made(_PST.three_pointers_made, _PST.three_pointers_attempted),
        "made_total",
        _THREES,
        _SEASON,
    ),
    _r(
        "player-three-pct-season",
        "Best three-point percentage in a season",
        "3P%",
        f"Three-pointers made over attempted by one player over one season."
        f" {_attempts(SEASON_MINIMUMS['3pt'])}. {_SEASONS}.",
        _season_pct(
            _PST.three_pointers_made, _PST.three_pointers_attempted, SEASON_MINIMUMS["3pt"]
        ),
        "shot_pct",
        _THREES,
        _PCT,
        _SEASON,
    ),
    _r(
        "player-field-goals-season",
        "Most field goals in a season",
        "field goals",
        f"Field goals made by one player over one season. {_SEASONS}.",
        _season_made(_PST.field_goals_made, _PST.field_goals_attempted),
        "made_total",
        _FG,
        _SEASON,
    ),
    _r(
        "player-field-goal-pct-season",
        "Best field-goal percentage in a season",
        "FG%",
        f"Field goals made over attempted by one player over one season."
        f" {_attempts(SEASON_MINIMUMS['fg'])}. {_SEASONS}.",
        _season_pct(_PST.field_goals_made, _PST.field_goals_attempted, SEASON_MINIMUMS["fg"]),
        "shot_pct",
        _FG,
        _PCT,
        _SEASON,
    ),
    _r(
        "player-free-throws-season",
        "Most free throws in a season",
        "free throws",
        f"Free throws made by one player over one season. {_SEASONS}.",
        _season_made(_PST.free_throws_made, _PST.free_throws_attempted),
        "made_total",
        _FT,
        _SEASON,
    ),
    _r(
        "player-free-throw-pct-season",
        "Best free-throw percentage in a season",
        "FT%",
        f"Free throws made over attempted by one player over one season."
        f" {_attempts(SEASON_MINIMUMS['ft'])}. {_SEASONS}.",
        _season_pct(_PST.free_throws_made, _PST.free_throws_attempted, SEASON_MINIMUMS["ft"]),
        "shot_pct",
        _FT,
        _PCT,
        _SEASON,
    ),
    _r(
        "player-ppg-season",
        "Most points per game in a season",
        "points per game",
        f"Points per played game over one season. {_games(SEASON_AVERAGE_GAMES)}. {_SEASONS}.",
        _season_average(_PST.points),
        "average",
        _POINTS,
        "ppg",
        _AVG,
        _SEASON,
    ),
    _r(
        "player-rpg-season",
        "Most rebounds per game in a season",
        "rebounds per game",
        f"Rebounds per played game over one season. {_games(SEASON_AVERAGE_GAMES)}. {_SEASONS}.",
        _season_average(_PST.rebounds),
        "average",
        _REBOUNDS,
        "rpg",
        _AVG,
        _SEASON,
    ),
    _r(
        "player-apg-season",
        "Most assists per game in a season",
        "assists per game",
        f"Assists per played game over one season. {_games(SEASON_AVERAGE_GAMES)}. {_SEASONS}.",
        _season_average(_PST.assists),
        "average",
        _ASSISTS,
        "apg",
        _AVG,
        _SEASON,
    ),
    _r(
        "player-spg-season",
        "Most steals per game in a season",
        "steals per game",
        f"Steals per played game over one season. {_games(SEASON_AVERAGE_GAMES)}. {_SEASONS}.",
        _season_average(_PST.steals),
        "average",
        _STEALS,
        "spg",
        _AVG,
        _SEASON,
    ),
    _r(
        "player-bpg-season",
        "Most blocks per game in a season",
        "blocks per game",
        f"Blocks per played game over one season. {_games(SEASON_AVERAGE_GAMES)}. {_SEASONS}.",
        _season_average(_PST.blocks),
        "average",
        _BLOCKS,
        "bpg",
        _AVG,
        _SEASON,
    ),
    _r(
        "player-mpg-season",
        "Most minutes per game in a season",
        "minutes per game",
        f"Minutes per played game over one season. {_games(SEASON_AVERAGE_GAMES)}. {_SEASONS}.",
        _season_average(_PST.seconds_played / literal(60.0)),
        "average",
        _MINUTES,
        "mpg",
        _AVG,
        _SEASON,
    ),
)

_PLAYER_CAREER = _in(
    "player-career",
    _r(
        "player-career-points",
        "Most career points",
        "points",
        "Regular-season points, summed over every played game.",
        _career_total(_PST.points),
        "count",
        _POINTS,
        _CAREER_WORDS,
    ),
    _r(
        "player-career-rebounds",
        "Most career rebounds",
        "rebounds",
        f"Rebounds. {_CAREER}.",
        _career_total(_PST.rebounds),
        "count",
        _REBOUNDS,
        _CAREER_WORDS,
    ),
    _r(
        "player-career-assists",
        "Most career assists",
        "assists",
        f"Assists. {_CAREER}.",
        _career_total(_PST.assists),
        "count",
        _ASSISTS,
        _CAREER_WORDS,
    ),
    _r(
        "player-career-steals",
        "Most career steals",
        "steals",
        f"Steals. {_CAREER}.",
        _career_total(_PST.steals),
        "count",
        _STEALS,
        _CAREER_WORDS,
    ),
    _r(
        "player-career-blocks",
        "Most career blocks",
        "blocks",
        f"Blocks. {_CAREER}.",
        _career_total(_PST.blocks),
        "count",
        _BLOCKS,
        _CAREER_WORDS,
    ),
    _r(
        "player-career-minutes",
        "Most career minutes",
        "minutes",
        f"Whole minutes played. {_CAREER}.",
        _career_minutes(),
        "count",
        _MINUTES,
        _CAREER_WORDS,
    ),
    _r(
        "player-career-games",
        "Most career games",
        "games",
        f"Games played (minutes on the court). {_CAREER}.",
        _career_total(_PST.games),
        "count",
        "games played",
        "longevity",
        _CAREER_WORDS,
    ),
    _r(
        "player-career-triple-doubles",
        "Most career triple-doubles",
        "triple-doubles",
        "Regular-season games with 10 or more in at least three of points, rebounds,"
        " assists, steals and blocks.",
        _career_triple_doubles,
        "count",
        "triple-doubles",
        "triple doubles",
        _CAREER_WORDS,
    ),
    _r(
        "player-career-double-doubles",
        "Most career double-doubles",
        "double-doubles",
        "Games with 10 or more in at least two of points, rebounds, assists, steals and"
        f" blocks. {_CAREER}.",
        _career_total(_PST.double_doubles),
        "count",
        "double-doubles",
        "double doubles",
        _CAREER_WORDS,
    ),
    _r(
        "player-career-threes",
        "Most career threes",
        "threes",
        f"Three-pointers made. {_CAREER}.",
        _career_made(_PST.three_pointers_made, _PST.three_pointers_attempted),
        "made_total",
        _THREES,
        _CAREER_WORDS,
    ),
    _r(
        "player-career-three-pct",
        "Best career three-point percentage",
        "3P%",
        f"Three-pointers made over attempted. {_attempts(CAREER_MINIMUMS['3pt'])}. {_CAREER}.",
        _career_pct(
            _PST.three_pointers_made, _PST.three_pointers_attempted, CAREER_MINIMUMS["3pt"]
        ),
        "shot_pct",
        _THREES,
        _PCT,
        _CAREER_WORDS,
    ),
    _r(
        "player-career-field-goals",
        "Most career field goals",
        "field goals",
        f"Field goals made. {_CAREER}.",
        _career_made(_PST.field_goals_made, _PST.field_goals_attempted),
        "made_total",
        _FG,
        _CAREER_WORDS,
    ),
    _r(
        "player-career-field-goal-pct",
        "Best career field-goal percentage",
        "FG%",
        f"Field goals made over attempted. {_attempts(CAREER_MINIMUMS['fg'])}. {_CAREER}.",
        _career_pct(_PST.field_goals_made, _PST.field_goals_attempted, CAREER_MINIMUMS["fg"]),
        "shot_pct",
        _FG,
        _PCT,
        _CAREER_WORDS,
    ),
    _r(
        "player-career-free-throws",
        "Most career free throws",
        "free throws",
        f"Free throws made. {_CAREER}.",
        _career_made(_PST.free_throws_made, _PST.free_throws_attempted),
        "made_total",
        _FT,
        _CAREER_WORDS,
    ),
    _r(
        "player-career-free-throw-pct",
        "Best career free-throw percentage",
        "FT%",
        f"Free throws made over attempted. {_attempts(CAREER_MINIMUMS['ft'])}. {_CAREER}.",
        _career_pct(_PST.free_throws_made, _PST.free_throws_attempted, CAREER_MINIMUMS["ft"]),
        "shot_pct",
        _FT,
        _PCT,
        _CAREER_WORDS,
    ),
    _r(
        "player-career-ppg",
        "Most career points per game",
        "points per game",
        f"Points per played game. {_games(CAREER_AVERAGE_GAMES)}. {_CAREER}.",
        _career_average(_PST.points),
        "average",
        _POINTS,
        "ppg",
        _AVG,
        _CAREER_WORDS,
    ),
    _r(
        "player-career-rpg",
        "Most career rebounds per game",
        "rebounds per game",
        f"Rebounds per played game. {_games(CAREER_AVERAGE_GAMES)}. {_CAREER}.",
        _career_average(_PST.rebounds),
        "average",
        _REBOUNDS,
        "rpg",
        _AVG,
        _CAREER_WORDS,
    ),
    _r(
        "player-career-apg",
        "Most career assists per game",
        "assists per game",
        f"Assists per played game. {_games(CAREER_AVERAGE_GAMES)}. {_CAREER}.",
        _career_average(_PST.assists),
        "average",
        _ASSISTS,
        "apg",
        _AVG,
        _CAREER_WORDS,
    ),
    _r(
        "player-career-spg",
        "Most career steals per game",
        "steals per game",
        f"Steals per played game. {_games(CAREER_AVERAGE_GAMES)}. {_CAREER}.",
        _career_average(_PST.steals),
        "average",
        _STEALS,
        "spg",
        _AVG,
        _CAREER_WORDS,
    ),
    _r(
        "player-career-bpg",
        "Most career blocks per game",
        "blocks per game",
        f"Blocks per played game. {_games(CAREER_AVERAGE_GAMES)}. {_CAREER}.",
        _career_average(_PST.blocks),
        "average",
        _BLOCKS,
        "bpg",
        _AVG,
        _CAREER_WORDS,
    ),
)

_PLAYOFF_TYPES: tuple[str, ...] = ("playoffs",)

_PLAYER_PLAYOFFS = _in(
    "player-playoffs",
    _r(
        "player-championships",
        "Most championships",
        "titles",
        "Titles won: seasons with a played line (minutes on the court) for the champion"
        f" in that season's NBA Finals. {_FINALS}.",
        _player_championships,
        "count",
        _TITLES,
        _PLAYOFFS,
    ),
    _r(
        "player-playoff-points-game",
        "Most points in a playoff game",
        "points",
        f"Points by one player in one game. {_PLAYOFF_GAME}.",
        _player_game(_P.points, game_types=_PLAYOFF_TYPES),
        "count",
        _POINTS,
        _PLAYOFFS,
        _GAME,
    ),
    _r(
        "player-playoff-rebounds-game",
        "Most rebounds in a playoff game",
        "rebounds",
        f"Rebounds by one player in one game. {_PLAYOFF_GAME}.",
        _player_game(_P.rebounds, game_types=_PLAYOFF_TYPES),
        "count",
        _REBOUNDS,
        _PLAYOFFS,
        _GAME,
    ),
    _r(
        "player-playoff-assists-game",
        "Most assists in a playoff game",
        "assists",
        f"Assists by one player in one game. {_PLAYOFF_GAME}.",
        _player_game(_P.assists, game_types=_PLAYOFF_TYPES),
        "count",
        _ASSISTS,
        _PLAYOFFS,
        _GAME,
    ),
    _r(
        "player-playoff-threes-game",
        "Most threes in a playoff game",
        "threes",
        f"Three-pointers made by one player in one game. {_PLAYOFF_GAME}.",
        _player_game_made(
            _P.three_pointers_made, _P.three_pointers_attempted, game_types=_PLAYOFF_TYPES
        ),
        "made_total",
        _THREES,
        _PLAYOFFS,
        _GAME,
    ),
    _r(
        "player-playoff-steals-game",
        "Most steals in a playoff game",
        "steals",
        f"Steals by one player in one game. {_PLAYOFF_GAME}.",
        _player_game(_P.steals, game_types=_PLAYOFF_TYPES),
        "count",
        _STEALS,
        _PLAYOFFS,
        _GAME,
    ),
    _r(
        "player-playoff-blocks-game",
        "Most blocks in a playoff game",
        "blocks",
        f"Blocks by one player in one game. {_PLAYOFF_GAME}.",
        _player_game(_P.blocks, game_types=_PLAYOFF_TYPES),
        "count",
        _BLOCKS,
        _PLAYOFFS,
        _GAME,
    ),
    _r(
        "player-playoff-career-points",
        "Most career playoff points",
        "points",
        f"Points. {_PLAYOFF_CAREER}.",
        _career_total(_PST.points, game_type="playoffs"),
        "count",
        _POINTS,
        _PLAYOFFS,
        _CAREER_WORDS,
    ),
    _r(
        "player-playoff-career-rebounds",
        "Most career playoff rebounds",
        "rebounds",
        f"Rebounds. {_PLAYOFF_CAREER}.",
        _career_total(_PST.rebounds, game_type="playoffs"),
        "count",
        _REBOUNDS,
        _PLAYOFFS,
        _CAREER_WORDS,
    ),
    _r(
        "player-playoff-career-assists",
        "Most career playoff assists",
        "assists",
        f"Assists. {_PLAYOFF_CAREER}.",
        _career_total(_PST.assists, game_type="playoffs"),
        "count",
        _ASSISTS,
        _PLAYOFFS,
        _CAREER_WORDS,
    ),
    _r(
        "player-playoff-career-threes",
        "Most career playoff threes",
        "threes",
        f"Three-pointers made. {_PLAYOFF_CAREER}.",
        _career_made(_PST.three_pointers_made, _PST.three_pointers_attempted, game_type="playoffs"),
        "made_total",
        _THREES,
        _PLAYOFFS,
        _CAREER_WORDS,
    ),
    _r(
        "player-playoff-career-steals",
        "Most career playoff steals",
        "steals",
        f"Steals. {_PLAYOFF_CAREER}.",
        _career_total(_PST.steals, game_type="playoffs"),
        "count",
        _STEALS,
        _PLAYOFFS,
        _CAREER_WORDS,
    ),
    _r(
        "player-playoff-career-blocks",
        "Most career playoff blocks",
        "blocks",
        f"Blocks. {_PLAYOFF_CAREER}.",
        _career_total(_PST.blocks, game_type="playoffs"),
        "count",
        _BLOCKS,
        _PLAYOFFS,
        _CAREER_WORDS,
    ),
    _r(
        "player-playoff-career-games",
        "Most career playoff games",
        "games",
        f"Games played (minutes on the court). {_PLAYOFF_CAREER}.",
        _career_total(_PST.games, game_type="playoffs"),
        "count",
        "games played",
        _PLAYOFFS,
        _CAREER_WORDS,
    ),
)

RECORDS: tuple[RecordDefinition, ...] = tuple(
    replace(record, featured_rank=FEATURED.index(record.id) + 1)
    if record.id in FEATURED
    else record
    for record in (
        *_TEAM_FRANCHISE,
        *_TEAM_SEASON,
        *_TEAM_GAME,
        *_PLAYER_GAME,
        *_PLAYER_SEASON,
        *_PLAYER_CAREER,
        *_PLAYER_PLAYOFFS,
    )
)

RECORDS_BY_ID: Mapping[str, RecordDefinition] = {record.id: record for record in RECORDS}


def _catalog_entry(record: RecordDefinition) -> RecordCatalogEntry:
    """Fail-fast at import: a registered record has a category and keywords."""
    if record.category is None or not record.keywords:
        raise ValueError(f"record {record.id} has no category or no keywords")
    return RecordCatalogEntry(
        id=record.id,
        group=record.group,
        category=record.category,
        title=record.title,
        unit=record.unit,
        rule=record.rule,
        value_kind=record.value_kind,
        keywords=list(record.keywords),
        featured_rank=record.featured_rank,
    )


# The catalog is static: built once, at import.
CATALOG: tuple[RecordCatalogEntry, ...] = tuple(_catalog_entry(record) for record in RECORDS)


# ------------------------------------------------------------ the read side


def _ordered(source: Subquery | CTE, order: tuple[tuple[str, bool], ...]) -> list[Any]:
    return [source.c[name].desc() if desc else source.c[name].asc() for name, desc in order]


def _with_refs(source: Subquery | CTE, *extra: ColumnElement[Any]) -> Select[Any]:
    """Every column of `source` with the team, player, game and opponent
    each names (outer joins: a record without one has nulls)."""
    opponent = aliased(Team, name="opponent")
    return (
        select(
            source,
            Team.name.label("team_name"),
            Team.abbreviation.label("team_abbreviation"),
            Player.first_name.label("first_name"),
            Player.last_name.label("last_name"),
            Game.date.label("game_date"),
            Game.game_type.label("game_type"),
            opponent.abbreviation.label("opponent_abbreviation"),
            *extra,
        )
        .select_from(source)
        .outerjoin(Team, Team.id == source.c.team_id)
        .outerjoin(Player, Player.id == source.c.player_id)
        .outerjoin(Game, Game.id == source.c.game_id)
        .outerjoin(opponent, opponent.id == source.c.opponent_id)
    )


def _figures(row: RowMapping, value_kind: ValueKind) -> dict[str, Any]:
    """`value` and the figures behind it, by the record's kind. Percentages
    use events/' one rounding rule (service._pct, as standings' win_pct);
    the exact fraction still ranks and orders."""
    figures: dict[str, Any] = dict.fromkeys(("wins", "losses", "made", "attempted", "pct"))
    if value_kind == "win_loss":
        pct = _pct(row["wins"], row["games"])
        return {
            **figures,
            # A listed season has played games, so the percentage is never null.
            "value": pct or 0.0,
            "wins": int(row["wins"]),
            "losses": int(row["losses"]),
            "pct": pct,
        }
    if value_kind == "made_total":
        made, attempted = int(row["value"]), int(row["attempted"])
        return {
            **figures,
            "value": made,
            "made": made,
            "attempted": attempted,
            "pct": _pct(made, attempted),
        }
    if value_kind == "shot_pct":
        made, attempted = int(row["made"]), int(row["attempted"])
        pct = _pct(made, attempted)
        return {
            **figures,
            # A listed percentage has attempts, so it is never null.
            "value": pct or 0.0,
            "made": made,
            "attempted": attempted,
            "pct": pct,
        }
    if value_kind == "average":
        # One place, as service._per_game rounds; the exact mean ranks.
        return {**figures, "value": round(float(row["value"]), 1)}
    return {**figures, "value": row["value"]}


def _entry_fields(row: RowMapping, *, value_kind: ValueKind) -> dict[str, Any]:
    team = (
        TeamRef(id=row["team_id"], name=row["team_name"], abbreviation=row["team_abbreviation"])
        if row["team_id"] is not None
        else None
    )
    player = (
        RecordPlayer(id=row["player_id"], first_name=row["first_name"], last_name=row["last_name"])
        if row["player_id"] is not None
        else None
    )
    game = (
        RecordGame(
            id=row["game_id"],
            date=row["game_date"],
            game_type=row["game_type"],
            opponent_abbreviation=row["opponent_abbreviation"],
        )
        if row["game_id"] is not None
        else None
    )
    return {
        "rank": int(row["rank"]),
        "team": team,
        "player": player,
        "season": row["season"],
        "game": game,
        **_figures(row, value_kind),
    }


def _window(session: Session) -> tuple[str | None, str | None]:
    """The earliest and latest stored seasons. One query."""
    since, through = session.execute(select(func.min(Game.season), func.max(Game.season))).one()
    return since, through


def _by_value(source: Subquery | CTE, candidates: Candidates) -> Any:
    """`source` ordered on the rank column alone, so equal values tie."""
    return _ordered(source, candidates.order[:1])[0]


def _holder_statement(candidates: Candidates) -> Select[Any]:
    """At most TOP rows: the list's first TOP entries in its order, each
    with its rank and the holder's tied_count.

    FETCH FIRST TOP ROWS WITH TIES on the rank column alone is the list's
    first TOP values and everything tied with them (an index's first few
    entries, where one serves), so it holds every entry sharing the top
    value: tied_count counts its rank-1 rows. Ranks are the list's
    (_list_statement): an entry's rank counts only the better values, all
    of them in `tied`. The list's full order then numbers the rows and the
    position cuts them to TOP; the first is the holder."""
    rows = candidates.rows.subquery("candidates")
    tied = (
        select(rows)
        .order_by(_by_value(rows, candidates))
        .fetch(TOP, with_ties=True)
        .subquery("tied")
    )
    ranked = select(
        tied,
        func.rank().over(order_by=_by_value(tied, candidates)).label("rank"),
        func.row_number().over(order_by=_ordered(tied, candidates.order)).label("position"),
    ).subquery("ranked")
    # A window cannot nest in another, so the count reads `ranked`.
    counted = select(
        ranked,
        func.count().filter(ranked.c.rank == 1).over().label("tied_count"),
    ).subquery("counted")
    return _with_refs(counted).where(counted.c.position <= TOP).order_by(counted.c.position)


def _list_statement(candidates: Candidates, *, limit: int, offset: int) -> Select[Any]:
    """One row per entry of the page, each with the list's total; one row
    of nulls but the total when the page is empty.

    `top` is the first LIST_CAP rows on the rank column alone, WITH TIES:
    the whole list and anything tied with its last value, read straight off
    an index where one serves. The list's full order then numbers it, and
    the position cuts it to LIST_CAP. Ranks are unchanged by the extra rows:
    an entry's rank counts only the better values, all of them in `top`."""
    rows = candidates.rows.subquery("candidates")
    top = (
        select(rows)
        .order_by(_by_value(rows, candidates))
        .fetch(LIST_CAP, with_ties=True)
        .cte("top")
    )
    ranked = select(
        top,
        func.rank().over(order_by=_by_value(top, candidates)).label("rank"),
        func.row_number().over(order_by=_ordered(top, candidates.order)).label("position"),
    ).subquery("ranked")
    page = (
        _with_refs(ranked)
        .where(
            ranked.c.position > offset,
            ranked.c.position <= offset + limit,
            ranked.c.position <= LIST_CAP,
        )
        .subquery("page")
    )
    # WITH TIES can hold more than LIST_CAP rows; the list never does.
    total = (
        select(func.least(func.count(), LIST_CAP).label("total")).select_from(top).subquery("total")
    )
    return (
        select(total.c.total, page)
        .select_from(total.outerjoin(page, true()))
        .order_by(page.c.position)
    )


# Built once per process, on first use: the statements take no parameters,
# and building one is about 2 ms of Python on the full load.
@cache
def _holder_for(record_id: str) -> tuple[Select[Any], ValueKind]:
    """A record's holder statement, and its definition's value_kind."""
    record = RECORDS_BY_ID[record_id]
    return _holder_statement(record.candidates()), record.value_kind


def records_catalog(session: Session) -> RecordsCatalog:
    """Every record, no holder, and the data window. One query (the window):
    the catalog itself is the registry, built at import."""
    since, through = _window(session)
    return RecordsCatalog(since_season=since, through_season=through, records=list(CATALOG))


def holder_ids(raw: str) -> tuple[str, ...]:
    """The holders route's `ids`, a comma-separated list of 1 to
    HOLDERS_CAP distinct known record ids. ValueError otherwise."""
    ids = tuple(raw.split(","))
    if not raw or len(ids) > HOLDERS_CAP:
        raise ValueError(f"ids must name 1 to {HOLDERS_CAP} records")
    if len(set(ids)) != len(ids):
        raise ValueError("ids must not repeat a record")
    unknown = [record_id for record_id in ids if record_id not in RECORDS_BY_ID]
    if unknown:
        raise ValueError(f"unknown record ids: {', '.join(unknown)}")
    return ids


def record_holders(session: Session, ids: tuple[str, ...]) -> RecordHolders:
    """Each record's holder, or None when nothing qualifies, for known ids
    (holder_ids). len(ids) queries, each fetching at most TOP rows: the
    holder is the first, `top` all of them, as the list returns them."""
    holders: dict[str, RecordHolder | None] = {}
    for record_id in ids:
        statement, value_kind = _holder_for(record_id)
        rows = session.execute(statement).mappings().all()
        if not rows:
            holders[record_id] = None
            continue
        holders[record_id] = RecordHolder(
            **_entry_fields(rows[0], value_kind=value_kind),
            tied_count=int(rows[0]["tied_count"]),
            top=[RecordEntry(**_entry_fields(row, value_kind=value_kind)) for row in rows],
        )
    return RecordHolders(holders=holders)


def record_list(session: Session, record_id: str, *, limit: int, offset: int) -> RecordList | None:
    """One page of a record's top LIST_CAP, or None for an unknown id. Two
    queries: the data window and the page with its total."""
    record = RECORDS_BY_ID.get(record_id)
    if record is None:
        return None
    since, through = _window(session)
    candidates = record.candidates()
    rows = session.execute(_list_statement(candidates, limit=limit, offset=offset)).mappings().all()
    total = int(rows[0]["total"]) if rows else 0
    entries = [
        RecordEntry(**_entry_fields(row, value_kind=record.value_kind))
        for row in rows
        if row["position"] is not None
    ]
    return RecordList(
        id=record.id,
        group=record.group,
        title=record.title,
        unit=record.unit,
        rule=record.rule,
        value_kind=record.value_kind,
        since_season=since,
        through_season=through,
        total=total,
        entries=entries,
    )
