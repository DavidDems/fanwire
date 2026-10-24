"""Historical records (EVENTS-010): GET /events/records and
GET /events/records/{record_id}.

The registry, RECORDS, is the fixed, named set of records in the order the
summary lists them (team records, then player records). Each record names
its id, group, title, unit and rule text, and holds its query builder: a
Strategy (wiki/CodeContext/Standards/gof-patterns.md) that returns the
record's *candidates*, every qualifying row with its value, and the list's
order. The two read models below run any record's candidates the same way,
so a new record is one more entry in RECORDS, never a branch here.

Everything is computed in Postgres, live at read time (0x02-events.md: no
aggregate table until a measured query is too slow): values with GROUP BY
or a plain expression, the top of the list with FETCH FIRST ... WITH TIES
on the ranked value (an index scan where app.events.models declares one), ranks
with RANK() (competition ranking) over that top, `tied_count` with a count
in the same statement. No box-score or game row is ever loaded into Python:
a summary fetches one row per record, a list at most one page.

Query counts, whatever the data's size: the summary is 1 + len(RECORDS)
statements (the data window, then one holder per record) and a list is 2
(the data window, then the page with its total).

Counting rules, stated in each rule text: single-game records count
`regular` and `playoffs` games only (not the play-in or the NBA Cup final);
season records count `regular` games, and only seasons with a champion (a
season in progress never holds one); championships use the champion rule
of GET /events/seasons/{season}/champion, through the same helper
(service.season_champions); career records count played lines of `regular`
games. A did-not-play line (no minutes) never counts.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import (
    BigInteger,
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
    null,
    select,
    true,
    union_all,
)
from sqlalchemy.orm import QueryableAttribute, Session, aliased
from sqlalchemy.sql.elements import ColumnElement
from sqlalchemy.sql.selectable import CTE

from app.events.models import FINALS_LABEL, TRIPLE_DOUBLE, Game, Player, PlayerGameStats, Team
from app.events.service import REGULAR, TeamRef, _pct, season_champions

# A list holds at most its top LIST_CAP entries; ties at the cut are cut by
# the list's order.
LIST_CAP = 100

# The game types a single-game record counts.
SINGLE_GAME_TYPES: tuple[str, ...] = (REGULAR, "playoffs")

RecordGroup = Literal["team", "player"]

# A column a candidates query labels: an expression or a mapped attribute.
_Column = ColumnElement[Any] | QueryableAttribute[Any]

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


@dataclass(frozen=True)
class RecordHolder(RecordEntry):
    """The list's first entry, and how many entries share its value."""

    tied_count: int


@dataclass(frozen=True)
class RecordSummary:
    id: str
    group: RecordGroup
    title: str
    unit: str
    rule: str
    holder: RecordHolder | None


@dataclass(frozen=True)
class RecordsSummary:
    """GET /events/records."""

    since_season: str | None
    through_season: str | None
    records: list[RecordSummary]


@dataclass(frozen=True)
class RecordList:
    """GET /events/records/{record_id}: one page of the top LIST_CAP."""

    id: str
    group: RecordGroup
    title: str
    unit: str
    rule: str
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
    # The value shown is a win percentage, from the `wins` and `games`
    # columns, rounded by events/' one percentage rule (service._pct, as
    # standings' win_pct); the exact fraction still ranks and orders.
    percentage: bool = False


