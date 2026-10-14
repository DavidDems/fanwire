"""Load NBA games, players and box scores from the Eoin Moore Kaggle dataset
into a dev database: a thin CLI over app.events.nba_history.load_nba_history.

`--data-dir` is a directory holding the dataset's Games.csv,
PlayerStatistics.csv, TeamStatistics.csv and Players.csv. The dataset lives
outside the repository and is never committed. `--season` ("YYYY-YY",
2003-04 or later, repeatable) limits the load to those seasons; default:
every season from 2003-04. Every team is stored regardless. Re-runnable: a
game that already has its box score is counted, never rewritten. One
transaction per run, so a failed run leaves the database as it was (see the
loader's module docstring and wiki/CodeContext/Modules/0x02-events.md). Load
a few seasons per run: one run holds its whole box score in memory.

This targets the local dev database only. Loading the live database is
EVENTS-002, not this script.

Usage, inside the backend-dev container (the dataset mounted or copied in):
    python scripts/load_nba_history.py --data-dir /data/nba [--season 2025-26 ...]

or from the host, from `backend/`, against the compose Postgres:
    DATABASE_URL=postgresql+psycopg://fanwire:fanwire@localhost:5432/fanwire \\
        python scripts/load_nba_history.py --data-dir <dir> [--season 2025-26 ...]

Exits 0 on success and prints what was loaded per season. A dataset problem,
or a game naming an unknown team or player, prints the message to stderr and
exits 1, with nothing written.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from app.db import make_engine, make_session_factory
from app.events.errors import UnrecognizedPlayerError, UnrecognizedTeamError
from app.events.nba_history import DatasetError, load_nba_history
from app.settings import Settings


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Load the Kaggle NBA box-score dataset into Team, Game, Player and "
        "PlayerGameStats."
    )
    parser.add_argument(
        "--data-dir",
        required=True,
        type=Path,
        help="directory holding Games.csv, PlayerStatistics.csv, TeamStatistics.csv and "
        "Players.csv",
    )
    parser.add_argument(
        "--season",
        action="append",
        dest="seasons",
        metavar="YYYY-YY",
        help="load only this season (repeatable); default: every season from 2003-04",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    engine = make_engine(Settings().database_url)
    session_factory = make_session_factory(engine)

    try:
        with session_factory() as session:
            report = load_nba_history(session, args.data_dir, seasons=args.seasons)
    except (DatasetError, UnrecognizedTeamError, UnrecognizedPlayerError) as exc:
        print(f"load failed, nothing written: {exc}", file=sys.stderr)
        return 1
    finally:
        engine.dispose()

    print(f"teams created: {report.teams_created}")
    print(f"players created: {report.players_created}")
    for line in report.lines():
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
