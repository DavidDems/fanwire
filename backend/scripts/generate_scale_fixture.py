"""Builds a deterministic synthetic NBA history at full-load scale
(EVENTS-010), for measuring the records routes (and any events read) when
the real dataset (scripts/load_nba_history.py) is not on the machine.

A dev tool: never run in CI or in production. Synthetic data proves the
queries' cost at scale, not their correctness on the real data.

What it writes (`--seasons N`, default 23; `--games-per-team G`, default
82; at the defaults about 30,300 games and 800,000 box-score rows):

- 30 teams: the league's franchises as app.events.nba_history knows them
  (names, abbreviations, conferences, divisions), under synthetic ids;
- N seasons labelled from 2003-04 on, each with:
  - `regular` games, each team playing exactly G (a round-robin rotation,
    one game per team per round);
  - six `play-in` games, three per conference;
  - from 2023-24 on, one `cup-final` game labelled "Emirates NBA Cup";
  - `playoffs`: 16 teams (the top eight by wins in each conference) in
    best-of-seven series, the last labelled "NBA Finals" exactly as
    GET /events/seasons/{season}/champion expects, so every season has a
    champion;
- box scores: about 13 lines per team per game (26-27 per game), of which
  about 20 % are did-not-play rows (seconds_played null, the reason, zeros);
  the team's score is split among its played lines, so points are mostly
  0-30 with a rare 50+, and a few all-round players make the occasional
  triple-double;
- about 2,800 players: rosters of 14 per team, about a quarter replaced
  each season.

Ids. Every row is keyed by a synthetic nba.com-style id that no real
nba.com id uses, and that is clear of scripts/seed_perf.py's reserved
9_000_000_000-9_199_999_999:
    nba_team_id   = 9_200_000_000 + n
    nba_person_id = 9_200_000_000 + n
    nba_game_id   = 9_200_000_000 + n

Fixed seed: two runs with the same arguments write the same rows.
Idempotent: if any game is already stored in the generator's id range, it
writes nothing and exits 0. Everything is one transaction, written with
Postgres COPY (games, players, box scores), so the full default scale
takes minutes, not hours.

Fail-closed: refuses (exit 1, nothing written) unless `ENVIRONMENT` is
exactly "development" or "perf", and when any stored game has an
nba_game_id below 9_000_000_000 (a real load: synthetic games must never be
mixed into real data).

It prints a short report: games, box-score rows, rows per game, the
did-not-play share, triple-doubles, 50-point games and the tables' sizes.

Usage (cwd backend/, DATABASE_URL pointing at a migrated database):
    python scripts/generate_scale_fixture.py [--seasons 23] [--games-per-team 82]
"""

from __future__ import annotations

import sys
from pathlib import Path

# scripts/ has no __init__.py: put backend/ on sys.path, as seed_perf.py does.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import argparse
import math
import os
import random
import time
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import Connection, text

from app.db import make_engine
from app.events.nba_history import _TEAMS

ALLOWED_ENVIRONMENTS = ("development", "perf")

ID_BASE = 9_200_000_000
REAL_BELOW = 9_000_000_000
SEED = 20031028
FIRST_SEASON_START = 2003
CUP_FROM_START = 2023

ROSTER = 14
ROSTER_TURNOVER = 0.25
DNP_REASON = "DNP - Coach's Decision"
FINALS_LABEL = "NBA Finals"
CUP_LABEL = "Emirates NBA Cup"
PLAY_IN_LABEL = "Play-In Tournament"
ROUNDS = ("First Round", "Conference Semifinals", "Conference Finals")

_FIRST_NAMES = (
    "James", "Marcus", "Andre", "Tyrese", "Devin", "Jalen", "Chris", "Kevin", "Luka", "Nikola",
    "Jayson", "Anthony", "Damian", "Stephen", "Paul", "Kyle", "Derrick", "Trae", "Zach", "Bam",
    "Darius", "Jaren", "Mikal", "Malik", "Isaiah", "Cade", "Evan", "Scottie", "Franz", "Victor",
)  # fmt: skip
_LAST_NAMES = (
    "Allen", "Brooks", "Carter", "Daniels", "Edwards", "Fox", "Green", "Harris", "Irving",
    "Johnson", "King", "Lopez", "Mitchell", "Nance", "Owens", "Parker", "Quinn", "Reed", "Smith",
    "Turner", "Udoka", "Vaughn", "Walker", "Young", "Zeller", "Bridges", "Murray", "Holiday",
    "Porter", "Williams", "Jackson", "Thompson", "Robinson", "Bennett", "Hayes", "Morris",
)  # fmt: skip