@dataclass(frozen=True)
class RecordDefinition:
    id: str
    group: RecordGroup
    title: str
    unit: str
    rule: str
    candidates: Callable[[], Candidates]


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
            games=games,
        )
    ).group_by(sides.c.season, sides.c.team_id)
    return Candidates(
        rows=rows,
        order=(("fraction", best), ("wins", best), ("season", False), ("team_id", False)),
        percentage=True,
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


def _player_game(stat: str) -> Callable[[], Candidates]:
    def candidates() -> Candidates:
        opponent = case(
            (Game.home_team_id == PlayerGameStats.team_id, Game.away_team_id),
            else_=Game.home_team_id,
        )
        rows = (
            select(
                *_columns(
                    getattr(PlayerGameStats, stat),
                    team_id=PlayerGameStats.team_id,
                    player_id=PlayerGameStats.player_id,
                    season=Game.season,
                    game_id=Game.id,
                    opponent_id=opponent,
                    date=Game.date,
                    line_id=PlayerGameStats.id,
                )
            )
            .select_from(PlayerGameStats)
            .join(Game, Game.id == PlayerGameStats.game_id)
            .where(PlayerGameStats.played, Game.game_type.in_(SINGLE_GAME_TYPES))
        )
        return Candidates(
            rows=rows,
            order=(("value", True), ("date", False), ("player_id", False), ("line_id", False)),
        )

    return candidates


def _career(value: ColumnElement[Any], *where: ColumnElement[bool]) -> Candidates:
    """Per player, over its played lines of `regular` games; only players
    above zero are listed."""
    rows = (
        select(*_columns(value, player_id=PlayerGameStats.player_id))
        .select_from(PlayerGameStats)
        .join(Game, Game.id == PlayerGameStats.game_id)
        .where(PlayerGameStats.played, Game.game_type == REGULAR, *where)
        .group_by(PlayerGameStats.player_id)
        .having(value > 0)
    )
    return Candidates(rows=rows, order=(("value", True), ("player_id", False)))


def _career_points() -> Candidates:
    return _career(func.sum(PlayerGameStats.points))


def _career_triple_doubles() -> Candidates:
    # models.TRIPLE_DOUBLE: also the predicate of the index that serves this.
    return _career(func.count(), TRIPLE_DOUBLE)


_SINGLE_GAME = "Regular-season and playoff games only (not the play-in or the NBA Cup final)"
_SEASONS = (
    "Regular-season games only, in seasons with a champion (a season in progress never holds it)"
)
_FINALS = (
    "Champion: the team that wins four of a season's playoff games labelled NBA Finals,"
    " as GET /events/seasons/{season}/champion decides"
)

RECORDS: tuple[RecordDefinition, ...] = (
    RecordDefinition(
        id="team-championships",
        group="team",
        title="Most championships",
        unit="titles",
        rule=f"NBA titles won. {_FINALS}.",
        candidates=_team_championships,
    ),
    RecordDefinition(
        id="team-best-season",
        group="team",
        title="Best regular season",
        unit="win %",
        rule=f"Highest win percentage in one season, then most wins. {_SEASONS}.",
        candidates=lambda: _season_record(best=True),
    ),
    RecordDefinition(
        id="team-worst-season",
        group="team",
        title="Worst regular season",
        unit="win %",
        rule=f"Lowest win percentage in one season, then fewest wins. {_SEASONS}.",
        candidates=lambda: _season_record(best=False),
    ),
    RecordDefinition(
        id="team-most-points-game",
        group="team",
        title="Most points in a game",
        unit="points",
        rule=f"Points scored by one team in one game. {_SINGLE_GAME}.",
        candidates=_team_most_points_game,
    ),
    RecordDefinition(
        id="team-largest-win",
        group="team",
        title="Largest win",
        unit="points",
        rule=f"Margin of victory in one game. {_SINGLE_GAME}.",
        candidates=_team_largest_win,
    ),
    RecordDefinition(
        id="player-championships",
        group="player",
        title="Most championships",
        unit="titles",
        rule=(
            "Titles won: seasons with a played line (minutes on the court) for the champion"
            f" in that season's NBA Finals. {_FINALS}."
        ),
        candidates=_player_championships,
    ),
    RecordDefinition(
        id="player-points-game",
        group="player",
        title="Most points in a game",
        unit="points",
        rule=f"Points by one player in one game. {_SINGLE_GAME}.",
        candidates=_player_game("points"),
    ),
    RecordDefinition(
        id="player-rebounds-game",
        group="player",
        title="Most rebounds in a game",
        unit="rebounds",
        rule=f"Rebounds by one player in one game. {_SINGLE_GAME}.",
        candidates=_player_game("rebounds"),
    ),
    RecordDefinition(
        id="player-assists-game",
        group="player",
        title="Most assists in a game",
        unit="assists",
        rule=f"Assists by one player in one game. {_SINGLE_GAME}.",
        candidates=_player_game("assists"),
    ),
    RecordDefinition(
        id="player-threes-game",
        group="player",
        title="Most threes in a game",
        unit="threes",
        rule=f"Three-pointers made by one player in one game. {_SINGLE_GAME}.",
        candidates=_player_game("three_pointers_made"),
    ),
    RecordDefinition(
        id="player-career-points",
        group="player",
        title="Most career points",
        unit="points",
        rule="Regular-season points, summed over every played game.",
        candidates=_career_points,
    ),
    RecordDefinition(
        id="player-career-triple-doubles",
        group="player",
        title="Most career triple-doubles",
        unit="triple-doubles",
        rule=(
            "Regular-season games with 10 or more in at least three of points, rebounds,"
            " assists, steals and blocks."
        ),
        candidates=_career_triple_doubles,
    ),
)

RECORDS_BY_ID: Mapping[str, RecordDefinition] = {record.id: record for record in RECORDS}


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


def _entry_fields(row: RowMapping, *, percentage: bool) -> dict[str, Any]:
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
        # A listed season has played games, so the percentage is never null.
        "value": (_pct(row["wins"], row["games"]) or 0.0) if percentage else row["value"],
        "team": team,
        "player": player,
        "season": row["season"],
        "game": game,
    }


