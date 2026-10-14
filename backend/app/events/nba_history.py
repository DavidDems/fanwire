"""Load NBA games, players and box scores from the Eoin Moore Kaggle dataset
("NBA Dataset: Box Scores and Stats", CC0): Games.csv, PlayerStatistics.csv,
TeamStatistics.csv and Players.csv, into Team, Game, Player and
PlayerGameStats.

This is the "existing database of NBA game results" the events module
imports (wiki/CodeContext/Modules/0x02-events.md). The dataset's ids are
nba.com's, so rows are keyed by `nba_team_id`/`nba_game_id`/`nba_person_id`.
It replaces EVENTS-001's loader for the older "NBA games" dataset; the rules
are the same.

Rules, and why:

- **One transaction per run.** Every file is read and validated before the
  first write, and the run commits once at the end; any exception rolls the
  whole run back. A failed run leaves the database exactly as it was.
- **Fail fast on an unknown id.** A stored game, or a box-score row of one,
  that names a team outside the league's 30 raises
  app.events.errors.UnrecognizedTeamError; a box-score row naming a player
  absent from Players.csv raises UnrecognizedPlayerError. Neither is ever
  invented from a game row.
- **2003-04 onward, real finished games only.** The game id's first digit is
  the game type and decides it (the gameType column's spellings vary):
  preseason and All-Star games are skipped and counted; regular season
  (NBA Cup group and knockout games included), the NBA Cup final, play-in
  and playoffs are stored. A game without a final score (blank, or 0-0) is
  skipped, counted and named, never stored with an invented score.
- **Box scores as the source has them; what it lacks is reported.** A
  stored game with no box-score rows is stored with an empty box score and
  named; a team whose players' points do not add up to its score is named,
  not corrected. A row with a blank team gets it from its home flag. A row
  with blank minutes is a player who did not play: no minutes, and the
  source's comment as the reason.
- **Minutes are stored as seconds.** numMinutes is decimal minutes in most
  of the dataset but minutes.seconds ("27.04" = 27:04) in most of 2024-25
  and 2025-26 (the human's decision, 2026-10-13). A team's rows in a game are
  read as minutes.seconds when, read that way, they add up to the team's
  minutes in TeamStatistics.csv and read as decimals they don't. Otherwise
  they are read as decimals, and a team-game that fits neither is named.
- **Re-runnable, and existing rows keep their ids.** Teams and players
  already stored (matched by nba.com id) are left as they are; posts'
  mentions and users' preferred teams point at those ids. A stored game is
  never deleted: one stored by EVENTS-001 is "updated" (its new fields set,
  its box score added), and one that already has everything is "already
  present". A stored game whose teams or score disagree with the dataset is
  a DatasetError: a stored result is never changed silently.
- **Sized for the real dataset** (~31k games and ~745k box-score rows from
  2003-04): each file is read once, box-score rows are kept only for games
  this run stores, existing-row lookups are batched, and box-score rows are
  streamed with COPY, not inserted as one ORM object each.
"""

from __future__ import annotations

import csv
import re
from collections.abc import Collection, Iterable, Iterator
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.events.errors import UnrecognizedPlayerError, UnrecognizedTeamError
from app.events.models import Game, Player, PlayerGameStats, Team

_BATCH_SIZE = 5000

_FIRST_SEASON_START = 2003

_GAMES_FILE = "Games.csv"
_BOX_FILE = "PlayerStatistics.csv"
_TEAM_STATS_FILE = "TeamStatistics.csv"
_PLAYERS_FILE = "Players.csv"
_ALL_FILES = (_GAMES_FILE, _BOX_FILE, _TEAM_STATS_FILE, _PLAYERS_FILE)


@dataclass(frozen=True)
class _TeamRow:
    nba_team_id: int
    name: str
    abbreviation: str
    conference: str
    division: str


