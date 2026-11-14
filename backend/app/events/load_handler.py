"""app.events.load_handler.handler -- the SportsDataLoad Lambda (EVENTS-002).

Loads the NBA dataset into the live database. One more command override on
the shared backend image, wired up as infra/lib/app-stack.ts's
`SportsDataLoad` function. **Nothing invokes it automatically**, like
`Migration`: the human uploads the dataset's four CSVs to the sports-data
bucket's `nba-eoin/` prefix and invokes it with `{"seasons": [...]}`
(wiki/CodeContext/Standards/build-deployment.md "Load sports data").

What it does, in order, and why:

1. **Validates the event before anything else.** Exactly one key,
   `seasons`, a non-empty list of distinct "YYYY-YY" seasons from 2003-04
   on (app.events.nba_history.validate_seasons, the loader's own rule).
   Required, by the human's decision (2026-10-14): a full reload is asked
   for on purpose, every season listed. A bad event raises InvalidLoadEvent
   before any S3 call or database connection.
2. **Reads its configuration at invocation time** (`Settings()` directly,
   as app.migrate does): an unset SPORTS_DATA_BUCKET or DATABASE_URL fails
   fast, still before AWS is called.
3. **Takes a Postgres advisory lock** (LOAD_LOCK_KEY, distinct from
   app.migrate's) for the whole load. The AWS CLI retries an invocation when
   its read timeout fires (60 s by default), which starts a second load next
   to the first; `pg_try_advisory_lock` makes that second one fail fast with
   SportsDataLoadLocked, writing nothing.
4. **Downloads exactly the four files** the loader reads into a new
   temporary directory (1024 MB of ephemeral storage; the files are ~440 MB),
   and, for each season in the event, its LeagueSchedule<YY>_<YY>.csv
   (EVENTS-014). A schedule key that does not exist (S3 404 / NoSuchKey) is
   a season with no schedule file, never a failure; any other S3 error fails
   the load like a missing dataset file. It runs load_nba_history -- one
   transaction, so a failure leaves the database as it was -- and removes
   the directory whether it succeeds or not.
5. **Returns the report** as plain JSON data, and logs one line per season.

**It raises on failure**, never returns an error value: the Lambda console
shows a returned `{"ok": false}` as a successful invocation. **It never
emits the database URL**: every failure is re-raised `from None` with its
message passed through app.migrate.redact, because Lambda prints an
unhandled exception's whole cause chain to CloudWatch and drivers put the
connect string in their messages (app.migrate's docstring has the detail).
"""

from __future__ import annotations

import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import asdict
from pathlib import Path
from typing import Any

import boto3  # type: ignore[import-untyped]  # no boto3 stubs/py.typed marker installed
from aws_lambda_powertools import Logger
from botocore.exceptions import ClientError  # type: ignore[import-untyped]
from pydantic import ValidationError
from sqlalchemy import Engine
from sqlalchemy import text as sql_text

from app.db import make_engine, make_session_factory
from app.events.dataset import DatasetError
from app.events.nba_history import LoadReport, load_nba_history, validate_seasons
from app.events.schedule import schedule_file_name
from app.migrate import redact
from app.settings import Settings

__all__ = [
    "DATASET_FILES",
    "DATASET_PREFIX",
    "LOAD_LOCK_KEY",
    "InvalidLoadEvent",
    "LoadReport",
    "SportsDataLoadFailed",
    "SportsDataLoadLocked",
    "handler",
]

logger = Logger()

#: Key for the `pg_try_advisory_lock` that serializes loads. Pinned, like
#: app.migrate.MIGRATION_LOCK_KEY, and different from it: a load and a
#: migration are different work and must not exclude each other by accident.
LOAD_LOCK_KEY = 8_315_402_771_002

#: The bucket prefix the function may read (its one S3 grant) and the four
#: files the loader needs there. The dataset's other files are never fetched.
DATASET_PREFIX = "nba-eoin/"
DATASET_FILES = ("Games.csv", "PlayerStatistics.csv", "TeamStatistics.csv", "Players.csv")


class InvalidLoadEvent(ValueError):
    """The event is not `{"seasons": ["YYYY-YY", ...]}`. Nothing was called."""


class SportsDataLoadFailed(RuntimeError):
    """The load did not complete; the database is as it was."""


class SportsDataLoadLocked(SportsDataLoadFailed):
    """Another load holds the advisory lock, so this one did not run."""


