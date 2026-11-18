"""app.events.refresh_handler.handler -- the SportsDataRefresh Lambda (EVENTS-008).

A daily EventBridge rule runs it, outside the VPC: it needs Kaggle and AWS
APIs and never the database, so it has no DATABASE_URL and reads its three
settings from the environment directly. It downloads Games.csv,
PlayerStatistics.csv, TeamStatistics.csv, Players.csv and the season's
LeagueSchedule<YY>_<YY>.csv, one file at a time, into the sports-data
bucket's `nba-eoin/` prefix, then invokes SportsDataLoad asynchronously for
the season(s). The bucket is the one input the manual load path reads too.

In order:

1. The event: `{}` or an EventBridge scheduled event means the current
   season (America/Toronto date; from 1 October a date belongs to the season
   beginning that year); `{"seasons": [...]}` names seasons itself. Anything
   else raises InvalidRefreshEvent before any AWS call, as does an unset
   SPORTS_DATA_BUCKET, KAGGLE_SECRET_ARN or LOAD_FUNCTION_NAME.
2. The Kaggle token is read from Secrets Manager at invocation and set as
   KAGGLE_API_TOKEN for this process only; KAGGLE_USERNAME and KAGGLE_KEY are
   removed so the token is the one credential kagglehub can find.
3. Per file: fetch, check, upload, delete the local copy. The bucket is not
   versioned, so a bad download must never replace a good copy: the file must
   be non-empty, its header line must equal the existing object's (with none,
   it must carry the columns the loader requires) and it must not be smaller.
   Otherwise DatasetRefreshRejected, nothing further is uploaded and nothing
   is invoked. A schedule file the dataset lacks is skipped.
4. Last, SportsDataLoad is invoked (InvocationType Event, no retry).

**It raises on failure** and **never emits the token**: every failure is
re-raised `from None` with the token redacted, and nothing here logs it.
"""

from __future__ import annotations

import csv
import json
import logging
import os
import tempfile
from datetime import date, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import boto3  # type: ignore[import-untyped]  # no boto3 stubs/py.typed marker installed
from aws_lambda_powertools import Logger
from botocore.exceptions import ClientError  # type: ignore[import-untyped]

from app.events.dataset import DatasetError
from app.events.kaggle_source import (
    DatasetFileNotFound,
    DatasetSource,
    KagglehubSource,
    redact_token,
)
from app.events.nba_history import REQUIRED_COLUMNS, validate_seasons
from app.events.schedule import SCHEDULE_COLUMNS, schedule_file_name

__all__ = [
    "DatasetRefreshRejected",
    "InvalidRefreshEvent",
    "SportsDataRefreshFailed",
    "current_season",
    "handler",
]

logger = Logger()

_PREFIX = "nba-eoin/"
_FILES = tuple(REQUIRED_COLUMNS)
_NOT_FOUND_CODES = frozenset({"404", "NoSuchKey", "NotFound"})
_SEASON_STARTS_IN_MONTH = 10
_EVENT_SHAPE = 'the event must be {} or {"seasons": ["YYYY-YY", ...]}'


class InvalidRefreshEvent(ValueError):
    """The event is not `{}`, a scheduled event or `{"seasons": [...]}`."""


class SportsDataRefreshFailed(RuntimeError):
    """The refresh did not complete; the load was not invoked."""


class DatasetRefreshRejected(SportsDataRefreshFailed):
    """A downloaded file failed the guard; the bucket's copy is untouched."""


def current_season(today: date) -> str:
    """The season a date belongs to: "2026-27" from 1 October 2026."""
    start = today.year if today.month >= _SEASON_STARTS_IN_MONTH else today.year - 1
    return f"{start}-{(start + 1) % 100:02d}"


def _is_scheduled(event: dict[str, Any]) -> bool:
    return event == {} or (
        event.get("source") == "aws.events" and event.get("detail-type") == "Scheduled Event"
    )


def _seasons(event: Any) -> list[str]:
    if not isinstance(event, dict):
        raise InvalidRefreshEvent(_EVENT_SHAPE)
    if _is_scheduled(event):
        return [current_season(datetime.now(ZoneInfo("America/Toronto")).date())]
    if set(event) != {"seasons"}:
        raise InvalidRefreshEvent(_EVENT_SHAPE)
    seasons = event["seasons"]
    if (
        not isinstance(seasons, list)
        or not seasons
        or not all(isinstance(season, str) for season in seasons)
    ):
        raise InvalidRefreshEvent('"seasons" must be a non-empty list of "YYYY-YY" strings')
    if len(set(seasons)) != len(seasons):
        raise InvalidRefreshEvent('"seasons" lists a season more than once')
    try:
        validate_seasons(seasons)
    except DatasetError as exc:
        raise InvalidRefreshEvent(str(exc)) from None
    return sorted(seasons)


