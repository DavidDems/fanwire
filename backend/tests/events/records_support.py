"""Shared builders for EVENTS-010's records tests (test_records.py,
test_records_queries.py, test_records_contract.py).

Plain functions and dataclasses, as in players_support.py and
seasons_support.py, which this module builds on.

`build_fixture` writes a small synthetic history and returns every game and
box-score row it wrote, so a test can derive each record's expected list
independently, in Python, with `expected_records` (never by calling app
code). The fixture holds every trap of the brief:

- three seasons with a champion (2010-11 AAA, 2011-12 BBB, 2012-13 AAA) and
  one without (2013-14: a Finals in progress at 3-0), in which DDD goes 6-0
  and CCC 0-6, the best and worst raw records, which must not count;
- ties for first: team points in one game (140, twice), player points (50,
  twice), rebounds (20 and 20 in the same game), player championships
  (three players with two), best season (10-2 and 5-1);
- a fraction tie decided by wins (8-4 before 4-2) and one decided by season
  (2-4 in 2010-11 before 2-4 in 2012-13);
- a did-not-play line with huge numbers, a play-in game and a cup-final
  game with huge scores and lines, none of which may appear anywhere;
- a triple-double of points, steals and blocks, two of points, rebounds
  and assists, one in the playoffs (not a regular game), and a near miss
  with only two 10s;
- a bench player of the 2010-11 champion who played in the regular season
  and a conference final but only has did-not-play lines in the Finals (no
  title).

`add_copies` writes every season again under new season labels (new games
and lines, the same teams and players), for the query-count tests' second
size.

Every played line has at least 1 point, rebound, assist and three, so a
single-game list's length does not depend on whether zeros are listed.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date, datetime
from fractions import Fraction
from typing import Any

from sqlalchemy import Engine, event
from sqlalchemy.orm import Session

from app.events.models import PlayerGameStats, Team
from tests.events.players_support import COUNTING_STATS, add_game, add_player, add_team
from tests.events.seasons_support import Calendar

RECORD_IDS: tuple[str, ...] = (
    "team-championships",
    "team-best-season",
    "team-worst-season",
    "team-most-points-game",
    "team-largest-win",
    "player-championships",
    "player-points-game",
    "player-rebounds-game",
    "player-assists-game",
    "player-threes-game",
    "player-career-points",
    "player-career-triple-doubles",
)
TEAM_RECORDS = frozenset(RECORD_IDS[:5])
PLAYER_RECORDS = frozenset(RECORD_IDS[5:])
SEASON_RECORDS = frozenset({"team-best-season", "team-worst-season"})
GAME_RECORDS = frozenset(
    {
        "team-most-points-game",
        "team-largest-win",
        "player-points-game",
        "player-rebounds-game",
        "player-assists-game",
        "player-threes-game",
    }
)
# Counts and sums: integer values, only entries above zero are listed.
COUNT_RECORDS = frozenset(
    {
        "team-championships",
        "player-championships",
        "player-career-points",
        "player-career-triple-doubles",
    }
)
PLAYER_GAME_STAT: dict[str, str] = {
    "player-points-game": "points",
    "player-rebounds-game": "rebounds",
    "player-assists-game": "assists",
    "player-threes-game": "three_pointers_made",
}
TRIPLE_DOUBLE_STATS: tuple[str, ...] = ("points", "rebounds", "assists", "steals", "blocks")
RECORD_STATS: tuple[str, ...] = (
    "points",
    "rebounds",
    "assists",
    "steals",
    "blocks",
    "three_pointers_made",
)

LIST_CAP = 100
FINALS = "NBA Finals"
SINGLE_GAME_TYPES = frozenset({"regular", "playoffs"})

TEAM_LETTERS: tuple[str, ...] = ("A", "B", "C", "D")
CORE_PLAYERS: dict[str, tuple[str, ...]] = {
    letter: tuple(f"{letter}{n}" for n in (1, 2, 3)) for letter in TEAM_LETTERS
}
PAIRS: tuple[str, ...] = ("AB", "AC", "AD", "BC", "BD", "CD")


# ------------------------------------------------------------------ rows


@dataclass(frozen=True)
class GameRow:
    id: int
    season: str
    date: datetime
    game_type: str
    label: str | None
    home_id: int
    away_id: int
    home_score: int
    away_score: int


@dataclass(frozen=True)
class LineRow:
    game_id: int
    team_id: int
    player_id: int
    played: bool
    stats: dict[str, int]


@dataclass
class Fixture:
    team_ids: dict[str, int] = field(default_factory=dict)  # letter -> id
    abbreviations: dict[int, str] = field(default_factory=dict)  # id -> abbreviation
    team_names: dict[int, str] = field(default_factory=dict)
    player_ids: dict[str, int] = field(default_factory=dict)  # key -> id
    player_names: dict[int, tuple[str, str]] = field(default_factory=dict)
    games: list[GameRow] = field(default_factory=list)
    lines: list[LineRow] = field(default_factory=list)
    score_counter: int = 0
    line_counter: int = 0


# ------------------------------------------------------------- the plan


TRIPLE_DOUBLE = {"points": 20, "rebounds": 10, "assists": 10}
STEALS_BLOCKS_TRIPLE_DOUBLE = {
    "points": 10,
    "rebounds": 2,
    "assists": 2,
    "steals": 10,
    "blocks": 10,
    "three_pointers_made": 1,
}
PLAYOFF_TRIPLE_DOUBLE = {"points": 20, "rebounds": 12, "assists": 11}
NEAR_MISS = {"points": 30, "rebounds": 15, "assists": 9, "steals": 0, "blocks": 0}
EXCLUDED_GAME_LINE = {
    "points": 99,
    "rebounds": 45,
    "assists": 35,
    "three_pointers_made": 25,
    "steals": 10,
}
DNP_LINE = {
    "points": 90,
    "rebounds": 40,
    "assists": 30,
    "three_pointers_made": 20,
    "steals": 10,
    "blocks": 10,
}
DID_NOT_PLAY = object()  # marks an extra line as a did-not-play row

Tag = tuple[Any, ...]


@dataclass(frozen=True)
class SeasonPlan:
    start_year: int
    rounds: int
    # pair "XY" -> games X wins against Y (Y wins the rest of `rounds`)
    wins: dict[str, int]
    # (X, Y, winner letter per game); X is at home in games 0, 1, 4, 6
    finals: tuple[str, str, str]
    finals_scores: dict[int, tuple[int, int]] = field(default_factory=dict)
    conference_final: tuple[str, str] | None = None  # (winner, loser)
    play_in: tuple[str, str, int, int] | None = None  # (home, away, home pts, away pts)
    cup_final: tuple[str, str, int, int] | None = None
    # tag -> {player key: stat overrides}
    overrides: dict[Tag, dict[str, dict[str, int]]] = field(default_factory=dict)
    # tag -> [(player key, team letter, stats or DID_NOT_PLAY or None)]
    extras: dict[Tag, list[tuple[str, str, Any]]] = field(default_factory=dict)


def _plans(year_offset: int = 0) -> list[SeasonPlan]:
    bench_finals = {("finals", n): [("BENCH", "A", DID_NOT_PLAY)] for n in range(5)}
    return [
        # 2010-11: AAA 5-1, BBB 4-2, CCC 1-5, DDD 2-4; AAA beats BBB 4-1.
        SeasonPlan(
            start_year=2010 + year_offset,
            rounds=2,
            wins={"AB": 1, "AC": 2, "AD": 2, "BC": 2, "BD": 1, "CD": 1},
            finals=("A", "B", "ABAAA"),
            finals_scores={0: (140, 110)},
            conference_final=("A", "C"),
            play_in=("A", "B", 250, 240),
            overrides={
                ("reg", "BD", 0): {"B1": {"rebounds": 20}, "D1": {"rebounds": 20}},
                ("reg", "CD", 0): {"C3": STEALS_BLOCKS_TRIPLE_DOUBLE},
                ("reg", "AB", 0): {"A2": TRIPLE_DOUBLE},
                ("play-in", 0): {"A3": EXCLUDED_GAME_LINE},
            },
            extras={
                ("reg", "AB", 0): [("BENCH", "A", None)],
                ("reg", "AB", 1): [("BENCH", "A", None), ("DNP", "B", DID_NOT_PLAY)],
                ("conf", 0): [("BENCH", "A", None)],
                **bench_finals,
            },
        ),
        # 2011-12: AAA 8-4, BBB 10-2, CCC 3-9, DDD 3-9; BBB beats AAA 4-2.
        SeasonPlan(
            start_year=2011 + year_offset,
            rounds=4,
            wins={"AB": 2, "AC": 3, "AD": 3, "BC": 4, "BD": 4, "CD": 2},
            finals=("B", "A", "BABABB"),
            finals_scores={2: (140, 135)},
            conference_final=("B", "C"),
            cup_final=("C", "D", 260, 120),
            overrides={
                ("reg", "AB", 0): {"A1": {"points": 50}},
                ("finals", 0): {"B2": {"three_pointers_made": 12}},
                ("finals", 1): {"B3": PLAYOFF_TRIPLE_DOUBLE},
                ("reg", "BD", 0): {"D3": NEAR_MISS},
                ("cup", 0): {"C1": EXCLUDED_GAME_LINE},
            },
        ),
        # 2012-13: AAA 4-2, BBB 3-3, CCC 2-4, DDD 3-3; AAA sweeps DDD.
        SeasonPlan(
            start_year=2012 + year_offset,
            rounds=2,
            wins={"AB": 2, "AC": 1, "AD": 1, "BC": 2, "BD": 1, "CD": 1},
            finals=("A", "D", "AAAA"),
            finals_scores={1: (130, 95)},
            conference_final=("A", "B"),
            overrides={
                ("reg", "CD", 0): {"C1": {"points": 50}},
                ("reg", "AD", 0): {"D2": {"assists": 15}},
                ("reg", "AB", 1): {"A2": TRIPLE_DOUBLE},
            },
        ),
        # 2013-14, in progress: DDD 6-0, CCC 0-6; AAA leads DDD 3-0 in the
        # Finals. No champion, so no season record.
        SeasonPlan(
            start_year=2013 + year_offset,
            rounds=2,
            wins={"AB": 1, "AC": 2, "AD": 0, "BC": 2, "BD": 0, "CD": 0},
            finals=("A", "D", "AAA"),
        ),
    ]


def _season_label(start_year: int) -> str:
    return f"{start_year}-{str(start_year + 1)[-2:]}"


# ---------------------------------------------------------------- build


def build_fixture(session: Session) -> Fixture:
    """Teams, players and the four planned seasons. The caller commits."""
    fx = Fixture()
    for letter in TEAM_LETTERS:
        abbreviation = letter * 3
        team = add_team(session, abbreviation, f"{abbreviation} Team")
        fx.team_ids[letter] = team.id
        fx.abbreviations[team.id] = abbreviation
        fx.team_names[team.id] = team.name
    keys = [key for letter in TEAM_LETTERS for key in CORE_PLAYERS[letter]] + ["DNP", "BENCH"]
    for key in keys:
        player = add_player(session, key, "Player")
        fx.player_ids[key] = player.id
        fx.player_names[player.id] = (key, "Player")
    for plan in _plans():
        _build_season(session, fx, plan)
    return fx


def add_copies(session: Session, fx: Fixture, copies: int = 3) -> None:
    """Every season again, `copies` times, under new season labels."""
    for copy in range(1, copies + 1):
        for plan in _plans(year_offset=4 * copy):
            _build_season(session, fx, plan)


def _next_scores(fx: Fixture) -> tuple[int, int]:
    n = fx.score_counter
    fx.score_counter += 1
    winner = 100 + (n * 7) % 23  # 100-122
    return winner, winner - 1 - (n * 5) % 17  # a margin of 1-17


def _generated_stats(fx: Fixture) -> dict[str, int]:
    """Never a triple-double: rebounds and assists stay below 10."""
    k = fx.line_counter
    fx.line_counter += 1
    return {
        "points": 5 + (k * 11) % 31,  # 5-35
        "rebounds": 1 + (k * 7) % 9,  # 1-9
        "assists": 1 + (k * 5) % 9,  # 1-9
        "three_pointers_made": 1 + (k * 3) % 7,  # 1-7
        "steals": k % 3,
        "blocks": k % 2,
    }


def _build_season(session: Session, fx: Fixture, plan: SeasonPlan) -> None:
    season = _season_label(plan.start_year)
    calendar = Calendar(date(plan.start_year, 10, 20))
    team = fx.team_ids

    def game(tag: Tag, home: str, away: str, home_score: int, away_score: int, **kw: Any) -> None:
        row = add_game(
            session,
            home=session.get(Team, team[home]),
            away=session.get(Team, team[away]),
            when=calendar.next(),
            season=season,
            home_score=home_score,
            away_score=away_score,
            **kw,
        )
        record = GameRow(
            id=row.id,
            season=season,
            date=row.date,
            game_type=row.game_type,
            label=row.label,
            home_id=row.home_team_id,
            away_id=row.away_team_id,
            home_score=home_score,
            away_score=away_score,
        )
        fx.games.append(record)
        _add_lines(session, fx, plan, tag, record, home, away)

    for round_ in range(plan.rounds):
        for pair in PAIRS:
            x, y = pair
            winner = x if round_ < plan.wins[pair] else y
            home, away = (x, y) if round_ % 2 == 0 else (y, x)
            high, low = _next_scores(fx)
            home_score, away_score = (high, low) if winner == home else (low, high)
            game(("reg", pair, round_), home, away, home_score, away_score)

    if plan.play_in is not None:
        home, away, home_score, away_score = plan.play_in
        game(("play-in", 0), home, away, home_score, away_score, game_type="play-in")
    if plan.cup_final is not None:
        home, away, home_score, away_score = plan.cup_final
        game(
            ("cup", 0),
            home,
            away,
            home_score,
            away_score,
            game_type="cup-final",
            label="Emirates NBA Cup",
        )
    if plan.conference_final is not None:
        winner, loser = plan.conference_final
        high, low = _next_scores(fx)
        game(
            ("conf", 0),
            winner,
            loser,
            high,
            low,
            game_type="playoffs",
            label="East - Conference Finals",
        )
    x, y, winners = plan.finals
    for n, winner in enumerate(winners):
        home, away = (x, y) if n in (0, 1, 4, 6) else (y, x)
        high, low = plan.finals_scores.get(n, (105 + n, 100 + n))
        home_score, away_score = (high, low) if winner == home else (low, high)
        game(("finals", n), home, away, home_score, away_score, game_type="playoffs", label=FINALS)


def _add_lines(
    session: Session,
    fx: Fixture,
    plan: SeasonPlan,
    tag: Tag,
    game: GameRow,
    home: str,
    away: str,
) -> None:
    overrides = plan.overrides.get(tag, {})
    wanted: list[tuple[str, str, Any]] = [
        (key, letter, overrides.get(key, {}))
        for letter in (home, away)
        for key in CORE_PLAYERS[letter]
    ]
    for key, letter, stats in plan.extras.get(tag, []):
        wanted.append((key, letter, stats))
    for key, letter, stats in wanted:
        played = stats is not DID_NOT_PLAY
        values = {stat: 0 for stat in COUNTING_STATS}
        if stats is DID_NOT_PLAY:
            if key == "DNP":
                values.update(DNP_LINE)
        else:
            values.update(_generated_stats(fx))
            values.update(stats or {})
        line = PlayerGameStats(
            game_id=game.id,
            team_id=fx.team_ids[letter],
            player_id=fx.player_ids[key],
            starter=False,
            starting_position=None,
            seconds_played=1800 if played else None,
            plus_minus=0,
            dnp_reason=None if played else "DNP - Coach's Decision",
            **values,
        )
        session.add(line)
        fx.lines.append(
            LineRow(
                game_id=game.id,
                team_id=fx.team_ids[letter],
                player_id=fx.player_ids[key],
                played=played,
                stats={stat: values[stat] for stat in RECORD_STATS},
            )
        )
    session.flush()


# ------------------------------------------------------- the 100-entry cap


def build_career_cap(session: Session) -> list[tuple[int, int, int]]:
    """106 players in one regular game: 98 with distinct points (300 down to
    203), five tied on 100 (places 99 to 103, so the tie straddles the cut)
    and three on 50. Returns the whole expected career-points list as
    (rank, value, player id), in the list's order. The caller commits."""
    home, away = add_team(session, "CAP"), add_team(session, "OPP")
    game = add_game(
        session,
        home=home,
        away=away,
        when=date(2015, 11, 1),
        season="2015-16",
        home_score=120,
        away_score=110,
    )
    points = [300 - n for n in range(98)] + [100] * 5 + [50] * 3
    players = [add_player(session, "Cap", f"N{n:03d}") for n in range(len(points))]
    # Written highest id first, so insertion order proves nothing.
    for n in reversed(range(len(points))):
        values = {stat: 0 for stat in COUNTING_STATS}
        values["points"] = points[n]
        session.add(
            PlayerGameStats(
                game_id=game.id,
                team_id=home.id if n % 2 else away.id,
                player_id=players[n].id,
                starter=False,
                starting_position=None,
                seconds_played=1200,
                plus_minus=0,
                dnp_reason=None,
                **values,
            )
        )
    session.flush()
    expected = []
    for n, value in enumerate(points):
        rank = 1 + sum(1 for other in points if other > value)
        expected.append((rank, value, players[n].id))
    return expected