def _seasons(event: Any) -> list[str]:
    if not isinstance(event, dict) or set(event) != {"seasons"}:
        raise InvalidLoadEvent('the event must be {"seasons": ["YYYY-YY", ...]} and nothing else')
    seasons = event["seasons"]
    if (
        not isinstance(seasons, list)
        or not seasons
        or not all(isinstance(season, str) for season in seasons)
    ):
        raise InvalidLoadEvent('"seasons" must be a non-empty list of "YYYY-YY" strings')
    if len(set(seasons)) != len(seasons):
        raise InvalidLoadEvent('"seasons" lists a season more than once')
    try:
        validate_seasons(seasons)
    except DatasetError as exc:
        raise InvalidLoadEvent(str(exc)) from None
    return sorted(seasons)


def _config() -> tuple[str, str]:
    """(bucket, database URL), read now rather than cached."""
    try:
        settings = Settings()
    except ValidationError:
        # The validation error would quote the inputs it did get; it is not
        # chained, and only the missing name is reported.
        raise SportsDataLoadFailed("DATABASE_URL is not set") from None
    if not settings.sports_data_bucket:
        raise SportsDataLoadFailed("SPORTS_DATA_BUCKET is not set")
    return settings.sports_data_bucket, settings.database_url


@contextmanager
def _load_lock(engine: Engine) -> Iterator[None]:
    """Hold LOAD_LOCK_KEY for the block, on a connection of its own. A
    session-level lock: released explicitly, and by the connection closing
    if the process dies first. Same pattern as app.migrate's lock."""
    with engine.connect() as conn:
        acquired = conn.execute(
            sql_text("SELECT pg_try_advisory_lock(:key)"), {"key": LOAD_LOCK_KEY}
        ).scalar()
        if not acquired:
            raise SportsDataLoadLocked(
                f"a sports data load is already running (advisory lock {LOAD_LOCK_KEY} is held); "
                "this one did not run"
            )
        try:
            yield
        finally:
            conn.execute(sql_text("SELECT pg_advisory_unlock(:key)"), {"key": LOAD_LOCK_KEY})


#: How S3 says a key does not exist: download_file's HeadObject gives "404",
#: GetObject "NoSuchKey".
_NOT_FOUND_CODES = frozenset({"404", "NoSuchKey", "NotFound"})


def _not_found(exc: Exception) -> bool:
    return isinstance(exc, ClientError) and exc.response.get("Error", {}).get("Code") in (
        _NOT_FOUND_CODES
    )


def _download(bucket: str, data_dir: Path, seasons: list[str]) -> None:
    s3 = boto3.client("s3")
    schedules = [schedule_file_name(season) for season in seasons]
    for name in (*DATASET_FILES, *schedules):
        key = f"{DATASET_PREFIX}{name}"
        try:
            s3.download_file(bucket, key, str(data_dir / name))
        except Exception as exc:  # named, then re-raised below
            if name in schedules and _not_found(exc):
                # No schedule file for that season: the loader reports it.
                (data_dir / name).unlink(missing_ok=True)
                continue
            raise DatasetError(f"s3://{bucket}/{key} could not be downloaded: {exc}") from exc


def _as_data(report: LoadReport) -> dict[str, Any]:
    return {
        "teams_created": report.teams_created,
        "players_created": report.players_created,
        "seasons": {season: asdict(counts) for season, counts in report.seasons.items()},
        "schedules": {season: asdict(found) for season, found in report.schedules.items()},
        "lines": report.lines(),
    }


def handler(event: Any, context: Any) -> dict[str, Any]:
    """Load the requested seasons and return the loader's report.

    Raises InvalidLoadEvent for a bad event, SportsDataLoadLocked when
    another load is running, and SportsDataLoadFailed for anything else.
    """
    seasons = _seasons(event)
    bucket, database_url = _config()

    logger.info("loading sports data", extra={"seasons": seasons})
    engine = make_engine(database_url)
    try:
        with (
            _load_lock(engine),
            tempfile.TemporaryDirectory(prefix="sports-data-") as data_dir,
        ):
            _download(bucket, Path(data_dir), seasons)
            with make_session_factory(engine)() as session:
                report = load_nba_history(session, data_dir, seasons)
    except SportsDataLoadLocked as exc:
        reason = redact(str(exc), database_url)
        logger.error("sports data load did not run", extra={"reason": reason})
        raise SportsDataLoadLocked(reason) from None
    # Blind on purpose: anything the driver, boto3 or the loader raises may
    # carry the connect string, so all of it is redacted and re-raised.
    except Exception as exc:  # noqa: BLE001
        reason = f"{type(exc).__name__}: {redact(str(exc), database_url)}"
        logger.error("sports data load failed", extra={"reason": reason})
        raise SportsDataLoadFailed(f"sports data load failed -- {reason}") from None
    finally:
        engine.dispose()

    result = _as_data(report)
    for line in result["lines"]:
        logger.info(line)
    return result