# League reference data, not invented data: the dataset's four files carry no
# abbreviation, conference or division, and Team requires all three. The 30
# franchises as they are today, keyed by nba.com team id; every 2003-04+ game
# is between two of them. A team missing here is an UnrecognizedTeamError.
_TEAMS: dict[int, _TeamRow] = {
    t.nba_team_id: t
    for t in (
        _TeamRow(1610612738, "Boston Celtics", "BOS", "Eastern", "Atlantic"),
        _TeamRow(1610612751, "Brooklyn Nets", "BKN", "Eastern", "Atlantic"),
        _TeamRow(1610612752, "New York Knicks", "NYK", "Eastern", "Atlantic"),
        _TeamRow(1610612755, "Philadelphia 76ers", "PHI", "Eastern", "Atlantic"),
        _TeamRow(1610612761, "Toronto Raptors", "TOR", "Eastern", "Atlantic"),
        _TeamRow(1610612741, "Chicago Bulls", "CHI", "Eastern", "Central"),
        _TeamRow(1610612739, "Cleveland Cavaliers", "CLE", "Eastern", "Central"),
        _TeamRow(1610612765, "Detroit Pistons", "DET", "Eastern", "Central"),
        _TeamRow(1610612754, "Indiana Pacers", "IND", "Eastern", "Central"),
        _TeamRow(1610612749, "Milwaukee Bucks", "MIL", "Eastern", "Central"),
        _TeamRow(1610612737, "Atlanta Hawks", "ATL", "Eastern", "Southeast"),
        _TeamRow(1610612766, "Charlotte Hornets", "CHA", "Eastern", "Southeast"),
        _TeamRow(1610612748, "Miami Heat", "MIA", "Eastern", "Southeast"),
        _TeamRow(1610612753, "Orlando Magic", "ORL", "Eastern", "Southeast"),
        _TeamRow(1610612764, "Washington Wizards", "WAS", "Eastern", "Southeast"),
        _TeamRow(1610612743, "Denver Nuggets", "DEN", "Western", "Northwest"),
        _TeamRow(1610612750, "Minnesota Timberwolves", "MIN", "Western", "Northwest"),
        _TeamRow(1610612760, "Oklahoma City Thunder", "OKC", "Western", "Northwest"),
        _TeamRow(1610612757, "Portland Trail Blazers", "POR", "Western", "Northwest"),
        _TeamRow(1610612762, "Utah Jazz", "UTA", "Western", "Northwest"),
        _TeamRow(1610612744, "Golden State Warriors", "GSW", "Western", "Pacific"),
        _TeamRow(1610612746, "Los Angeles Clippers", "LAC", "Western", "Pacific"),
        _TeamRow(1610612747, "Los Angeles Lakers", "LAL", "Western", "Pacific"),
        _TeamRow(1610612756, "Phoenix Suns", "PHX", "Western", "Pacific"),
        _TeamRow(1610612758, "Sacramento Kings", "SAC", "Western", "Pacific"),
        _TeamRow(1610612742, "Dallas Mavericks", "DAL", "Western", "Southwest"),
        _TeamRow(1610612745, "Houston Rockets", "HOU", "Western", "Southwest"),
        _TeamRow(1610612763, "Memphis Grizzlies", "MEM", "Western", "Southwest"),
        _TeamRow(1610612740, "New Orleans Pelicans", "NOP", "Western", "Southwest"),
        _TeamRow(1610612759, "San Antonio Spurs", "SAS", "Western", "Southwest"),
    )
}

# The game id's first digit. Preseason and All-Star are skipped and counted.
_PRESEASON = "1"
_ALL_STAR = "3"
_STORED_GAME_TYPES = {"2": "regular", "4": "playoffs", "5": "play-in", "6": "cup-final"}

_SEASON_PATTERN = re.compile(r"^\d{4}-\d{2}$")

_GAMES_COLUMNS = (
    "gameId",
    "gameDateTimeEst",
    "hometeamId",
    "awayteamId",
    "homeScore",
    "awayScore",
    "gameLabel",
    "gameSubLabel",
    "seriesGameNumber",
    "arenaName",
)
_TEAM_STATS_COLUMNS = (
    "gameId",
    "teamId",
    "numMinutes",
    "q1Points",
    "q2Points",
    "q3Points",
    "q4Points",
    "ot1Points",
    "ot2Points",
    "otAllPoints",
)
# PlayerGameStats column -> PlayerStatistics.csv column.
_STAT_COLUMNS = (
    ("field_goals_made", "fieldGoalsMade"),
    ("field_goals_attempted", "fieldGoalsAttempted"),
    ("three_pointers_made", "threePointersMade"),
    ("three_pointers_attempted", "threePointersAttempted"),
    ("free_throws_made", "freeThrowsMade"),
    ("free_throws_attempted", "freeThrowsAttempted"),
    ("offensive_rebounds", "reboundsOffensive"),
    ("defensive_rebounds", "reboundsDefensive"),
    ("rebounds", "reboundsTotal"),
    ("assists", "assists"),
    ("steals", "steals"),
    ("blocks", "blocks"),
    ("turnovers", "turnovers"),
    ("personal_fouls", "foulsPersonal"),
    ("points", "points"),
    ("plus_minus", "plusMinusPoints"),
)
_POINTS = [model for model, _ in _STAT_COLUMNS].index("points")
_BOX_COLUMNS = (
    "gameId",
    "personId",
    "playerteamId",
    "home",
    "numMinutes",
    "comment",
    "startingPosition",
    *(source for _, source in _STAT_COLUMNS),
)
_PLAYERS_COLUMNS = (
    "personId",
    "firstName",
    "lastName",
    "birthDate",
    "school",
    "country",
    "heightInches",
    "bodyWeightLbs",
    "jersey",
    "guard",
    "forward",
    "center",
    "draftYear",
    "draftRound",
    "draftNumber",
    "fromYear",
    "toYear",
)

# A team's minutes may miss its expected total by this much and still fit:
# the source rounds each row to the second, or truncates it to the minute.
_MINUTES_TOLERANCE = 1.0


class DatasetError(ValueError):
    """The dataset (or the requested season list) is not what the loader
    can store faithfully: a missing file or column, a malformed value, an
    unknown game type, duplicate rows that disagree, or a stored game the
    dataset contradicts. Raised before anything is written, or rolled back."""


# --------------------------------------------------------------------- reports


@dataclass(frozen=True)
class PointsMismatch:
    """A team whose players' points do not add up to its final score."""

    nba_game_id: int
    nba_team_id: int
    team_score: int
    players_points: int


