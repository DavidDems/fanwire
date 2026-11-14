"""Shared helpers for EVENTS-014's schedule tests (test_schedule_load.py,
test_schedule_route.py, test_schedule_contract.py).

Expected values are worked out here from the fixture's CSV files with the
csv module, by the rules .ai/tasks/EVENTS-014/task.json states, never by
calling the code under test. Plain functions, not pytest fixtures, as in
players_support.py.

`ScheduledGame` is imported inside the functions that need it, so a module
importing this one still collects while the model does not exist yet.
"""

from __future__ import annotations

import csv
import re
import shutil
from dataclasses import dataclass
from datetime import datetime, time
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

_BACKEND_DIR = Path(__file__).resolve().parents[2]
FIXTURE_DIR = _BACKEND_DIR / "tests" / "fixtures" / "nba_data"
SCHEDULE_25_26 = "LeagueSchedule25_26.csv"
GAMES_FILE = "Games.csv"

# The real header of LeagueSchedule25_26.csv and LeagueSchedule26_27.csv.
SCHEDULE_HEADER = [
    "gameId",
    "gameDateTimeEst",
    "gameDay",
    "homeTeamId",
    "awayTeamId",
    "homeTeamName",
    "homeTeamCity",
    "awayTeamName",
    "awayTeamCity",
    "arenaName",
    "arenaCity",
    "arenaState",
    "gameLabel",
    "gameSubLabel",
    "gameSubtype",
    "seriesGameNumber",
    "weekNumber",
]
# The 2024-25 file's header, which the loader does not read (a DatasetError).
SCHEDULE_HEADER_24_25 = [
    "gameId",
    "gameDateTimeEst",
    "gameDay",
    "arenaCity",
    "arenaState",
    "arenaName",
    "gameLabel",
    "gameSubLabel",
    "gameSubtype",
    "gameSequence",
    "seriesGameNumber",
    "seriesText",
    "weekNumber",
    "hometeamId",
    "awayteamId",
]

STORED_TYPES = {"2": "regular", "4": "playoffs", "5": "play-in", "6": "cup-final"}
PRESEASON, ALL_STAR = "1", "3"


# --------------------------------------------------------------------- files


def copy_fixture(tmp_path: Path, name: str = "nba") -> Path:
    data_dir = tmp_path / name
    shutil.copytree(FIXTURE_DIR, data_dir)
    return data_dir


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return list(reader.fieldnames or []), list(reader)