# ------------------------------------------------------------ expectations


@dataclass
class ExpectedList:
    entries: list[dict[str, Any]]  # the whole qualifying list, ranked
    tied_count: int  # entries sharing the first-ranked value (0 when empty)


def expected_window(fx: Fixture) -> tuple[str | None, str | None]:
    seasons = [g.season for g in fx.games]
    return (min(seasons), max(seasons)) if seasons else (None, None)


def expected_champions(fx: Fixture) -> dict[str, int | None]:
    """Season -> the team with four wins in its playoffs games labelled
    "NBA Finals", or None."""
    result: dict[str, int | None] = {}
    for season in sorted({g.season for g in fx.games}):
        wins: Counter[int] = Counter()
        for g in fx.games:
            if g.season == season and g.game_type == "playoffs" and g.label == FINALS:
                wins[_winner(g)] += 1
        best = max(wins.values(), default=0)
        result[season] = next(t for t, w in wins.items() if w == best) if best >= 4 else None
    return result


def _winner(g: GameRow) -> int:
    return g.home_id if g.home_score > g.away_score else g.away_id


def _loser(g: GameRow) -> int:
    return g.away_id if g.home_score > g.away_score else g.home_id


def _opponent(g: GameRow, team_id: int) -> int:
    return g.away_id if team_id == g.home_id else g.home_id