@dataclass(frozen=True)
class SeasonReport:
    """What one run did with one season. The named games (no score, no box
    score, points or minutes that do not add up) are those this run wrote or
    skipped; a game already present is not named again."""

    season: str
    games_loaded: int
    games_updated: int
    games_already_present: int
    skipped_preseason: int
    skipped_all_star: int
    skipped_no_score: tuple[int, ...]
    box_score_rows_loaded: int
    box_score_rows_already_present: int
    box_score_rows_skipped: int
    duplicate_game_rows: int
    duplicate_box_score_rows: int
    missing_box_scores: tuple[int, ...]
    points_mismatches: tuple[PointsMismatch, ...]
    unclear_minutes: tuple[tuple[int, int], ...]

    def line(self) -> str:
        parts = [
            (
                f"{self.season}: games loaded {self.games_loaded}, "
                f"updated {self.games_updated}, already present {self.games_already_present}; "
                f"skipped {self.skipped_preseason} preseason / {self.skipped_all_star} All-Star "
                f"/ {len(self.skipped_no_score)} no score; box score rows loaded "
                f"{self.box_score_rows_loaded}, already present "
                f"{self.box_score_rows_already_present}, skipped {self.box_score_rows_skipped}; "
                f"duplicate rows ignored: {self.duplicate_game_rows} game, "
                f"{self.duplicate_box_score_rows} box score"
            )
        ]
        if self.skipped_no_score:
            parts.append("no score: " + ", ".join(map(str, self.skipped_no_score)))
        if self.missing_box_scores:
            parts.append("no box score: " + ", ".join(map(str, self.missing_box_scores)))
        if self.points_mismatches:
            parts.append(
                "players' points not adding up: "
                + ", ".join(
                    f"{m.nba_game_id} team {m.nba_team_id} ({m.players_points} of {m.team_score})"
                    for m in self.points_mismatches
                )
            )
        if self.unclear_minutes:
            parts.append(
                "minutes fitting neither format, read as decimals: "
                + ", ".join(f"{game} team {team}" for game, team in self.unclear_minutes)
            )
        return "; ".join(parts)


@dataclass(frozen=True)
class LoadReport:
    teams_created: int
    players_created: int
    seasons: dict[str, SeasonReport]

    def lines(self) -> list[str]:
        """One human-readable line per season, oldest first."""
        return [season.line() for season in self.seasons.values()]


@dataclass
class _SeasonCounts:
    games_loaded: int = 0
    games_updated: int = 0
    games_already_present: int = 0
    skipped_preseason: int = 0
    skipped_all_star: int = 0
    skipped_no_score: list[int] = field(default_factory=list)
    box_score_rows_loaded: int = 0
    box_score_rows_already_present: int = 0
    box_score_rows_skipped: int = 0
    duplicate_game_rows: int = 0
    duplicate_box_score_rows: int = 0
    missing_box_scores: list[int] = field(default_factory=list)
    points_mismatches: list[PointsMismatch] = field(default_factory=list)
    unclear_minutes: list[tuple[int, int]] = field(default_factory=list)

    def freeze(self, season: str) -> SeasonReport:
        return SeasonReport(
            season=season,
            games_loaded=self.games_loaded,
            games_updated=self.games_updated,
            games_already_present=self.games_already_present,
            skipped_preseason=self.skipped_preseason,
            skipped_all_star=self.skipped_all_star,
            skipped_no_score=tuple(sorted(self.skipped_no_score)),
            box_score_rows_loaded=self.box_score_rows_loaded,
            box_score_rows_already_present=self.box_score_rows_already_present,
            box_score_rows_skipped=self.box_score_rows_skipped,
            duplicate_game_rows=self.duplicate_game_rows,
            duplicate_box_score_rows=self.duplicate_box_score_rows,
            missing_box_scores=tuple(sorted(self.missing_box_scores)),
            points_mismatches=tuple(
                sorted(self.points_mismatches, key=lambda m: (m.nba_game_id, m.nba_team_id))
            ),
            unclear_minutes=tuple(sorted(self.unclear_minutes)),
        )


# --------------------------------------------------------------------- parsed rows


@dataclass(frozen=True)
class _GameRow:
    """The Games.csv fields a Game stores (teams still nba.com ids)."""

    nba_game_id: int
    date: datetime
    season: str
    home_nba_team_id: int
    away_nba_team_id: int
    home_score: int | None
    away_score: int | None
    venue: str | None
    label: str | None
    sub_label: str | None
    series_game_number: int | None


@dataclass(slots=True)
class _BoxRow:
    nba_person_id: int
    nba_team_id: int
    starting_position: str | None
    minutes: str
    dnp_reason: str | None
    stats: tuple[int, ...]
    seconds_played: int | None = None


@dataclass
class _StoredGame:
    """A game this run stores (or finds already stored), with what the other
    files say about it, still keyed by nba.com ids."""

    row: _GameRow
    game_type: str
    home_score: int
    away_score: int
    line_scores: dict[int, list[int] | None] = field(default_factory=dict)
    team_minutes: dict[int, float | None] = field(default_factory=dict)
    box: list[_BoxRow] = field(default_factory=list)
    person_ids: set[int] = field(default_factory=set)
    unclear_minutes_teams: list[int] = field(default_factory=list)

    @property
    def season(self) -> str:
        return self.row.season

    def fields(self, team_ids: dict[int, int]) -> dict[str, Any]:
        """Every Game column this run sets, with Team.id foreign keys."""
        row = self.row
        return {
            "home_team_id": team_ids[row.home_nba_team_id],
            "away_team_id": team_ids[row.away_nba_team_id],
            "date": row.date,
            "season": row.season,
            "home_score": self.home_score,
            "away_score": self.away_score,
            "venue": row.venue,
            "game_type": self.game_type,
            "label": row.label,
            "sub_label": row.sub_label,
            "series_game_number": row.series_game_number,
            "home_line_score": self.line_scores.get(row.home_nba_team_id),
            "away_line_score": self.line_scores.get(row.away_nba_team_id),
        }


