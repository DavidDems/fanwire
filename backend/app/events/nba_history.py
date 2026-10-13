"""Load historical NBA games from the Kaggle "NBA games" dataset (Nathan
Lauga: teams.csv, games.csv, games_details.csv) into Team and Game.

This is the "existing database of NBA game results" the events module
imports (wiki/CodeContext/Modules/0x02-events.md). The dataset's ids are
nba.com's, so rows are keyed by `Team.nba_team_id`/`Game.nba_game_id`.

Rules, and why:

- **One transaction per run.** Every file is read and validated before the
  first write, and the run commits once at the end; any exception rolls the
  whole run back. A failed run leaves the database exactly as it was, which
  is what 0x02-events.md's fail-fast rule asks of an import.
- **Fail fast on an unknown team.** A game, or a box-score row of a game
  being loaded, that names a team absent from teams.csv raises
  app.events.errors.UnrecognizedTeamError. No Team is ever invented from a
  game row.
- **Only real, finished games.** The GAME_ID's first digit is nba.com's game
  type: preseason and All-Star games are skipped and counted, regular season,
  playoffs and play-in are stored with `Game.game_type` set. A game without
  a final score is skipped and counted, never stored with an invented score.
- **Re-runnable.** A game whose `nba_game_id` is already stored is counted
  as already present and left untouched, so a second run over the same data
  writes nothing.
- **Sized for the real dataset** (~26k games, ~670k box-score rows): each
  file is read once, box-score rows are kept only for games this run stores,
  the existing-game lookup is batched, and rows are added in flushed batches.

Writes only Team and Game, through app.events.models; no raw SQL.
"""

from __future__ import annotations

import csv
import re
from collections.abc import Collection, Iterable, Iterator
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.events.errors import UnrecognizedTeamError
from app.events.models import Game, Team

_BATCH_SIZE = 1000

# League reference data, not invented data: teams.csv carries no conference
# or division, and Team requires both. Current NBA alignment, keyed by
# nba.com TEAM_ID. A team missing here is a DatasetError, never a guess.
_ALIGNMENT: dict[int, tuple[str, str]] = {
    # Eastern
    1610612738: ("Eastern", "Atlantic"),  # BOS
    1610612751: ("Eastern", "Atlantic"),  # BKN
    1610612752: ("Eastern", "Atlantic"),  # NYK
    1610612755: ("Eastern", "Atlantic"),  # PHI
    1610612761: ("Eastern", "Atlantic"),  # TOR
    1610612741: ("Eastern", "Central"),  # CHI
    1610612739: ("Eastern", "Central"),  # CLE
    1610612765: ("Eastern", "Central"),  # DET
    1610612754: ("Eastern", "Central"),  # IND
    1610612749: ("Eastern", "Central"),  # MIL
    1610612737: ("Eastern", "Southeast"),  # ATL
    1610612766: ("Eastern", "Southeast"),  # CHA
    1610612748: ("Eastern", "Southeast"),  # MIA
    1610612753: ("Eastern", "Southeast"),  # ORL
    1610612764: ("Eastern", "Southeast"),  # WAS
    # Western
    1610612743: ("Western", "Northwest"),  # DEN
    1610612750: ("Western", "Northwest"),  # MIN
    1610612760: ("Western", "Northwest"),  # OKC
    1610612757: ("Western", "Northwest"),  # POR
    1610612762: ("Western", "Northwest"),  # UTA
    1610612744: ("Western", "Pacific"),  # GSW
    1610612746: ("Western", "Pacific"),  # LAC
    1610612747: ("Western", "Pacific"),  # LAL
    1610612756: ("Western", "Pacific"),  # PHX
    1610612758: ("Western", "Pacific"),  # SAC
    1610612742: ("Western", "Southwest"),  # DAL
    1610612745: ("Western", "Southwest"),  # HOU
    1610612763: ("Western", "Southwest"),  # MEM
    1610612740: ("Western", "Southwest"),  # NOP
    1610612759: ("Western", "Southwest"),  # SAS
}

# nba.com GAME_ID's first digit. None means "not stored": counted, skipped.
_PRESEASON = "1"
_ALL_STAR = "3"
_STORED_GAME_TYPES = {"2": "regular", "4": "playoffs", "5": "play-in"}

_SEASON_PATTERN = re.compile(r"^\d{4}-\d{2}$")