_GAME_COLUMNS = (
    "nba_game_id",
    "home_team_id",
    "away_team_id",
    "date",
    "season",
    "home_score",
    "away_score",
    "game_type",
    "label",
    "sub_label",
    "series_game_number",
)
_PLAYER_COLUMNS = ("nba_person_id", "first_name", "last_name", "first_season", "last_season")
_BOX_COLUMNS = (
    "game_id",
    "player_id",
    "team_id",
    "starter",
    "starting_position",
    "seconds_played",
    "dnp_reason",
    "field_goals_made",
    "field_goals_attempted",
    "three_pointers_made",
    "three_pointers_attempted",
    "free_throws_made",
    "free_throws_attempted",
    "offensive_rebounds",
    "defensive_rebounds",
    "rebounds",
    "assists",
    "steals",
    "blocks",
    "turnovers",
    "personal_fouls",
    "points",
    "plus_minus",
)
_STARTING_POSITIONS = ("G", "G", "F", "F", "C")


# ------------------------------------------------------------------ model


@dataclass
class PlayerProfile:
    """A synthetic player's per-36-minute tendencies."""

    number: int  # n of nba_person_id = ID_BASE + n
    usage: float  # share weight of the team's points
    minutes: float  # minutes weight
    rebounds: float
    assists: float
    steals: float
    blocks: float
    three_rate: float
    first_season: str
    last_season: str = ""


@dataclass
class TeamState:
    number: int  # n of nba_team_id
    conference: str
    strength: float = 0.0
    roster: list[PlayerProfile] = field(default_factory=list)


@dataclass(frozen=True)
class PlannedGame:
    number: int  # n of nba_game_id
    home: int  # team number
    away: int
    when: datetime
    season: str
    home_score: int
    away_score: int
    game_type: str
    label: str | None
    sub_label: str | None
    series_game_number: int | None


@dataclass
class Report:
    games: int = 0
    rows: int = 0
    dnp_rows: int = 0
    triple_doubles: int = 0
    fifty_point_games: int = 0


def season_label(start_year: int) -> str:
    return f"{start_year}-{str(start_year + 1)[-2:]}"


def _poisson(rng: random.Random, mean: float) -> int:
    """Knuth's method for small means, a rounded normal for large ones."""
    if mean <= 0:
        return 0
    if mean > 30:
        return max(0, round(rng.gauss(mean, math.sqrt(mean))))
    limit, k, product = math.exp(-mean), 0, rng.random()
    while product > limit:
        k += 1
        product *= rng.random()
    return k