@dataclass(frozen=True)
class _PlayerRow:
    nba_person_id: int
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


# --------------------------------------------------------------------- entry point


def load_nba_history(
    session: Session, data_dir: str | Path, seasons: Collection[str] | None = None
) -> LoadReport:
    """Load the dataset's four CSVs from `data_dir`.

    `seasons` ("YYYY-YY", 2003-04 or later) limits which games are processed
    and reported; default: every season from 2003-04. Every team is stored
    regardless; a player only when a loaded box score names them. Commits
    once on success; on any exception rolls back the whole run and re-raises.
    """
    try:
        wanted = validate_seasons(seasons)
        data_dir = Path(data_dir)
        paths = {name: data_dir / name for name in _ALL_FILES}
        for name, path in paths.items():
            if not path.is_file():
                raise DatasetError(f"{name} not found in {data_dir}")

        counts: dict[str, _SeasonCounts] = {season: _SeasonCounts() for season in wanted or ()}
        stored = _read_games(paths[_GAMES_FILE], wanted, counts)
        _read_team_stats(paths[_TEAM_STATS_FILE], stored)
        _read_box_scores(paths[_BOX_FILE], stored, counts)
        players = _read_players(paths[_PLAYERS_FILE], stored)
        for game in stored.values():
            _resolve_minutes(game)

        team_ids, teams_created = _upsert_teams(session)
        player_ids, players_created = _upsert_players(session, players)
        _write_games(session, stored, team_ids, player_ids, counts)

        session.commit()
    except Exception:
        session.rollback()
        raise

    return LoadReport(
        teams_created=teams_created,
        players_created=players_created,
        seasons={season: counts[season].freeze(season) for season in sorted(counts)},
    )


# --------------------------------------------------------------------- values


def validate_seasons(seasons: Collection[str] | None) -> set[str] | None:
    """The requested seasons as a set (None for "every season"), or a
    DatasetError naming the first one that is not a "YYYY-YY" season from
    2003-04 on. Also the SportsDataLoad handler's check (app.events.load_handler)."""
    if seasons is None:
        return None
    for season in seasons:
        if not _SEASON_PATTERN.match(season):
            raise DatasetError(f"season {season!r} is not 'YYYY-YY' (e.g. '2019-20')")
        start, end = season.split("-")
        if (int(start) + 1) % 100 != int(end):
            raise DatasetError(f"season {season!r}: {end} does not follow {start}")
        if int(start) < _FIRST_SEASON_START:
            raise DatasetError(
                f"season {season!r} is before {_season_label(_FIRST_SEASON_START)}, "
                "the first season this loader loads"
            )
    return set(seasons)


def _season_label(start: int) -> str:
    """2019 -> "2019-20", 1999 -> "1999-00"."""
    return f"{start}-{(start + 1) % 100:02d}"


def _season_of(nba_game_id: int) -> int:
    """The season's start year, from digits 2-3 of the game id (nba.com's
    leading 0 is dropped): 22400001 -> 2024, 29900001 -> 1999."""
    text = str(nba_game_id)
    if len(text) != 8:
        raise DatasetError(f"game id {nba_game_id} is not an 8-digit nba.com game id")
    two_digits = int(text[1:3])
    return 1900 + two_digits if two_digits >= 46 else 2000 + two_digits


def _rows(path: Path, required: tuple[str, ...]) -> Iterator[dict[str, str]]:
    """Every row of a dataset CSV, after checking its header carries the
    columns the loader reads. A missing column is a DatasetError so the CLI
    reports it as a data problem, not a crash."""
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        missing = [column for column in required if column not in (reader.fieldnames or [])]
        if missing:
            raise DatasetError(f"{path.name} is missing column(s): {', '.join(missing)}")
        yield from reader


def _int(value: str, what: str) -> int:
    """A whole number, written either "130" or "130.0"."""
    try:
        number = float(value)
    except ValueError as exc:
        raise DatasetError(f"{what}: {value!r} is not a number") from exc
    if not number.is_integer():
        raise DatasetError(f"{what}: {value!r} is not a whole number")
    return int(number)


def _optional_int(value: str, what: str) -> int | None:
    return None if not value.strip() else _int(value, what)


def _optional_count(value: str, what: str) -> int | None:
    """A non-negative attribute. Players.csv marks "none" with negative
    numbers (-1 for an undrafted player's draft year, round and number), which
    is stored as null, like a blank."""
    number = _optional_int(value, what)
    return None if number is None or number < 0 else number


def _optional_text(value: str) -> str | None:
    return value.strip() or None