def _entry(
    fx: Fixture,
    value: Any,
    *,
    team: int | None = None,
    player: int | None = None,
    season: str | None = None,
    game: GameRow | None = None,
    opponent: int | None = None,
) -> dict[str, Any]:
    return {
        "value": value,
        "team_id": team,
        "player_id": player,
        "season": season,
        "game_id": game.id if game else None,
        "game_type": game.game_type if game else None,
        "opponent": fx.abbreviations[opponent] if opponent is not None else None,
    }


def _ranked(
    items: list[tuple[dict[str, Any], Any, tuple]], *, ascending: bool = False
) -> ExpectedList:
    """items: (entry, the value it is ranked on, its sort key). Competition
    ranking: one plus the number of entries strictly better."""
    items = sorted(items, key=lambda item: item[2])
    entries = []
    for entry, rank_value, _ in items:
        better = sum(
            1 for _, other, _ in items if (other < rank_value if ascending else other > rank_value)
        )
        entries.append({"rank": better + 1, **entry})
    tied = sum(1 for _, other, _ in items if other == items[0][1]) if items else 0
    return ExpectedList(entries=entries, tied_count=tied)


def expected_records(fx: Fixture) -> dict[str, ExpectedList]:
    games = {g.id: g for g in fx.games}
    champions = expected_champions(fx)
    single = [g for g in fx.games if g.game_type in SINGLE_GAME_TYPES]
    out: dict[str, ExpectedList] = {}

    titles = Counter(team for team in champions.values() if team is not None)
    out["team-championships"] = _ranked(
        [(_entry(fx, n, team=team), n, (-n, team)) for team, n in titles.items()]
    )

    seasons = []
    for season, champion in champions.items():
        if champion is None:
            continue
        record: dict[int, list[int]] = defaultdict(lambda: [0, 0])
        for g in fx.games:
            if g.season == season and g.game_type == "regular":
                record[_winner(g)][0] += 1
                record[_loser(g)][1] += 1
        for team, (won, lost) in record.items():
            seasons.append((season, team, won, Fraction(won, won + lost)))
    out["team-best-season"] = _ranked(
        [
            (_entry(fx, round(float(f), 3), team=t, season=s), f, (-f, -w, s, t))
            for s, t, w, f in seasons
        ]
    )
    out["team-worst-season"] = _ranked(
        [
            (_entry(fx, round(float(f), 3), team=t, season=s), f, (f, w, s, t))
            for s, t, w, f in seasons
        ],
        ascending=True,
    )

    team_points = []
    for g in single:
        for team, points in ((g.home_id, g.home_score), (g.away_id, g.away_score)):
            opponent = _opponent(g, team)
            entry = _entry(fx, points, team=team, season=g.season, game=g, opponent=opponent)
            team_points.append((entry, points, (-points, g.date, team)))
    out["team-most-points-game"] = _ranked(team_points)

    margins = []
    for g in single:
        margin = abs(g.home_score - g.away_score)
        entry = _entry(fx, margin, team=_winner(g), season=g.season, game=g, opponent=_loser(g))
        margins.append((entry, margin, (-margin, g.date, _winner(g))))
    out["team-largest-win"] = _ranked(margins)

    finals_players: dict[int, set[str]] = defaultdict(set)
    for line in fx.lines:
        g = games[line.game_id]
        if (
            line.played
            and g.game_type == "playoffs"
            and g.label == FINALS
            and champions[g.season] == line.team_id
        ):
            finals_players[line.player_id].add(g.season)
    out["player-championships"] = _ranked(
        [
            (_entry(fx, len(won), player=player), len(won), (-len(won), player))
            for player, won in finals_players.items()
        ]
    )

    for record_id, stat in PLAYER_GAME_STAT.items():
        items = []
        for line in fx.lines:
            g = games[line.game_id]
            if not line.played or g.game_type not in SINGLE_GAME_TYPES:
                continue
            value = line.stats[stat]
            entry = _entry(
                fx,
                value,
                team=line.team_id,
                player=line.player_id,
                season=g.season,
                game=g,
                opponent=_opponent(g, line.team_id),
            )
            items.append((entry, value, (-value, g.date, line.player_id)))
        out[record_id] = _ranked(items)

    career: Counter[int] = Counter()
    triple_doubles: Counter[int] = Counter()
    for line in fx.lines:
        if not line.played or games[line.game_id].game_type != "regular":
            continue
        career[line.player_id] += line.stats["points"]
        if sum(line.stats[stat] >= 10 for stat in TRIPLE_DOUBLE_STATS) >= 3:
            triple_doubles[line.player_id] += 1
    out["player-career-points"] = _ranked(
        [(_entry(fx, n, player=p), n, (-n, p)) for p, n in career.items() if n > 0]
    )
    out["player-career-triple-doubles"] = _ranked(
        [(_entry(fx, n, player=p), n, (-n, p)) for p, n in triple_doubles.items() if n > 0]
    )
    return out


