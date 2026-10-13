"""Load historical NBA games from the Kaggle "NBA games" dataset into a dev
database: a thin CLI over app.events.nba_history.load_nba_history.

`--data-dir` is a directory holding the dataset's teams.csv, games.csv and
games_details.csv. The dataset lives outside the repository and is never
committed. `--season` ("YYYY-YY", repeatable) limits the load to those
seasons; every team is stored regardless. Re-runnable: a game already stored
is counted, never rewritten. One transaction per run, so a failed run leaves
the database as it was (see the loader's module docstring and
wiki/CodeContext/Modules/0x02-events.md).

This targets the local dev database only. Loading the live database is
EVENTS-002, not this script.

Usage, inside the backend-dev container (the dataset mounted or copied in):
    python scripts/load_nba_history.py --data-dir /data/nba [--season 2021-22 ...]

or from the host, from `backend/`, against the compose Postgres:
    DATABASE_URL=postgresql+psycopg://fanwire:fanwire@localhost:5432/fanwire \\
        python scripts/load_nba_history.py --data-dir <dir> [--season 2021-22 ...]

Exits 0 on success and prints what was loaded per season. A dataset problem
or a game naming an unknown team prints the message to stderr and exits 1,
with nothing written.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from app.db import make_engine, make_session_factory
from app.events.ingestion import UnrecognizedTeamError
from app.events.nba_history import DatasetError, load_nba_history
from app.settings import Settings


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Load the Kaggle 'NBA games' dataset into Team and Game."
    )
    parser.add_argument(
        "--data-dir",
        required=True,
        type=Path,
        help="directory holding teams.csv, games.csv and games_details.csv",
    )
    parser.add_argument(
        "--season",
        action="append",
        dest="seasons",
        metavar="YYYY-YY",
        help="load only this season (repeatable); default: every season",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    engine = make_engine(Settings().database_url)
    session_factory = make_session_factory(engine)

    try:
        with session_factory() as session:
            report = load_nba_history(session, args.data_dir, seasons=args.seasons)
    except (DatasetError, UnrecognizedTeamError) as exc:
        print(f"load failed, nothing written: {exc}", file=sys.stderr)
        return 1
    finally:
        engine.dispose()

    print(f"teams created: {report.teams_created}")
    for line in report.lines():
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