def _series_game_number(value: str, nba_game_id: int) -> int | None:
    """Written "5.0", "Game 5" or blank; 0 means no series."""
    text = value.strip().removeprefix("Game ")
    return _optional_int(text, f"game {nba_game_id} seriesGameNumber") or None


def _datetime(value: str, nba_game_id: int) -> datetime:
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(value.strip(), fmt)
        except ValueError:
            continue
    raise DatasetError(f"game {nba_game_id}: gameDateTimeEst {value!r} is not a date and time")


# --------------------------------------------------------------------- Games.csv


def _read_games(
    path: Path, wanted: set[str] | None, counts: dict[str, _SeasonCounts]
) -> dict[int, _StoredGame]:
    """The in-scope games this run stores, keyed by nba_game_id. Counts
    duplicates and every skip into `counts`, creating a season's entry the
    first time one of its games is seen."""
    first_rows: dict[int, _GameRow] = {}
    for raw in _rows(path, _GAMES_COLUMNS):
        nba_game_id = _int(raw["gameId"], f"{path.name} gameId")
        start = _season_of(nba_game_id)
        season = _season_label(start)
        if start < _FIRST_SEASON_START or (wanted is not None and season not in wanted):
            continue
        season_counts = counts.setdefault(season, _SeasonCounts())
        game = _parse_game(raw, nba_game_id, season)

        first = first_rows.get(nba_game_id)
        if first is None:
            first_rows[nba_game_id] = game
            continue
        # A repeat that disagrees on what is stored is not a duplicate but a
        # contradiction, and picking one would be a guess.
        if first != game:
            raise DatasetError(
                f"{path.name} has conflicting rows for game {nba_game_id}: {first} vs {game}"
            )
        season_counts.duplicate_game_rows += 1

    stored: dict[int, _StoredGame] = {}
    for game in first_rows.values():
        season_counts = counts[game.season]
        prefix = str(game.nba_game_id)[0]
        if prefix == _PRESEASON:
            season_counts.skipped_preseason += 1
            continue
        if prefix == _ALL_STAR:
            season_counts.skipped_all_star += 1
            continue
        game_type = _STORED_GAME_TYPES.get(prefix)
        if game_type is None:
            raise DatasetError(f"game {game.nba_game_id}: unknown game id type prefix {prefix!r}")
        if game.home_score is None or game.away_score is None:
            season_counts.skipped_no_score.append(game.nba_game_id)
            continue
        if game.home_score == 0 and game.away_score == 0:
            # Two 2024-25 games are written 0-0, with no box score and a
            # winner their quarter points contradict: no final score.
            season_counts.skipped_no_score.append(game.nba_game_id)
            continue
        for nba_team_id in (game.home_nba_team_id, game.away_nba_team_id):
            _require_team(nba_team_id, f"game {game.nba_game_id}")
        stored[game.nba_game_id] = _StoredGame(
            row=game, game_type=game_type, home_score=game.home_score, away_score=game.away_score
        )
    return stored


def _parse_game(raw: dict[str, str], nba_game_id: int, season: str) -> _GameRow:
    what = f"game {nba_game_id}"
    return _GameRow(
        nba_game_id=nba_game_id,
        date=_datetime(raw["gameDateTimeEst"], nba_game_id),
        season=season,
        home_nba_team_id=_int(raw["hometeamId"], f"{what} hometeamId"),
        away_nba_team_id=_int(raw["awayteamId"], f"{what} awayteamId"),
        home_score=_optional_int(raw["homeScore"], f"{what} homeScore"),
        away_score=_optional_int(raw["awayScore"], f"{what} awayScore"),
        venue=_optional_text(raw["arenaName"]),
        label=_optional_text(raw["gameLabel"]),
        sub_label=_optional_text(raw["gameSubLabel"]),
        series_game_number=_series_game_number(raw["seriesGameNumber"], nba_game_id),
    )


def _require_team(nba_team_id: int, where: str) -> None:
    if nba_team_id not in _TEAMS:
        raise UnrecognizedTeamError(
            f"{where} names team {nba_team_id}, which is not one of the league's 30 teams -- "
            "Team must be seeded before Game import, see wiki/CodeContext/Modules/0x02-events.md."
        )


# --------------------------------------------------------------------- TeamStatistics.csv


def _read_team_stats(path: Path, stored: dict[int, _StoredGame]) -> None:
    """Each stored game's line score and minutes, per team."""
    for raw in _rows(path, _TEAM_STATS_COLUMNS):
        game = stored.get(_int(raw["gameId"], f"{path.name} gameId"))
        if game is None:
            continue
        what = f"{path.name} game {game.row.nba_game_id}"
        nba_team_id = _int(raw["teamId"], f"{what} teamId")
        if nba_team_id == 0:
            # A placeholder line with no team and no stats (two 2025-26 games
            # carry one beside their two real lines): it says nothing.
            continue
        if nba_team_id not in (game.row.home_nba_team_id, game.row.away_nba_team_id):
            raise DatasetError(f"{what} has a line for team {nba_team_id}, which did not play it")
        game.line_scores[nba_team_id] = _line_score(raw, f"{what} team {nba_team_id}")
        minutes = raw["numMinutes"].strip()
        game.team_minutes[nba_team_id] = float(minutes) if minutes else None