def normalize(entry: dict[str, Any]) -> dict[str, Any]:
    """An API entry in the shape `expected_records` derives."""
    team, player, game = entry["team"], entry["player"], entry["game"]
    return {
        "rank": entry["rank"],
        "value": entry["value"],
        "team_id": team["id"] if team else None,
        "player_id": player["id"] if player else None,
        "season": entry["season"],
        "game_id": game["id"] if game else None,
        "game_type": game["game_type"] if game else None,
        "opponent": game["opponent_abbreviation"] if game else None,
    }


# ----------------------------------------------------------------- queries


@dataclass
class QueryLog:
    statements: list[str] = field(default_factory=list)
    rows: list[int] = field(default_factory=list)  # result rows per statement


@contextmanager
def recorded_queries(engine: Engine) -> Iterator[QueryLog]:
    """Every SQL statement sent to the database inside the block, and the
    number of rows each one returned (the cursor's row count)."""
    log = QueryLog()

    def _before(
        conn: Any, cursor: Any, statement: str, parameters: Any, context: Any, executemany: bool
    ) -> None:
        log.statements.append(statement)

    def _after(
        conn: Any, cursor: Any, statement: str, parameters: Any, context: Any, executemany: bool
    ) -> None:
        log.rows.append(max(cursor.rowcount, 0))

    event.listen(engine, "before_cursor_execute", _before)
    event.listen(engine, "after_cursor_execute", _after)
    try:
        yield log
    finally:
        event.remove(engine, "before_cursor_execute", _before)
        event.remove(engine, "after_cursor_execute", _after)