def _config() -> tuple[str, str, str]:
    values = []
    for name in ("SPORTS_DATA_BUCKET", "KAGGLE_SECRET_ARN", "LOAD_FUNCTION_NAME"):
        value = os.environ.get(name)
        if not value:
            raise SportsDataRefreshFailed(f"{name} is not set")
        values.append(value)
    return values[0], values[1], values[2]


def _existing(s3: Any, bucket: str, key: str) -> tuple[int, bytes] | None:
    """(size, first line) of the object in the bucket, or None when there is
    none. Only a 404 means none: anything else (a denied request) fails."""
    try:
        head = s3.head_object(Bucket=bucket, Key=key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in _NOT_FOUND_CODES:
            return None
        raise
    body = s3.get_object(Bucket=bucket, Key=key)["Body"]
    try:
        first_line = next(iter(body.iter_lines()), b"")
    finally:
        body.close()
    return head["ContentLength"], first_line.rstrip(b"\r")


def _header(path: Path) -> bytes:
    with path.open("rb") as f:
        return f.readline().rstrip(b"\r\n")


def _check(s3: Any, bucket: str, name: str, path: Path) -> None:
    """Raise DatasetRefreshRejected unless `path` may replace the bucket's copy."""
    size = path.stat().st_size
    existing = _existing(s3, bucket, f"{_PREFIX}{name}")
    stored = "none" if existing is None else str(existing[0])

    def rejected(why: str) -> DatasetRefreshRejected:
        return DatasetRefreshRejected(
            f"{name} rejected, {why}: downloaded {size} bytes, bucket copy {stored} bytes"
        )

    if size == 0:
        raise rejected("it is empty")
    header = _header(path)
    if existing is not None:
        if header != existing[1]:
            raise rejected("its header differs from the bucket copy's")
        if size < existing[0]:
            raise rejected("it is smaller than the bucket copy")
        return
    required = REQUIRED_COLUMNS.get(name, SCHEDULE_COLUMNS)
    columns = next(csv.reader([header.decode("utf-8", errors="replace")]), [])
    missing = [column for column in required if column not in columns]
    if missing:
        raise rejected(f"its header lacks {', '.join(missing)}")


def _read_token(arn: str) -> None:
    secrets = boto3.client("secretsmanager")
    # botocore logs response bodies at DEBUG; this one is the token.
    botocore_log = logging.getLogger("botocore")
    previous = botocore_log.level
    botocore_log.setLevel(logging.WARNING)
    try:
        token = secrets.get_secret_value(SecretId=arn)["SecretString"].strip()
    finally:
        botocore_log.setLevel(previous)
    os.environ["KAGGLE_API_TOKEN"] = token
    os.environ.pop("KAGGLE_USERNAME", None)
    os.environ.pop("KAGGLE_KEY", None)


def _refresh(
    seasons: list[str], source: DatasetSource, lambda_client: Any | None
) -> dict[str, Any]:
    bucket, secret_arn, load_function = _config()
    _read_token(secret_arn)
    s3 = boto3.client("s3")
    uploaded: list[str] = []
    schedules: dict[str, str] = {}

    def transfer(name: str, dest_dir: Path) -> None:
        path = source.fetch(name, dest_dir)
        _check(s3, bucket, name, path)
        s3.upload_file(str(path), bucket, f"{_PREFIX}{name}")
        path.unlink()
        uploaded.append(name)

    with tempfile.TemporaryDirectory(prefix="sports-refresh-") as tmp:
        dest_dir = Path(tmp)
        for name in _FILES:
            transfer(name, dest_dir)
        for season in seasons:
            name = schedule_file_name(season)
            try:
                transfer(name, dest_dir)
                schedules[name] = "uploaded"
            except DatasetFileNotFound:
                logger.info("the dataset has no schedule file", extra={"file": name})
                schedules[name] = "not in the dataset"

    (lambda_client or boto3.client("lambda")).invoke(
        FunctionName=load_function,
        InvocationType="Event",
        Payload=json.dumps({"seasons": seasons}).encode(),
    )
    logger.info("sports data refreshed; load invoked", extra={"seasons": seasons})
    return {"season_list": seasons, "uploaded": uploaded, "schedules": schedules}


def handler(
    event: Any,
    context: Any,
    *,
    source: DatasetSource | None = None,
    lambda_client: Any | None = None,
) -> dict[str, Any]:
    """Refresh the bucket from the dataset and invoke the load.

    Raises InvalidRefreshEvent for a bad event, DatasetRefreshRejected when a
    file fails the guard, SportsDataRefreshFailed for anything else.
    """
    seasons = _seasons(event)
    try:
        return _refresh(seasons, source or KagglehubSource(), lambda_client)
    except SportsDataRefreshFailed:
        raise
    # Blind on purpose: anything the source, boto3 or Secrets Manager raises
    # may quote the token, so all of it is redacted and re-raised.
    except Exception as exc:  # noqa: BLE001
        reason = f"{type(exc).__name__}: {redact_token(str(exc))}"
        logger.error("sports data refresh failed", extra={"reason": reason})
        raise SportsDataRefreshFailed(f"sports data refresh failed -- {reason}") from None