_TEAMS_COLUMNS = ("TEAM_ID", "ABBREVIATION", "NICKNAME", "CITY")
_GAMES_COLUMNS = (
    "GAME_DATE_EST",
    "GAME_ID",
    "HOME_TEAM_ID",
    "VISITOR_TEAM_ID",
    "SEASON",
    "PTS_home",
    "PTS_away",
)
_DETAILS_COLUMNS = (
    "GAME_ID",
    "TEAM_ID",
    "PLAYER_ID",
    "PLAYER_NAME",
    "START_POSITION",
    "PTS",
    "REB",
    "AST",
)


class DatasetError(ValueError):
    """The dataset (or the requested season list) is not what the loader
    can store faithfully: a missing file or column, a malformed value, a team
    with no known conference, an unknown game type, or duplicate game rows
    that disagree. Raised before anything is written, or rolled back."""


@dataclass(frozen=True)
class SeasonReport:
    season: str
    loaded: int
    already_present: int
    skipped_preseason: int
    skipped_all_star: int
    skipped_no_score: int
    duplicate_game_rows: int
    duplicate_player_rows: int


@dataclass(frozen=True)
class LoadReport:
    teams_created: int
    seasons: dict[str, SeasonReport]

    def lines(self) -> list[str]:
        """One human-readable line per season, oldest first."""
        return [
            f"{s.season}: loaded {s.loaded}, already present {s.already_present}, "
            f"skipped {s.skipped_preseason} preseason / {s.skipped_all_star} All-Star / "
            f"{s.skipped_no_score} no score; duplicate rows ignored: "
            f"{s.duplicate_game_rows} game, {s.duplicate_player_rows} player"
            for s in self.seasons.values()
        ]


@dataclass
class _SeasonCounts:
    loaded: int = 0
    already_present: int = 0
    skipped_preseason: int = 0
    skipped_all_star: int = 0
    skipped_no_score: int = 0
    duplicate_game_rows: int = 0
    duplicate_player_rows: int = 0

    def freeze(self, season: str) -> SeasonReport:
        return SeasonReport(season=season, **self.__dict__)


@dataclass(frozen=True)
class _TeamRow:
    nba_team_id: int
    name: str
    abbreviation: str
    conference: str
    division: str


@dataclass(frozen=True)
class _GameRow:
    nba_game_id: int
    date: datetime
    season: str
    home_nba_team_id: int
    away_nba_team_id: int
    home_score: int | None
    away_score: int | None


@dataclass
class _StoredGame:
    """A game this run will store (or finds already stored), with its box
    score still keyed by nba.com team ids until Team rows exist."""

    row: _GameRow
    game_type: str
    home_score: int
    away_score: int
    player_rows: list[dict[str, Any]] = field(default_factory=list)
    player_ids: set[str] = field(default_factory=set)


def load_nba_history(
    session: Session, data_dir: str | Path, seasons: Collection[str] | None = None
) -> LoadReport:
    """Load teams.csv, games.csv and games_details.csv from `data_dir`.

    `seasons` ("YYYY-YY") limits which games are processed and reported;
    every team is stored regardless. Commits once on success; on any
    exception rolls back the whole run and re-raises.
    """
    try:
        wanted = _validate_seasons(seasons)
        data_dir = Path(data_dir)

        teams = _read_teams(data_dir / "teams.csv")
        counts: dict[str, _SeasonCounts] = {season: _SeasonCounts() for season in wanted or ()}
        stored = _read_games(data_dir / "games.csv", wanted, counts)
        for game in stored.values():
            for team_id in (game.row.home_nba_team_id, game.row.away_nba_team_id):
                _require_team(teams, team_id, f"game {game.row.nba_game_id}")
        _read_details(data_dir / "games_details.csv", stored, teams, counts)

        team_ids, teams_created = _upsert_teams(session, teams.values())
        _insert_games(session, stored, team_ids, counts)

        session.commit()
    except Exception:
        session.rollback()
        raise

    return LoadReport(
        teams_created=teams_created,
        seasons={season: counts[season].freeze(season) for season in sorted(counts)},
    )


# --------------------------------------------------------------------- reading


def _validate_seasons(seasons: Collection[str] | None) -> set[str] | None:
    if seasons is None:
        return None
    for season in seasons:
        if not _SEASON_PATTERN.match(season):
            raise DatasetError(f"season {season!r} is not 'YYYY-YY' (e.g. '2019-20')")
        start, end = season.split("-")
        if (int(start) + 1) % 100 != int(end):
            raise DatasetError(f"season {season!r}: {end} does not follow {start}")
    return set(seasons)


