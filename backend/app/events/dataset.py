"""The Eoin Moore NBA dataset's reading rules, shared by the files' readers:
app.events.nba_history (Games.csv and the box-score files) and
app.events.schedule (LeagueSchedule<YY>_<YY>.csv, EVENTS-014).

Moved here unchanged from nba_history so both readers apply one copy of
each rule (and schedule need not import nba_history, which calls it): the
league's 30 franchises, the game id's prefix -> game type and season, the
CSV header check, the number, text, series and date parsers, and
DatasetError. nba_history's module docstring explains the rules.
"""

from __future__ import annotations

import csv
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from app.events.errors import UnrecognizedTeamError

FIRST_SEASON_START = 2003


@dataclass(frozen=True)
class TeamRow:
    nba_team_id: int
    name: str
    abbreviation: str
    conference: str
    division: str


# League reference data, not invented data: the dataset's four files carry no
# abbreviation, conference or division, and Team requires all three. The 30
# franchises as they are today, keyed by nba.com team id; every 2003-04+ game
# is between two of them. A team missing here is an UnrecognizedTeamError.
TEAMS: dict[int, TeamRow] = {
    t.nba_team_id: t
    for t in (
        TeamRow(1610612738, "Boston Celtics", "BOS", "Eastern", "Atlantic"),
        TeamRow(1610612751, "Brooklyn Nets", "BKN", "Eastern", "Atlantic"),
        TeamRow(1610612752, "New York Knicks", "NYK", "Eastern", "Atlantic"),
        TeamRow(1610612755, "Philadelphia 76ers", "PHI", "Eastern", "Atlantic"),
        TeamRow(1610612761, "Toronto Raptors", "TOR", "Eastern", "Atlantic"),
        TeamRow(1610612741, "Chicago Bulls", "CHI", "Eastern", "Central"),
        TeamRow(1610612739, "Cleveland Cavaliers", "CLE", "Eastern", "Central"),
        TeamRow(1610612765, "Detroit Pistons", "DET", "Eastern", "Central"),
        TeamRow(1610612754, "Indiana Pacers", "IND", "Eastern", "Central"),
        TeamRow(1610612749, "Milwaukee Bucks", "MIL", "Eastern", "Central"),
        TeamRow(1610612737, "Atlanta Hawks", "ATL", "Eastern", "Southeast"),
        TeamRow(1610612766, "Charlotte Hornets", "CHA", "Eastern", "Southeast"),
        TeamRow(1610612748, "Miami Heat", "MIA", "Eastern", "Southeast"),
        TeamRow(1610612753, "Orlando Magic", "ORL", "Eastern", "Southeast"),
        TeamRow(1610612764, "Washington Wizards", "WAS", "Eastern", "Southeast"),
        TeamRow(1610612743, "Denver Nuggets", "DEN", "Western", "Northwest"),
        TeamRow(1610612750, "Minnesota Timberwolves", "MIN", "Western", "Northwest"),
        TeamRow(1610612760, "Oklahoma City Thunder", "OKC", "Western", "Northwest"),
        TeamRow(1610612757, "Portland Trail Blazers", "POR", "Western", "Northwest"),
        TeamRow(1610612762, "Utah Jazz", "UTA", "Western", "Northwest"),
        TeamRow(1610612744, "Golden State Warriors", "GSW", "Western", "Pacific"),
        TeamRow(1610612746, "Los Angeles Clippers", "LAC", "Western", "Pacific"),
        TeamRow(1610612747, "Los Angeles Lakers", "LAL", "Western", "Pacific"),
        TeamRow(1610612756, "Phoenix Suns", "PHX", "Western", "Pacific"),
        TeamRow(1610612758, "Sacramento Kings", "SAC", "Western", "Pacific"),
        TeamRow(1610612742, "Dallas Mavericks", "DAL", "Western", "Southwest"),
        TeamRow(1610612745, "Houston Rockets", "HOU", "Western", "Southwest"),
        TeamRow(1610612763, "Memphis Grizzlies", "MEM", "Western", "Southwest"),
        TeamRow(1610612740, "New Orleans Pelicans", "NOP", "Western", "Southwest"),
        TeamRow(1610612759, "San Antonio Spurs", "SAS", "Western", "Southwest"),
    )
}

# The game id's first digit. Preseason and All-Star are skipped and counted.
PRESEASON = "1"
ALL_STAR = "3"
STORED_GAME_TYPES = {"2": "regular", "4": "playoffs", "5": "play-in", "6": "cup-final"}


class DatasetError(ValueError):
    """The dataset (or the requested season list) is not what the loader
    can store faithfully: a missing file or column, a malformed value, an
    unknown game type, duplicate rows that disagree, or a stored game the
    dataset contradicts. Raised before anything is written, or rolled back."""


def season_label(start: int) -> str:
    """2019 -> "2019-20", 1999 -> "1999-00"."""
    return f"{start}-{(start + 1) % 100:02d}"


def season_of(nba_game_id: int) -> int:
    """The season's start year, from digits 2-3 of the game id (nba.com's
    leading 0 is dropped): 22400001 -> 2024, 29900001 -> 1999."""
    text = str(nba_game_id)
    if len(text) != 8:
        raise DatasetError(f"game id {nba_game_id} is not an 8-digit nba.com game id")
    two_digits = int(text[1:3])
    return 1900 + two_digits if two_digits >= 46 else 2000 + two_digits


def read_rows(path: Path, required: tuple[str, ...]) -> Iterator[dict[str, str]]:
    """Every row of a dataset CSV, after checking its header carries the
    columns the loader reads. A missing column is a DatasetError so the CLI
    reports it as a data problem, not a crash."""
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        missing = [column for column in required if column not in (reader.fieldnames or [])]
        if missing:
            raise DatasetError(f"{path.name} is missing column(s): {', '.join(missing)}")
        yield from reader


def whole_number(value: str, what: str) -> int:
    """A whole number, written either "130" or "130.0"."""
    try:
        number = float(value)
    except ValueError as exc:
        raise DatasetError(f"{what}: {value!r} is not a number") from exc
    if not number.is_integer():
        raise DatasetError(f"{what}: {value!r} is not a whole number")
    return int(number)


def optional_int(value: str, what: str) -> int | None:
    return None if not value.strip() else whole_number(value, what)


def optional_text(value: str) -> str | None:
    return value.strip() or None


def series_game_number(value: str, nba_game_id: int) -> int | None:
    """Written "5.0", "Game 5" or blank; 0 means no series."""
    text = value.strip().removeprefix("Game ")
    return optional_int(text, f"game {nba_game_id} seriesGameNumber") or None


def game_datetime(value: str, nba_game_id: int) -> datetime:
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(value.strip(), fmt)
        except ValueError:
            continue
    raise DatasetError(f"game {nba_game_id}: gameDateTimeEst {value!r} is not a date and time")


def require_team(nba_team_id: int, where: str) -> None:
    if nba_team_id not in TEAMS:
        raise UnrecognizedTeamError(
            f"{where} names team {nba_team_id}, which is not one of the league's 30 teams -- "
            "Team must be seeded before Game import, see wiki/CodeContext/Modules/0x02-events.md."
        )