class Generator:
    """Plans the seasons with one seeded random stream, so the same
    arguments always give the same rows."""

    def __init__(self, seasons: int, games_per_team: int) -> None:
        self.rng = random.Random(SEED)
        self.seasons = seasons
        self.games_per_team = games_per_team
        self.teams = [
            TeamState(number=n, conference=team.conference)
            for n, team in enumerate(_TEAMS.values(), start=1)
        ]
        self.players: list[PlayerProfile] = []
        # season -> team number -> that season's roster
        self.rosters: dict[str, dict[int, list[PlayerProfile]]] = {}
        self.next_game = 0

    # -- people

    def _new_player(self, season: str, slot: int) -> PlayerProfile:
        rng = self.rng
        # Slots 0-1 are a team's stars, 2-4 starters, the rest the bench.
        tier = 0 if slot < 2 else 1 if slot < 5 else 2
        usage = (2.2, 1.6, 0.9)[tier] * rng.uniform(0.75, 1.2)
        all_round = tier == 0 and rng.random() < 0.06
        player = PlayerProfile(
            number=len(self.players) + 1,
            usage=usage,
            minutes=(34.0, 28.0, 14.0)[tier] * rng.uniform(0.85, 1.15),
            rebounds=rng.uniform(8.5, 11.0) if all_round else rng.uniform(2.5, 10.0),
            assists=rng.uniform(7.5, 10.0) if all_round else rng.uniform(1.0, 7.0),
            steals=rng.uniform(0.5, 1.8),
            blocks=rng.uniform(0.1, 2.2),
            three_rate=rng.uniform(0.1, 0.45),
            first_season=season,
        )
        self.players.append(player)
        return player

    def _rosters(self, season: str, first: bool) -> None:
        for team in self.teams:
            # Team strength drifts from season to season.
            team.strength = 0.6 * team.strength + self.rng.gauss(0.0, 1.0)
            if first:
                team.roster = [self._new_player(season, slot) for slot in range(ROSTER)]
                continue
            for slot in range(ROSTER):
                if self.rng.random() < ROSTER_TURNOVER:
                    team.roster[slot].last_season = season_label(int(season[:4]) - 1)
                    team.roster[slot] = self._new_player(season, slot)

    # -- games

    def _score(self, home: TeamState, away: TeamState) -> tuple[int, int]:
        rng = self.rng
        edge = 3.0 + 4.0 * (home.strength - away.strength)
        home_score = max(70, round(rng.gauss(109 + edge / 2, 11)))
        away_score = max(70, round(rng.gauss(109 - edge / 2, 11)))
        while home_score == away_score:  # overtime
            home_score += rng.randint(5, 14)
            away_score += rng.randint(5, 14)
        return home_score, away_score

    def _game(
        self,
        season: str,
        when: datetime,
        home: TeamState,
        away: TeamState,
        game_type: str,
        label: str | None = None,
        sub_label: str | None = None,
        series_game_number: int | None = None,
    ) -> PlannedGame:
        self.next_game += 1
        home_score, away_score = self._score(home, away)
        return PlannedGame(
            number=self.next_game,
            home=home.number,
            away=away.number,
            when=when,
            season=season,
            home_score=home_score,
            away_score=away_score,
            game_type=game_type,
            label=label,
            sub_label=sub_label,
            series_game_number=series_game_number,
        )

    def _regular(self, season: str, start: datetime) -> list[PlannedGame]:
        """A round-robin rotation (the circle method): each round pairs all
        30 teams, so G rounds give every team exactly G games."""
        teams = self.teams
        count = len(teams)
        games = []
        spacing = timedelta(hours=max(24, 165 * 24 // max(self.games_per_team, 1)))
        for round_ in range(self.games_per_team):
            rotation = round_ % (count - 1)
            order = [0, *(1 + (i + rotation) % (count - 1) for i in range(count - 1))]
            flip = (round_ // (count - 1)) % 2 == 1
            for i in range(count // 2):
                a, b = teams[order[i]], teams[order[count - 1 - i]]
                home, away = (a, b) if (i + round_ + flip) % 2 == 0 else (b, a)
                when = start + spacing * round_ + timedelta(minutes=10 * i)
                games.append(self._game(season, when, home, away, "regular"))
        return games

    def _series(
        self,
        season: str,
        start: datetime,
        high: TeamState,
        low: TeamState,
        label: str,
        sub_label: str | None,
    ) -> tuple[list[PlannedGame], TeamState]:
        """Best of seven; the higher seed hosts games 1, 2, 5 and 7."""
        games: list[PlannedGame] = []
        wins = {high.number: 0, low.number: 0}
        while max(wins.values()) < 4:
            n = len(games)
            home, away = (high, low) if n in (0, 1, 4, 6) else (low, high)
            game = self._game(
                season,
                start + timedelta(days=2 * n),
                home,
                away,
                "playoffs",
                label,
                sub_label or f"Game {n + 1}",
                n + 1,
            )
            games.append(game)
            winner = game.home if game.home_score > game.away_score else game.away
            wins[winner] += 1
        return games, high if wins[high.number] == 4 else low

    def _postseason(
        self, season: str, start: datetime, regular: Sequence[PlannedGame]
    ) -> list[PlannedGame]:
        wins = dict.fromkeys((team.number for team in self.teams), 0)
        for game in regular:
            wins[game.home if game.home_score > game.away_score else game.away] += 1
        games: list[PlannedGame] = []
        champions: list[TeamState] = []
        for c, conference in enumerate(sorted({team.conference for team in self.teams})):
            short = "East" if conference.startswith("East") else "West"
            seeded = sorted(
                (team for team in self.teams if team.conference == conference),
                key=lambda team: (-wins[team.number], team.number),
            )
            # Play-in: 7 v 8, 9 v 10, then the loser of the first v the winner
            # of the second. The seedings stay as they are (a simplification).
            day = start + timedelta(hours=c)
            for home, away in ((seeded[6], seeded[7]), (seeded[8], seeded[9])):
                games.append(self._game(season, day, home, away, "play-in", PLAY_IN_LABEL))
            games.append(
                self._game(
                    season, day + timedelta(days=2), seeded[7], seeded[8], "play-in", PLAY_IN_LABEL
                )
            )
            bracket = seeded[:8]
            day = start + timedelta(days=4, hours=c)
            for round_name in ROUNDS:
                pairs = [
                    (bracket[i], bracket[len(bracket) - 1 - i]) for i in range(len(bracket) // 2)
                ]
                winners = []
                for high, low in pairs:
                    series, winner = self._series(
                        season, day, high, low, f"{short} - {round_name}", None
                    )
                    games.extend(series)
                    winners.append(winner)
                bracket = winners
                day += timedelta(days=16)
            champions.append(bracket[0])
        east, west = champions
        high, low = (east, west) if wins[east.number] >= wins[west.number] else (west, east)
        finals, _ = self._series(season, start + timedelta(days=54), high, low, FINALS_LABEL, None)
        games.extend(finals)
        return games

    def season(self, index: int) -> tuple[str, list[PlannedGame]]:
        start_year = FIRST_SEASON_START + index
        season = season_label(start_year)
        self._rosters(season, first=index == 0)
        self.rosters[season] = {team.number: list(team.roster) for team in self.teams}
        start = datetime(start_year, 10, 28, 19, 30)
        regular = self._regular(season, start)
        games = list(regular)
        if start_year >= CUP_FROM_START:
            cup = self.teams[self.rng.randrange(15)], self.teams[15 + self.rng.randrange(15)]
            games.append(
                self._game(
                    season, datetime(start_year, 12, 16, 20, 30), *cup, "cup-final", CUP_LABEL
                )
            )
        games.extend(self._postseason(season, datetime(start_year + 1, 4, 15, 19, 0), regular))
        return season, games

    # -- box scores

    def box_score(
        self, game: PlannedGame, team: TeamState, score: int, margin: int, report: Report
    ) -> list[tuple[Any, ...]]:
        """One team's lines, without the game's and the players' row ids
        (the caller fills them): about 13 lines, about 20 % did-not-play.
        The played lines' points add up to the team's score."""
        rng = self.rng
        dressed = 13 + (rng.random() < 0.3)
        played_count = min(dressed, max(8, round(rng.gauss(10.6, 0.8))))
        # The rotation: mostly the top of the roster, sometimes a shuffle.
        order = sorted(
            range(ROSTER), key=lambda slot: team.roster[slot].minutes * rng.uniform(0.6, 1.4)
        )[::-1]
        played = [team.roster[slot] for slot in order[:played_count]]
        benched = [team.roster[slot] for slot in order[played_count:dressed]]

        minute_weights = [p.minutes * rng.uniform(0.75, 1.25) for p in played]
        overtime = max(0, (max(game.home_score, game.away_score) - 125) // 12)
        total_seconds = (48 + 5 * overtime) * 5 * 60
        weight_sum = sum(minute_weights)
        seconds = [max(60, round(total_seconds * w / weight_sum)) for w in minute_weights]

        shares = [
            p.usage * s * rng.gammavariate(9.0, 1 / 9.0)
            for p, s in zip(played, seconds, strict=True)
        ]
        share_sum = sum(shares)
        exact = [score * s / share_sum for s in shares]
        points = [math.floor(x) for x in exact]
        by_fraction = sorted(range(len(exact)), key=lambda i: exact[i] - points[i], reverse=True)
        for i in by_fraction[: score - sum(points)]:
            points[i] += 1

        rows: list[tuple[Any, ...]] = []
        for i, (player, secs, pts) in enumerate(zip(played, seconds, points, strict=True)):
            per36 = secs / 2160
            free_throws = min(pts, _poisson(rng, 0.18 * pts))
            rest = pts - free_throws
            threes = sum(rng.random() < player.three_rate for _ in range(rest // 3))
            left = rest - 3 * threes
            if left % 2:
                free_throws += 1
                left -= 1
            twos = left // 2
            made = twos + threes
            three_attempts = threes + _poisson(rng, 1.7 * threes + 1.0 * per36)
            attempts = made + _poisson(rng, 1.1 * made + 0.5) + (three_attempts - threes)
            free_throw_attempts = free_throws + _poisson(rng, 0.25 * free_throws)
            rebounds = _poisson(rng, player.rebounds * per36)
            offensive = sum(rng.random() < 0.25 for _ in range(rebounds))
            assists = _poisson(rng, player.assists * per36)
            steals = _poisson(rng, player.steals * per36)
            blocks = _poisson(rng, player.blocks * per36)
            line = (
                i < 5,
                _STARTING_POSITIONS[i] if i < 5 else None,
                secs,
                None,
                made,
                attempts,
                threes,
                three_attempts,
                free_throws,
                free_throw_attempts,
                offensive,
                rebounds - offensive,
                rebounds,
                assists,
                steals,
                blocks,
                _poisson(rng, 1.6 * per36),
                min(6, _poisson(rng, 2.4 * per36)),
                pts,
                round(margin * secs / (48 * 60) + rng.gauss(0, 5)),
            )
            rows.append((player.number, team.number, *line))
            if pts >= 50:
                report.fifty_point_games += 1
            if sum(v >= 10 for v in (pts, rebounds, assists, steals, blocks)) >= 3:
                report.triple_doubles += 1
        for player in benched:
            rows.append((player.number, team.number, False, None, None, DNP_REASON, *([0] * 16)))
            report.dnp_rows += 1
        report.rows += len(rows)
        return rows


# ---------------------------------------------------------------- writing


def _copy(
    conn: Connection, table: str, columns: Sequence[str], rows: Iterable[Sequence[Any]]
) -> None:
    """COPY rows into `table` on the run's own connection (and so inside its
    transaction). Table and column names are this module's constants."""
    driver = conn.connection.driver_connection
    assert driver is not None
    with (
        driver.cursor() as cursor,
        cursor.copy(f"COPY {table} ({', '.join(columns)}) FROM STDIN") as copy,
    ):
        for row in rows:
            copy.write_row(row)


def _ids(conn: Connection, table: str, key: str) -> dict[int, int]:
    """The generator's rows of `table`: key - ID_BASE -> id."""
    rows = conn.execute(
        text(f"SELECT {key} - :base, id FROM {table} WHERE {key} > :base"), {"base": ID_BASE}
    )
    return {int(n): int(row_id) for n, row_id in rows}


def generate(conn: Connection, seasons: int, games_per_team: int) -> Report:
    gen = Generator(seasons, games_per_team)
    report = Report()
    _copy(
        conn,
        "teams",
        ("nba_team_id", "name", "abbreviation", "conference", "division"),
        (
            (ID_BASE + n, team.name, team.abbreviation, team.conference, team.division)
            for n, team in enumerate(_TEAMS.values(), start=1)
        ),
    )
    team_ids = _ids(conn, "teams", "nba_team_id")

    planned = [gen.season(index) for index in range(seasons)]
    # The players exist once every roster is known; names are fixed by number.
    _copy(
        conn,
        "players",
        _PLAYER_COLUMNS,
        (
            (
                ID_BASE + p.number,
                _FIRST_NAMES[p.number % len(_FIRST_NAMES)],
                f"{_LAST_NAMES[(p.number // len(_FIRST_NAMES)) % len(_LAST_NAMES)]} {p.number}",
                p.first_season,
                p.last_season or None,
            )
            for p in gen.players
        ),
    )
    player_ids = _ids(conn, "players", "nba_person_id")

    for _, games in planned:
        _copy(
            conn,
            "games",
            _GAME_COLUMNS,
            (
                (
                    ID_BASE + g.number,
                    team_ids[g.home],
                    team_ids[g.away],
                    g.when,
                    g.season,
                    g.home_score,
                    g.away_score,
                    g.game_type,
                    g.label,
                    g.sub_label,
                    g.series_game_number,
                )
                for g in games
            ),
        )
        report.games += len(games)
    game_ids = _ids(conn, "games", "nba_game_id")

    # Box scores are planned season by season, after every game, from a
    # second seeded stream, so the season plans above don't depend on them.
    gen.rng = random.Random(SEED + 1)
    teams = {team.number: team for team in gen.teams}
    for season, games in planned:
        rows: list[tuple[Any, ...]] = []
        for team in gen.teams:
            team.roster = gen.rosters[season][team.number]
        for g in games:
            margin = g.home_score - g.away_score
            for team_number, score, sign in ((g.home, g.home_score, 1), (g.away, g.away_score, -1)):
                for player_number, line_team, *line in gen.box_score(
                    g, teams[team_number], score, sign * margin, report
                ):
                    rows.append(
                        (game_ids[g.number], player_ids[player_number], team_ids[line_team], *line)
                    )
        _copy(conn, "player_game_stats", _BOX_COLUMNS, rows)
    return report


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--seasons", type=int, default=23)
    parser.add_argument("--games-per-team", type=int, default=82)
    args = parser.parse_args(argv)
    if not 1 <= args.seasons <= 99 or not 4 <= args.games_per_team <= 200:
        parser.error("--seasons must be 1-99 and --games-per-team 4-200")

    environment = os.environ.get("ENVIRONMENT")
    if environment not in ALLOWED_ENVIRONMENTS:
        print(
            f"refusing to run: ENVIRONMENT={environment!r}, but this script only ever runs in"
            f" one of {ALLOWED_ENVIRONMENTS!r} -- it writes synthetic games that must never"
            " reach a real database",
            file=sys.stderr,
        )
        return 1

    engine = make_engine(os.environ["DATABASE_URL"])
    try:
        with engine.begin() as conn:
            lowest = conn.execute(text("SELECT min(nba_game_id) FROM games")).scalar()
            if lowest is not None and lowest < REAL_BELOW:
                print(
                    f"refusing to run: a stored game has nba_game_id {lowest}, below"
                    f" {REAL_BELOW:,} -- this database holds a real load, and synthetic games"
                    " must never be mixed into it",
                    file=sys.stderr,
                )
                return 1
            if conn.execute(
                text("SELECT 1 FROM games WHERE nba_game_id > :base LIMIT 1"), {"base": ID_BASE}
            ).first():
                print("already generated (games in the generator's id range exist); nothing to do")
                return 0

            started = time.monotonic()
            report = generate(conn, args.seasons, args.games_per_team)
            elapsed = time.monotonic() - started
            sizes = conn.execute(
                text("SELECT pg_relation_size('player_game_stats'), pg_relation_size('games')")
            ).one()
    finally:
        engine.dispose()

    played = report.rows - report.dnp_rows
    print(
        f"generated {args.seasons} seasons x {args.games_per_team} games per team in {elapsed:.1f}s"
    )
    print(f"  games:              {report.games:,}")
    print(
        f"  box-score rows:     {report.rows:,} ({report.rows / max(report.games, 1):.1f} per game)"
    )
    print(f"  did-not-play share: {report.dnp_rows / max(report.rows, 1):.1%}")
    print(f"  played rows:        {played:,}")
    print(f"  triple-doubles:     {report.triple_doubles:,}")
    print(f"  50-point games:     {report.fifty_point_games:,}")
    print(f"  pg_relation_size:   player_game_stats {sizes[0]:,} B, games {sizes[1]:,} B")
    return 0


if __name__ == "__main__":
    sys.exit(main())
