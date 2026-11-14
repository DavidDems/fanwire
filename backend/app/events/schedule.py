"""Load each season's published schedule, the dataset's
LeagueSchedule<YY>_<YY>.csv, into ScheduledGame (EVENTS-014).

Called by app.events.nba_history.load_nba_history, inside its one
transaction: every file is read and checked before the load's first write
(read_schedules), and a season's rows are written with the games
(write_schedules), so a failed load leaves the stored schedule as it was.

Rules, and why:

- **Which files.** For each season the load processes, the file of that
  season from the same directory, when present (2026-27 reads
  LeagueSchedule26_27.csv). With every season (seasons=None), also every
  such file present for 2003-04 or later, whether or not Games.csv has that
  season yet. A missing file is not an error: the season is reported as
  having no schedule file, and its stored schedule is left as it was.
- **One header shape.** Only the shape of LeagueSchedule25_26.csv and
  LeagueSchedule26_27.csv. A file missing one of the columns read here
  (LeagueSchedule24_25.csv spells hometeamId otherwise and writes UTC
  offsets) is a DatasetError naming the file.
- **The games rules** (app.events.dataset): the id's prefix decides the
  type (preseason and All-Star rows are skipped and counted), the id's
  digits decide the season, which must be the file's; a malformed id or
  date is a DatasetError; identical duplicates keep the first and are
  counted, duplicates that disagree are a DatasetError; a team that is not
  one of the 30 is UnrecognizedTeamError.
- **The schedule's own quirks.** A team id of 0 or blank is a team not
  decided yet (NBA Cup knockout games and the final): stored as null. A
  start of 00:00:00 is a start time not set yet (no NBA game starts at
  midnight Eastern): `time_tbd`, the date kept as written.
- **Replaced as a whole.** A season whose file is read gets exactly the
  file's rows: rows no longer in it (a cancelled game, a postponed one
  moved to a new id) are deleted, changed rows updated, new rows added.
  Unlike a stored game, a changed row is not a DatasetError: schedules
  change, results do not. Nothing references scheduled_games, so deleting
  a row is always safe.
"""

from __future__ import annotations

import re
from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime, time
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.events.dataset import (
    ALL_STAR,
    FIRST_SEASON_START,
    PRESEASON,
    STORED_GAME_TYPES,
    DatasetError,
    game_datetime,
    optional_int,
    optional_text,
    read_rows,
    require_team,
    season_label,
    season_of,
    series_game_number,
    whole_number,
)
from app.events.models import ScheduledGame

# The columns read, in the header shape of LeagueSchedule25_26.csv and
# LeagueSchedule26_27.csv; the file's other columns are ignored.
SCHEDULE_COLUMNS = (
    "gameId",
    "gameDateTimeEst",
    "homeTeamId",
    "awayTeamId",
    "arenaName",
    "gameLabel",
    "gameSubLabel",
    "seriesGameNumber",
)

_FILE_NAME = re.compile(r"^LeagueSchedule(\d{2})_(\d{2})\.csv$")

# The source's start time for a game whose time is not set yet.
_TIME_TBD = time(0, 0)


def schedule_file_name(season: str) -> str:
    """ "2026-27" -> "LeagueSchedule26_27.csv"."""
    start, end = season.split("-")
    return f"LeagueSchedule{start[2:]}_{end}.csv"


# --------------------------------------------------------------------- reports


@dataclass(frozen=True)
class ScheduleReport:
    """What one load did with one season's schedule file, or that it had
    none (`has_file` false: its stored schedule was left as it was)."""

    season: str
    has_file: bool
    rows_stored: int = 0
    rows_undecided: int = 0
    skipped_preseason: int = 0
    skipped_all_star: int = 0
    duplicate_rows: int = 0

    def line(self) -> str:
        if not self.has_file:
            return f"{self.season} schedule: no schedule file, its stored schedule left as it was"
        return (
            f"{self.season} schedule: {self.rows_stored} rows stored "
            f"({self.rows_undecided} with an undecided team); "
            f"skipped {self.skipped_preseason} preseason / {self.skipped_all_star} All-Star "
            f"/ {self.duplicate_rows} duplicate rows"
        )


# --------------------------------------------------------------------- parsed rows


@dataclass(frozen=True)
class _ScheduleRow:
    """A schedule row's stored fields, teams still nba.com ids (None: not
    decided yet)."""

    nba_game_id: int
    date: datetime
    home_nba_team_id: int | None
    away_nba_team_id: int | None
    venue: str | None
    label: str | None
    sub_label: str | None
    series_game_number: int | None


@dataclass(frozen=True)
class SeasonSchedule:
    """One season's file, read and checked: the rows to store, by
    nba_game_id, with their game type."""

    season: str
    rows: dict[int, tuple[_ScheduleRow, str]]
    skipped_preseason: int
    skipped_all_star: int
    duplicate_rows: int


# --------------------------------------------------------------------- reading


def _file_season(name: str) -> str | None:
    """The season a schedule file's name gives, 2003-04 or later, else None."""
    match = _FILE_NAME.match(name)
    if match is None:
        return None
    two_digits = int(match.group(1))
    start = 1900 + two_digits if two_digits >= 46 else 2000 + two_digits
    season = season_label(start)
    if start < FIRST_SEASON_START or season[5:] != match.group(2):
        return None
    return season


def schedule_seasons(
    data_dir: Path, wanted: Collection[str] | None, loaded: Collection[str]
) -> list[str]:
    """The seasons a load reports a schedule for, oldest first: the requested
    ones, or, for every season, those the load's games have and those with a
    schedule file present."""
    if wanted is not None:
        return sorted(wanted)
    with_file = {season for path in data_dir.iterdir() if (season := _file_season(path.name))}
    return sorted(with_file | set(loaded))