def _rows(path: Path, required: tuple[str, ...]) -> Iterator[dict[str, str]]:
    """Every row of a dataset CSV, after checking its header carries the
    columns the loader reads. A missing file or column is a DatasetError so
    the CLI reports it as a data problem, not a crash."""
    try:
        f = path.open(newline="", encoding="utf-8")
    except FileNotFoundError as exc:
        raise DatasetError(f"{path} not found") from exc
    with f:
        reader = csv.DictReader(f)
        missing = [column for column in required if column not in (reader.fieldnames or [])]
        if missing:
            raise DatasetError(f"{path.name} is missing column(s): {', '.join(missing)}")
        yield from reader


def _int(value: str, what: str) -> int:
    """The dataset writes numbers both as "130" and "130.0"."""
    try:
        return int(float(value))
    except ValueError as exc:
        raise DatasetError(f"{what}: {value!r} is not a number") from exc


def _read_teams(path: Path) -> dict[int, _TeamRow]:
    teams: dict[int, _TeamRow] = {}
    for row in _rows(path, _TEAMS_COLUMNS):
        nba_team_id = _int(row["TEAM_ID"], f"{path.name} TEAM_ID")
        alignment = _ALIGNMENT.get(nba_team_id)
        if alignment is None:
            raise DatasetError(
                f"{path.name}: team {nba_team_id} ({row['ABBREVIATION']}) has no known "
                "conference/division"
            )
        teams[nba_team_id] = _TeamRow(
            nba_team_id=nba_team_id,
            name=f"{row['CITY']} {row['NICKNAME']}",
            abbreviation=row["ABBREVIATION"],
            conference=alignment[0],
            division=alignment[1],
        )
    return teams


def _season_label(value: str) -> str:
    """SEASON is the start year: 2019 -> "2019-20", 1999 -> "1999-00"."""
    start = _int(value, "games.csv SEASON")
    return f"{start}-{(start + 1) % 100:02d}"


def _parse_game(row: dict[str, str]) -> _GameRow:
    nba_game_id = _int(row["GAME_ID"], "games.csv GAME_ID")
    try:
        date = datetime.strptime(row["GAME_DATE_EST"], "%Y-%m-%d")
    except ValueError as exc:
        raise DatasetError(
            f"game {nba_game_id}: GAME_DATE_EST {row['GAME_DATE_EST']!r} is not YYYY-MM-DD"
        ) from exc
    return _GameRow(
        nba_game_id=nba_game_id,
        date=date,
        season=_season_label(row["SEASON"]),
        home_nba_team_id=_int(row["HOME_TEAM_ID"], f"game {nba_game_id} HOME_TEAM_ID"),
        away_nba_team_id=_int(row["VISITOR_TEAM_ID"], f"game {nba_game_id} VISITOR_TEAM_ID"),
        home_score=_score(row["PTS_home"], nba_game_id),
        away_score=_score(row["PTS_away"], nba_game_id),
    )


def _score(value: str, nba_game_id: int) -> int | None:
    return None if not value.strip() else _int(value, f"game {nba_game_id} score")