def _line_score(raw: dict[str, str], what: str) -> list[int] | None:
    """Quarters, then the first and second overtime, then the third and any
    later as one figure: the source has only ot1, ot2 and all overtimes."""
    quarters = [_optional_int(raw[f"q{n}Points"], f"{what} q{n}Points") for n in range(1, 5)]
    periods = [points for points in quarters if points is not None]
    if len(periods) < 4:
        return None
    ot1 = _optional_int(raw["ot1Points"], f"{what} ot1Points")
    ot2 = _optional_int(raw["ot2Points"], f"{what} ot2Points")
    ot_all = _optional_int(raw["otAllPoints"], f"{what} otAllPoints")
    periods.extend(points for points in (ot1, ot2) if points is not None)
    if ot_all is not None:
        later = ot_all - (ot1 or 0) - (ot2 or 0)
        if later < 0:
            raise DatasetError(f"{what}: otAllPoints {ot_all} is less than ot1 + ot2")
        if later:
            periods.append(later)
    return periods


# --------------------------------------------------------------------- PlayerStatistics.csv


def _read_box_scores(
    path: Path, stored: dict[int, _StoredGame], counts: dict[str, _SeasonCounts]
) -> None:
    """Attach each stored game's box score, in one pass over the file. Rows
    of a season being loaded whose game is not stored are counted as
    skipped; a repeated (game, player) keeps the first row and is counted."""
    for raw in _rows(path, _BOX_COLUMNS):
        nba_game_id = _int(raw["gameId"], f"{path.name} gameId")
        game = stored.get(nba_game_id)
        if game is None:
            season_counts = counts.get(_season_label(_season_of(nba_game_id)))
            if season_counts is not None:
                season_counts.box_score_rows_skipped += 1
            continue
        nba_person_id = _int(raw["personId"], f"game {nba_game_id} personId")
        if nba_person_id in game.person_ids:
            counts[game.season].duplicate_box_score_rows += 1
            continue
        game.person_ids.add(nba_person_id)
        game.box.append(_parse_box_row(raw, game, nba_person_id))


def _parse_box_row(raw: dict[str, str], game: _StoredGame, nba_person_id: int) -> _BoxRow:
    what = f"game {game.row.nba_game_id} player {nba_person_id}"
    home_flag = raw["home"].strip()
    if home_flag in ("1", "1.0"):
        side_team = game.row.home_nba_team_id
    elif home_flag in ("0", "0.0"):
        side_team = game.row.away_nba_team_id
    else:
        raise DatasetError(f"{what}: home {raw['home']!r} is not 0 or 1")
    team_text = raw["playerteamId"].strip()
    if team_text:
        nba_team_id = _int(team_text, f"{what} playerteamId")
        _require_team(nba_team_id, f"box score of game {game.row.nba_game_id}")
        if nba_team_id != side_team:
            raise DatasetError(
                f"{what}: playerteamId {nba_team_id} contradicts its home flag "
                f"({home_flag}), which makes it team {side_team}"
            )
    else:
        # About 10 % of rows leave the team blank; the home flag never disagrees.
        nba_team_id = side_team
    minutes = raw["numMinutes"].strip()
    return _BoxRow(
        nba_person_id=nba_person_id,
        nba_team_id=nba_team_id,
        starting_position=_optional_text(raw["startingPosition"]),
        minutes=minutes,
        dnp_reason=None if minutes else _optional_text(raw["comment"]),
        stats=tuple(_int(raw[source], f"{what} {source}") for _, source in _STAT_COLUMNS),
    )


def _resolve_minutes(game: _StoredGame) -> None:
    """Set every box row's seconds_played, one team at a time (see the module
    docstring, "Minutes are stored as seconds")."""
    for nba_team_id in sorted({row.nba_team_id for row in game.box}):
        rows = [row for row in game.box if row.nba_team_id == nba_team_id and row.minutes]
        what = f"game {game.row.nba_game_id} team {nba_team_id} numMinutes"
        seconds, clear = _team_seconds(
            [row.minutes for row in rows], game.team_minutes.get(nba_team_id), what
        )
        if not clear:
            game.unclear_minutes_teams.append(nba_team_id)
        for row, value in zip(rows, seconds, strict=True):
            row.seconds_played = value


def _team_seconds(
    values: list[str], team_minutes: float | None, what: str
) -> tuple[list[int], bool]:
    """One team's minutes in a game as seconds, and whether the reading was
    clear. Whole minutes read the same either way."""
    try:
        decimal = [float(value) for value in values]
    except ValueError as exc:
        raise DatasetError(f"{what}: {exc}") from exc
    as_decimal = [round(value * 60) for value in decimal]
    if all(value.is_integer() for value in decimal):
        return as_decimal, True
    if team_minutes is not None:
        fits_decimal = abs(sum(as_decimal) / 60 - team_minutes) <= _MINUTES_TOLERANCE
        if fits_decimal:
            return as_decimal, True
        as_minutes_seconds = _minutes_seconds(values)
        if (
            as_minutes_seconds is not None
            and abs(sum(as_minutes_seconds) / 60 - team_minutes) <= _MINUTES_TOLERANCE
        ):
            return as_minutes_seconds, True
    return as_decimal, False