def read_schedules(data_dir: Path, seasons: Collection[str]) -> dict[str, SeasonSchedule | None]:
    """Each season's file read and checked (None: no file), before anything
    is written."""
    found: dict[str, SeasonSchedule | None] = {}
    for season in seasons:
        path = data_dir / schedule_file_name(season)
        found[season] = _read_schedule(path, season) if path.is_file() else None
    return found


def _read_schedule(path: Path, season: str) -> SeasonSchedule:
    first_rows: dict[int, _ScheduleRow] = {}
    duplicates = 0
    try:
        for raw in read_rows(path, SCHEDULE_COLUMNS):
            row = _parse_row(raw, season)
            first = first_rows.get(row.nba_game_id)
            if first is None:
                first_rows[row.nba_game_id] = row
                continue
            if first != row:
                raise DatasetError(f"conflicting rows for game {row.nba_game_id}: {first} vs {row}")
            duplicates += 1
    except DatasetError as exc:
        if str(exc).startswith(path.name):
            raise
        raise DatasetError(f"{path.name}: {exc}") from exc

    rows: dict[int, tuple[_ScheduleRow, str]] = {}
    preseason = all_star = 0
    for nba_game_id, row in first_rows.items():
        prefix = str(nba_game_id)[0]
        if prefix == PRESEASON:
            preseason += 1
            continue
        if prefix == ALL_STAR:
            all_star += 1
            continue
        game_type = STORED_GAME_TYPES.get(prefix)
        if game_type is None:
            raise DatasetError(
                f"{path.name}: game {nba_game_id}: unknown game id type prefix {prefix!r}"
            )
        for nba_team_id in (row.home_nba_team_id, row.away_nba_team_id):
            if nba_team_id is not None:
                require_team(nba_team_id, f"{path.name} game {nba_game_id}")
        rows[nba_game_id] = (row, game_type)
    return SeasonSchedule(
        season=season,
        rows=rows,
        skipped_preseason=preseason,
        skipped_all_star=all_star,
        duplicate_rows=duplicates,
    )


def _parse_row(raw: dict[str, str], season: str) -> _ScheduleRow:
    nba_game_id = whole_number(raw["gameId"], "gameId")
    row_season = season_label(season_of(nba_game_id))
    if row_season != season:
        raise DatasetError(f"game {nba_game_id} is a {row_season} game, not {season}")
    what = f"game {nba_game_id}"
    return _ScheduleRow(
        nba_game_id=nba_game_id,
        date=game_datetime(raw["gameDateTimeEst"], nba_game_id),
        home_nba_team_id=_team(raw["homeTeamId"], f"{what} homeTeamId"),
        away_nba_team_id=_team(raw["awayTeamId"], f"{what} awayTeamId"),
        venue=optional_text(raw["arenaName"]),
        label=optional_text(raw["gameLabel"]),
        sub_label=optional_text(raw["gameSubLabel"]),
        series_game_number=series_game_number(raw["seriesGameNumber"], nba_game_id),
    )


def _team(value: str, what: str) -> int | None:
    """An nba.com team id; 0 or blank is a team not decided yet."""
    return optional_int(value, what) or None


# --------------------------------------------------------------------- writing


def write_schedules(
    session: Session, schedules: dict[str, SeasonSchedule | None], team_ids: dict[int, int]
) -> dict[str, ScheduleReport]:
    """Replace each read season's stored schedule with its file's rows, in
    the caller's transaction; a season without a file is left as it was."""
    reports: dict[str, ScheduleReport] = {}
    for season, schedule in schedules.items():
        if schedule is None:
            reports[season] = ScheduleReport(season=season, has_file=False)
            continue
        _replace_season(session, schedule, team_ids)
        reports[season] = ScheduleReport(
            season=season,
            has_file=True,
            rows_stored=len(schedule.rows),
            rows_undecided=sum(
                1
                for row, _ in schedule.rows.values()
                if row.home_nba_team_id is None or row.away_nba_team_id is None
            ),
            skipped_preseason=schedule.skipped_preseason,
            skipped_all_star=schedule.skipped_all_star,
            duplicate_rows=schedule.duplicate_rows,
        )
    session.flush()
    return reports


def _values(
    row: _ScheduleRow, game_type: str, season: str, team_ids: dict[int, int]
) -> dict[str, Any]:
    """Every ScheduledGame column but the ids, with Team.id foreign keys."""
    return {
        "season": season,
        "date": row.date,
        "time_tbd": row.date.time() == _TIME_TBD,
        "game_type": game_type,
        "label": row.label,
        "sub_label": row.sub_label,
        "venue": row.venue,
        "series_game_number": row.series_game_number,
        "home_team_id": None if row.home_nba_team_id is None else team_ids[row.home_nba_team_id],
        "away_team_id": None if row.away_nba_team_id is None else team_ids[row.away_nba_team_id],
    }


def _replace_season(session: Session, schedule: SeasonSchedule, team_ids: dict[int, int]) -> None:
    stored = {
        game.nba_game_id: game
        for game in session.scalars(
            select(ScheduledGame).where(ScheduledGame.season == schedule.season)
        )
    }
    for nba_game_id, game in stored.items():
        if nba_game_id not in schedule.rows:
            session.delete(game)
    for nba_game_id, (row, game_type) in schedule.rows.items():
        values = _values(row, game_type, schedule.season, team_ids)
        current = stored.get(nba_game_id)
        if current is None:
            session.add(ScheduledGame(nba_game_id=nba_game_id, **values))
            continue
        for name, value in values.items():
            if getattr(current, name) != value:
                setattr(current, name, value)