def write_csv(path: Path, header: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=header, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def schedule_row(
    game_id: str,
    when: str,
    home: str,
    away: str,
    *,
    arena: str = "Some Arena",
    label: str = "",
    sub_label: str = "",
    series: str = "",
) -> dict[str, str]:
    """One row in the 2025-26 header shape."""
    return {
        "gameId": game_id,
        "gameDateTimeEst": when,
        "gameDay": "Tue",
        "homeTeamId": home,
        "awayTeamId": away,
        "homeTeamName": "",
        "homeTeamCity": "",
        "awayTeamName": "",
        "awayTeamCity": "",
        "arenaName": arena,
        "arenaCity": "",
        "arenaState": "",
        "gameLabel": label,
        "gameSubLabel": sub_label,
        "gameSubtype": "",
        "seriesGameNumber": series,
        "weekNumber": "1",
    }


def fixture_schedule_rows() -> list[dict[str, str]]:
    return read_csv(FIXTURE_DIR / SCHEDULE_25_26)[1]


# --------------------------------------------------------------------- expected values


@dataclass(frozen=True)
class Expected:
    """A scheduled_games row as the spec says it is stored (teams as
    nba.com ids, None for undecided)."""

    nba_game_id: int
    season: str
    date: datetime
    time_tbd: bool
    game_type: str
    label: str | None
    sub_label: str | None
    venue: str | None
    series_game_number: int | None
    home_nba_team_id: int | None
    away_nba_team_id: int | None


@dataclass(frozen=True)
class ExpectedReport:
    stored: int
    undecided: int
    preseason: int
    all_star: int
    duplicates: int


def season_of(game_id: str) -> str:
    start = 2000 + int(game_id[1:3])
    return f"{start}-{(start + 1) % 100:02d}"


def _text(value: str) -> str | None:
    return value.strip() or None


def _team(value: str) -> int | None:
    value = value.strip()
    return None if value in ("", "0") else int(value)


def _series(value: str) -> int | None:
    value = value.strip().removeprefix("Game ").strip()
    return None if value in ("", "0") else int(value)


def expected_rows(rows: list[dict[str, str]]) -> tuple[dict[int, Expected], ExpectedReport]:
    """The stored rows (by nba_game_id) and the report counts for one file."""
    first: dict[str, dict[str, str]] = {}
    duplicates = 0
    for row in rows:
        if row["gameId"] in first:
            assert first[row["gameId"]] == row, "the fixture's duplicates are identical"
            duplicates += 1
            continue
        first[row["gameId"]] = row
    stored: dict[int, Expected] = {}
    preseason = all_star = 0
    for game_id, row in first.items():
        prefix = game_id[0]
        if prefix == PRESEASON:
            preseason += 1
            continue
        if prefix == ALL_STAR:
            all_star += 1
            continue
        when = datetime.strptime(row["gameDateTimeEst"], "%Y-%m-%d %H:%M:%S")
        stored[int(game_id)] = Expected(
            nba_game_id=int(game_id),
            season=season_of(game_id),
            date=when,
            time_tbd=when.time() == time(0, 0),
            game_type=STORED_TYPES[prefix],
            label=_text(row["gameLabel"]),
            sub_label=_text(row["gameSubLabel"]),
            venue=_text(row["arenaName"]),
            series_game_number=_series(row["seriesGameNumber"]),
            home_nba_team_id=_team(row["homeTeamId"]),
            away_nba_team_id=_team(row["awayTeamId"]),
        )
    undecided = sum(
        1 for e in stored.values() if e.home_nba_team_id is None or e.away_nba_team_id is None
    )
    return stored, ExpectedReport(
        stored=len(stored),
        undecided=undecided,
        preseason=preseason,
        all_star=all_star,
        duplicates=duplicates,
    )


def games_csv_ids(data_dir: Path = FIXTURE_DIR) -> set[int]:
    return {int(row["gameId"]) for row in read_csv(data_dir / GAMES_FILE)[1]}


# --------------------------------------------------------------------- stored rows


def scheduled_game_model() -> Any:
    from app.events.models import ScheduledGame  # EVENTS-014's new model

    return ScheduledGame


def stored_schedule(session: Session) -> dict[int, Expected]:
    """Every scheduled_games row, as an Expected (teams mapped back to their
    nba.com ids)."""
    from app.events.models import Team

    model = scheduled_game_model()
    nba_ids = dict(session.execute(select(Team.id, Team.nba_team_id)).tuples().all())
    rows = session.scalars(select(model)).all()
    result: dict[int, Expected] = {}
    for row in rows:
        result[row.nba_game_id] = Expected(
            nba_game_id=row.nba_game_id,
            season=row.season,
            date=row.date.replace(tzinfo=None),
            time_tbd=row.time_tbd,
            game_type=row.game_type,
            label=row.label,
            sub_label=row.sub_label,
            venue=row.venue,
            series_game_number=row.series_game_number,
            home_nba_team_id=None if row.home_team_id is None else nba_ids[row.home_team_id],
            away_nba_team_id=None if row.away_team_id is None else nba_ids[row.away_team_id],
        )
    return result


# --------------------------------------------------------------------- the report


def schedule_lines(lines: list[str], season: str) -> list[str]:
    """The report lines about `season`'s schedule: those naming the season
    and the word "schedule". Every pre-EVENTS-014 line names neither."""
    return [line for line in lines if season in line and "schedule" in line.lower()]


def clause_number(line: str, keyword: str, season: str) -> int:
    """The one whole number in the clause of `line` that holds `keyword`.

    Clauses are split on , ; / and parentheses, after removing the season
    itself (its digits are not a count). The wording around each number is
    the implementation's; that the number sits in the same clause as its
    keyword ("7 stored", "stored 7", "preseason 1") is what is pinned."""
    text = line.replace(season, " ")
    clauses = [c for c in re.split(r"[,;/()]", text) if keyword.lower() in c.lower()]
    assert len(clauses) == 1, f"expected one clause naming {keyword!r} in: {line!r}"
    numbers = re.findall(r"\b\d+\b", clauses[0])
    assert len(numbers) == 1, f"expected one number beside {keyword!r} in: {clauses[0]!r}"
    return int(numbers[0])