def _minutes_seconds(values: list[str]) -> list[int] | None:
    """Each value read as minutes.seconds ("27.04" = 27:04, "47.5" = 47:50:
    the float's trailing zero is dropped), or None when one cannot be."""
    seconds = []
    for value in values:
        whole, _, fraction = value.partition(".")
        if not whole.isdigit() or len(fraction) > 2 or (fraction and not fraction.isdigit()):
            return None
        extra = int(fraction.ljust(2, "0")) if fraction else 0
        # 60 occurs ("30.6" = 30:60): seconds rounded up without carrying.
        if extra > 60:
            return None
        seconds.append(int(whole) * 60 + extra)
    return seconds


# --------------------------------------------------------------------- Players.csv


def _read_players(path: Path, stored: dict[int, _StoredGame]) -> dict[int, _PlayerRow]:
    """The Players.csv row of every player a stored box score names. A
    player missing from the file stops the run."""
    first_game: dict[int, int] = {}
    for game in stored.values():
        for row in game.box:
            first_game.setdefault(row.nba_person_id, game.row.nba_game_id)

    players: dict[int, _PlayerRow] = {}
    for raw in _rows(path, _PLAYERS_COLUMNS):
        nba_person_id = _int(raw["personId"], f"{path.name} personId")
        if nba_person_id in first_game and nba_person_id not in players:
            players[nba_person_id] = _parse_player(raw, nba_person_id)

    for nba_person_id, nba_game_id in first_game.items():
        if nba_person_id not in players:
            raise UnrecognizedPlayerError(
                f"box score of game {nba_game_id} names player {nba_person_id}, who is not in "
                f"{path.name} -- a Player is never invented from a box-score row."
            )
    return players


def _parse_player(raw: dict[str, str], nba_person_id: int) -> _PlayerRow:
    what = f"Players.csv player {nba_person_id}"
    birth = raw["birthDate"].strip()
    try:
        birth_date = date.fromisoformat(birth[:10]) if birth else None
    except ValueError as exc:
        raise DatasetError(f"{what}: birthDate {birth!r} is not a date") from exc
    position = "-".join(
        letter
        for letter, column in (("G", "guard"), ("F", "forward"), ("C", "center"))
        if _optional_int(raw[column], f"{what} {column}")
    )
    first_year = _optional_count(raw["fromYear"], f"{what} fromYear")
    last_year = _optional_count(raw["toYear"], f"{what} toYear")
    return _PlayerRow(
        nba_person_id=nba_person_id,
        first_name=_optional_text(raw["firstName"]),
        last_name=_optional_text(raw["lastName"]),
        birth_date=birth_date,
        height_inches=_optional_count(raw["heightInches"], f"{what} heightInches"),
        weight_lbs=_optional_count(raw["bodyWeightLbs"], f"{what} bodyWeightLbs"),
        country=_optional_text(raw["country"]),
        school=_optional_text(raw["school"]),
        jersey=_optional_text(raw["jersey"]),
        position=position or None,
        draft_year=_optional_count(raw["draftYear"], f"{what} draftYear"),
        draft_round=_optional_count(raw["draftRound"], f"{what} draftRound"),
        draft_number=_optional_count(raw["draftNumber"], f"{what} draftNumber"),
        first_season=_season_label(first_year) if first_year else None,
        last_season=_season_label(last_year) if last_year else None,
    )


# --------------------------------------------------------------------- writing


def _batches(items: list[Any]) -> Iterable[list[Any]]:
    for start in range(0, len(items), _BATCH_SIZE):
        yield items[start : start + _BATCH_SIZE]


def _upsert_teams(session: Session) -> tuple[dict[int, int], int]:
    """Create every league team not already stored (matched by nba_team_id);
    an existing row is left as it is. Returns nba_team_id -> Team.id and how
    many were created."""
    existing: dict[int, int] = {
        nba_team_id: team_id
        for nba_team_id, team_id in session.execute(
            select(Team.nba_team_id, Team.id).where(Team.nba_team_id.in_(list(_TEAMS)))
        )
    }
    created = {
        t.nba_team_id: Team(
            nba_team_id=t.nba_team_id,
            name=t.name,
            abbreviation=t.abbreviation,
            conference=t.conference,
            division=t.division,
        )
        for t in _TEAMS.values()
        if t.nba_team_id not in existing
    }
    session.add_all(created.values())
    session.flush()  # populate Team.id for the games below
    existing.update({nba_team_id: team.id for nba_team_id, team in created.items()})
    return existing, len(created)


def _upsert_players(session: Session, players: dict[int, _PlayerRow]) -> tuple[dict[int, int], int]:
    """Create every player not already stored (matched by nba_person_id); an
    existing row is left as it is. Returns nba_person_id -> Player.id and how
    many were created."""
    ids: dict[int, int] = {}
    for batch in _batches(list(players)):
        ids.update(
            (nba_person_id, player_id)
            for nba_person_id, player_id in session.execute(
                select(Player.nba_person_id, Player.id).where(Player.nba_person_id.in_(batch))
            )
        )
    new = [Player(**vars(p)) for p in players.values() if p.nba_person_id not in ids]
    for batch in _batches(new):
        session.add_all(batch)
        session.flush()  # populate Player.id for the box scores below
    ids.update({player.nba_person_id: player.id for player in new})
    return ids, len(new)