def _window(session: Session) -> tuple[str | None, str | None]:
    """The earliest and latest stored seasons. One query."""
    since, through = session.execute(select(func.min(Game.season), func.max(Game.season))).one()
    return since, through


def _by_value(source: Subquery | CTE, candidates: Candidates) -> Any:
    """`source` ordered on the rank column alone, so equal values tie."""
    return _ordered(source, candidates.order[:1])[0]


def _holder_statement(candidates: Candidates) -> Select[Any]:
    """At most one row: the list's first entry and its tied_count.

    FETCH FIRST 1 ROW WITH TIES on the rank column alone is every entry
    sharing the top value (an index's first few entries, where one serves):
    tied_count is their number, the holder the first of them in the list's
    order."""
    rows = candidates.rows.subquery("candidates")
    tied = (
        select(rows).order_by(_by_value(rows, candidates)).fetch(1, with_ties=True).subquery("tied")
    )
    top = (
        select(tied, func.count().over().label("tied_count"))
        .order_by(*_ordered(tied, candidates.order))
        .limit(1)
        .subquery("top")
    )
    # tied_count is already one of top's columns.
    return _with_refs(top, literal(1).label("rank"))


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


def records_summary(session: Session) -> RecordsSummary:
    """Every record with its holder. 1 + len(RECORDS) queries, each
    fetching at most one row."""
    since, through = _window(session)
    summaries = []
    for record in RECORDS:
        candidates = record.candidates()
        row = session.execute(_holder_statement(candidates)).mappings().first()
        holder = (
            RecordHolder(
                **_entry_fields(row, percentage=candidates.percentage),
                tied_count=int(row["tied_count"]),
            )
            if row is not None
            else None
        )
        summaries.append(
            RecordSummary(
                id=record.id,
                group=record.group,
                title=record.title,
                unit=record.unit,
                rule=record.rule,
                holder=holder,
            )
        )
    return RecordsSummary(since_season=since, through_season=through, records=summaries)


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
        RecordEntry(**_entry_fields(row, percentage=candidates.percentage))
        for row in rows
        if row["position"] is not None
    ]
    return RecordList(
        id=record.id,
        group=record.group,
        title=record.title,
        unit=record.unit,
        rule=record.rule,
        since_season=since,
        through_season=through,
        total=total,
        entries=entries,
    )