def _read_games(
    path: Path, wanted: set[str] | None, counts: dict[str, _SeasonCounts]
) -> dict[int, _StoredGame]:
    """The in-scope games this run stores, keyed by nba_game_id. Counts
    duplicates and every skip into `counts`, creating a season's entry the
    first time one of its games is seen."""
    first_rows: dict[int, _GameRow] = {}
    for raw in _rows(path, _GAMES_COLUMNS):
        game = _parse_game(raw)
        if wanted is not None and game.season not in wanted:
            continue
        season_counts = counts.setdefault(game.season, _SeasonCounts())

        first = first_rows.get(game.nba_game_id)
        if first is None:
            first_rows[game.nba_game_id] = game
            continue
        # The dataset repeats some games, differing only in derived columns
        # (percentages). A repeat that disagrees on what is stored is not a
        # duplicate but a contradiction, and picking one would be a guess.
        if first != game:
            raise DatasetError(
                f"games.csv has conflicting rows for game {game.nba_game_id}: {first} vs {game}"
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
            raise DatasetError(f"game {game.nba_game_id}: unknown GAME_ID type prefix {prefix!r}")
        if game.home_score is None or game.away_score is None:
            season_counts.skipped_no_score += 1
            continue
        stored[game.nba_game_id] = _StoredGame(
            row=game, game_type=game_type, home_score=game.home_score, away_score=game.away_score
        )
    return stored


def _require_team(teams: dict[int, _TeamRow], nba_team_id: int, where: str) -> None:
    if nba_team_id not in teams:
        raise UnrecognizedTeamError(
            f"{where} names team {nba_team_id}, which is not in teams.csv -- Team must be "
            "seeded before Game import, see wiki/CodeContext/Modules/0x02-events.md."
        )


def _read_details(
    path: Path,
    stored: dict[int, _StoredGame],
    teams: dict[int, _TeamRow],
    counts: dict[str, _SeasonCounts],
) -> None:
    """Attach each stored game's box score, in one pass over the file.

    A row with a blank PTS is a player who did not play (DNP) and is left
    out. START_POSITION is kept exactly as the data says (F/C/G for starters)
    and None for the bench: a position is never inferred.
    """
    for row in _rows(path, _DETAILS_COLUMNS):
        game = stored.get(_int(row["GAME_ID"], "games_details.csv GAME_ID"))
        if game is None:
            continue
        team_id = _int(row["TEAM_ID"], f"game {game.row.nba_game_id} box score TEAM_ID")
        _require_team(teams, team_id, f"box score of game {game.row.nba_game_id}")
        if not row["PTS"].strip():
            continue
        if row["PLAYER_ID"] in game.player_ids:
            counts[game.row.season].duplicate_player_rows += 1
            continue
        game.player_ids.add(row["PLAYER_ID"])
        what = f"game {game.row.nba_game_id} player {row['PLAYER_ID']}"
        game.player_rows.append(
            {
                "player_name": row["PLAYER_NAME"],
                "nba_team_id": team_id,
                "points": _int(row["PTS"], f"{what} PTS"),
                "rebounds": _int(row["REB"], f"{what} REB"),
                "assists": _int(row["AST"], f"{what} AST"),
                "position": row["START_POSITION"].strip() or None,
            }
        )


# --------------------------------------------------------------------- writing


def _batches(items: list[Any]) -> Iterable[list[Any]]:
    for start in range(0, len(items), _BATCH_SIZE):
        yield items[start : start + _BATCH_SIZE]


def _upsert_teams(session: Session, teams: Iterable[_TeamRow]) -> tuple[dict[int, int], int]:
    """Create every team not already stored (matched by nba_team_id); an
    existing row is left as it is. Returns nba_team_id -> Team.id and how
    many were created."""
    team_rows = list(teams)
    existing = {
        nba_team_id: team_id
        for nba_team_id, team_id in session.execute(
            select(Team.nba_team_id, Team.id).where(
                Team.nba_team_id.in_([t.nba_team_id for t in team_rows])
            )
        ).all()
        if nba_team_id is not None
    }
    created = {
        t.nba_team_id: Team(
            nba_team_id=t.nba_team_id,
            name=t.name,
            abbreviation=t.abbreviation,
            conference=t.conference,
            division=t.division,
        )
        for t in team_rows
        if t.nba_team_id not in existing
    }
    session.add_all(created.values())
    session.flush()  # populate Team.id for the games below
    existing.update({nba_team_id: team.id for nba_team_id, team in created.items()})
    return existing, len(created)


def _existing_game_ids(session: Session, nba_game_ids: list[int]) -> set[int]:
    found: set[int] = set()
    for batch in _batches(nba_game_ids):
        found.update(
            game_id
            for game_id in session.scalars(
                select(Game.nba_game_id).where(Game.nba_game_id.in_(batch))
            ).all()
            if game_id is not None
        )
    return found


def _insert_games(
    session: Session,
    stored: dict[int, _StoredGame],
    team_ids: dict[int, int],
    counts: dict[str, _SeasonCounts],
) -> None:
    already = _existing_game_ids(session, list(stored))
    new_games: list[Game] = []
    for nba_game_id, game in stored.items():
        season_counts = counts[game.row.season]
        if nba_game_id in already:
            season_counts.already_present += 1
            continue
        season_counts.loaded += 1
        row = game.row
        new_games.append(
            Game(
                nba_game_id=nba_game_id,
                game_type=game.game_type,
                home_team_id=team_ids[row.home_nba_team_id],
                away_team_id=team_ids[row.away_nba_team_id],
                date=row.date,
                season=row.season,
                home_score=game.home_score,
                away_score=game.away_score,
                venue=None,
                player_stats=[
                    {
                        "player_name": p["player_name"],
                        "team_id": team_ids[p["nba_team_id"]],
                        "points": p["points"],
                        "rebounds": p["rebounds"],
                        "assists": p["assists"],
                        "position": p["position"],
                    }
                    for p in game.player_rows
                ],
            )
        )
    for batch in _batches(new_games):
        session.add_all(batch)
        session.flush()