def _existing_games(session: Session, nba_game_ids: list[int]) -> tuple[dict[int, Game], set[int]]:
    """Stored games among `nba_game_ids`, and the Game.ids of those that
    already have a box score."""
    games: dict[int, Game] = {}
    for batch in _batches(nba_game_ids):
        games.update(
            (game.nba_game_id, game)
            for game in session.scalars(select(Game).where(Game.nba_game_id.in_(batch)))
        )
    with_box: set[int] = set()
    for batch in _batches([game.id for game in games.values()]):
        with_box.update(
            session.scalars(
                select(PlayerGameStats.game_id).where(PlayerGameStats.game_id.in_(batch)).distinct()
            )
        )
    return games, with_box


def _write_games(
    session: Session,
    stored: dict[int, _StoredGame],
    team_ids: dict[int, int],
    player_ids: dict[int, int],
    counts: dict[str, _SeasonCounts],
) -> None:
    """Insert new games, update stored ones, and insert the box score of
    every game written that has none yet."""
    existing, with_box = _existing_games(session, list(stored))
    new_games: list[tuple[_StoredGame, Game]] = []
    needing_box: list[tuple[_StoredGame, Game]] = []

    for nba_game_id, game in stored.items():
        season_counts = counts[game.season]
        values = game.fields(team_ids)
        current = existing.get(nba_game_id)
        if current is None:
            season_counts.games_loaded += 1
            new_games.append((game, Game(nba_game_id=nba_game_id, **values)))
            continue

        _check_agrees(current, values, nba_game_id)
        changed = {name: value for name, value in values.items() if getattr(current, name) != value}
        has_box = current.id in with_box
        if has_box:
            season_counts.box_score_rows_already_present += len(game.box)
        if not changed and (has_box or not game.box):
            season_counts.games_already_present += 1
            continue
        season_counts.games_updated += 1
        for name, value in changed.items():
            setattr(current, name, value)
        if not has_box:
            needing_box.append((game, current))

    for batch in _batches(new_games):
        session.add_all(model for _, model in batch)
        session.flush()  # populate Game.id for the box scores below
    session.flush()

    rows: list[tuple[Any, ...]] = []
    for game, model in [*new_games, *needing_box]:
        season_counts = counts[game.season]
        _report_box_score(game, season_counts)
        season_counts.box_score_rows_loaded += len(game.box)
        rows.extend(_box_values(row, model.id, team_ids, player_ids) for row in game.box)
    _copy_box_rows(session, rows)


def _copy_box_rows(session: Session, rows: list[tuple[Any, ...]]) -> None:
    """Insert box-score rows with Postgres COPY, on the session's own
    connection and so inside the run's transaction. An executemany insert
    sent one statement per row (measured: 7 minutes for one season's 35k
    rows against a local Docker Postgres); COPY streams them. The column
    list is the model's, never data."""
    columns = ", ".join(_BOX_COLUMNS_ORDER)
    driver_connection = session.connection().connection.driver_connection
    assert driver_connection is not None
    with (
        driver_connection.cursor() as cursor,
        cursor.copy(f"COPY {PlayerGameStats.__tablename__} ({columns}) FROM STDIN") as copy,
    ):
        for row in rows:
            copy.write_row(row)


def _check_agrees(current: Game, values: dict[str, Any], nba_game_id: int) -> None:
    """A stored game's teams and score are facts the dataset must agree with."""
    for name in ("home_team_id", "away_team_id", "home_score", "away_score"):
        if getattr(current, name) != values[name]:
            raise DatasetError(
                f"game {nba_game_id} is stored with {name} {getattr(current, name)}, but the "
                f"dataset says {values[name]}; a stored result is never changed silently"
            )


def _report_box_score(game: _StoredGame, season_counts: _SeasonCounts) -> None:
    """Name what is missing or does not add up in a box score this run writes."""
    nba_game_id = game.row.nba_game_id
    if not game.box:
        season_counts.missing_box_scores.append(nba_game_id)
        return
    season_counts.unclear_minutes.extend(
        (nba_game_id, nba_team_id) for nba_team_id in game.unclear_minutes_teams
    )
    for nba_team_id, score in (
        (game.row.home_nba_team_id, game.home_score),
        (game.row.away_nba_team_id, game.away_score),
    ):
        points = sum(row.stats[_POINTS] for row in game.box if row.nba_team_id == nba_team_id)
        if points != score:
            season_counts.points_mismatches.append(
                PointsMismatch(
                    nba_game_id=nba_game_id,
                    nba_team_id=nba_team_id,
                    team_score=score,
                    players_points=points,
                )
            )


_BOX_COLUMNS_ORDER = (
    "game_id",
    "player_id",
    "team_id",
    "starter",
    "starting_position",
    "seconds_played",
    "dnp_reason",
    *(model for model, _ in _STAT_COLUMNS),
)


def _box_values(
    row: _BoxRow, game_id: int, team_ids: dict[int, int], player_ids: dict[int, int]
) -> tuple[Any, ...]:
    """One PlayerGameStats row, in _BOX_COLUMNS_ORDER."""
    return (
        game_id,
        player_ids[row.nba_person_id],
        team_ids[row.nba_team_id],
        row.starting_position is not None,
        row.starting_position,
        row.seconds_played,
        row.dnp_reason,
        *row.stats,
    )
