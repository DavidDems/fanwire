"""Tests for app.events.load_handler, the SportsDataLoad Lambda (EVENTS-002).

A human invokes it with {"seasons": [...]} after uploading the dataset's
four CSVs to the sports-data bucket's nba-eoin/ prefix. It validates the
event before touching S3 or the database, takes a Postgres advisory lock
(the AWS CLI retries an invoke on its read timeout, which would otherwise
start a second load), downloads the four files to a temporary directory,
runs app.events.nba_history.load_nba_history and returns the report. Any
failure raises, with the database URL redacted and the cause chain broken,
the way app.migrate does. Spec: .ai/tasks/EVENTS-002/.

S3 is moto; the database is the suite's shared Postgres; the dataset is the
synthetic fixture tests/events/test_nba_history.py uses (seasons 2024-25 and
2025-26), never the real one.
"""

from __future__ import annotations

import csv
import json
import logging
import tempfile
from pathlib import Path

import boto3
import pytest
from moto import mock_aws
from sqlalchemy import func, select, text

from app import migrate
from app.db import Base, make_engine, make_session_factory
from app.events import load_handler
from app.events.models import Game, Team

_BACKEND_DIR = Path(__file__).resolve().parents[2]
FIXTURE_DIR = _BACKEND_DIR / "tests" / "fixtures" / "nba_data"
FILES = ("Games.csv", "PlayerStatistics.csv", "TeamStatistics.csv", "Players.csv")
BUCKET = "fanwire-sports-data-test"
REGION = "ca-central-1"
SEASONS = ["2024-25", "2025-26"]


# --------------------------------------------------------------------- fixtures


@pytest.fixture()
def engine(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def env(monkeypatch, tmp_path, postgres_url, engine):
    """The function's environment: DATABASE_URL and SPORTS_DATA_BUCKET, fake
    AWS credentials, and a working directory with no .env in it."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", postgres_url)
    monkeypatch.setenv("SPORTS_DATA_BUCKET", BUCKET)
    monkeypatch.setenv("AWS_DEFAULT_REGION", REGION)
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    return postgres_url


@pytest.fixture()
def scratch(monkeypatch, tmp_path):
    """The system temp dir the handler downloads under, empty to start."""
    root = tmp_path / "systemp"
    root.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(root))
    return root


@pytest.fixture()
def s3(env):
    with mock_aws():
        client = boto3.client("s3", region_name=REGION)
        client.create_bucket(
            Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": REGION}
        )
        yield client


def _upload(client, source: Path = FIXTURE_DIR, files=FILES) -> None:
    for name in files:
        client.upload_file(str(source / name), BUCKET, f"nba-eoin/{name}")


@pytest.fixture()
def uploaded(s3):
    _upload(s3)
    return s3


def _counts(engine) -> tuple[int, int]:
    with make_session_factory(engine)() as session:
        return (
            session.scalar(select(func.count()).select_from(Team)),
            session.scalar(select(func.count()).select_from(Game)),
        )


def _no_aws(monkeypatch):
    """Make any boto3 client creation fail the test."""

    def _refuse(*args, **kwargs):
        raise AssertionError("the handler called AWS before validating its input")

    monkeypatch.setattr(load_handler.boto3, "client", _refuse)
    monkeypatch.setattr(load_handler.boto3, "resource", _refuse)


def _no_database(monkeypatch):
    def _refuse(*args, **kwargs):
        raise AssertionError("the handler connected to the database before validating its input")

    monkeypatch.setattr(load_handler, "make_engine", _refuse)


# ---------------------------------------------------------------- the event


@pytest.mark.parametrize(
    "event",
    [
        {},
        {"seasons": []},
        {"seasons": "2025-26"},
        {"seasons": None},
        {"seasons": [2025]},
        {"seasons": ["2025"]},
        {"seasons": ["2025-27"]},
        {"seasons": ["2002-03"]},
        {"seasons": ["2025-26", "2025-26"]},
        {"seasons": ["2025-26"], "data_dir": "/etc"},
        {"Seasons": ["2025-26"]},
        ["2025-26"],
        None,
    ],
    ids=[
        "empty",
        "empty-list",
        "a-string",
        "null",
        "not-a-string",
        "malformed",
        "not-consecutive",
        "before-2003-04",
        "duplicate",
        "unknown-key",
        "wrong-case-key",
        "not-an-object",
        "no-event",
    ],
)
def test_a_bad_event_raises_before_any_aws_call_or_connection(env, monkeypatch, event):
    _no_aws(monkeypatch)
    _no_database(monkeypatch)

    with pytest.raises(load_handler.InvalidLoadEvent):
        load_handler.handler(event, None)


def test_an_invalid_event_is_a_value_error():
    assert issubclass(load_handler.InvalidLoadEvent, ValueError)


# --------------------------------------------------------------- a real load


def test_loads_the_seasons_and_returns_the_report(env, engine, uploaded, scratch):
    result = load_handler.handler({"seasons": SEASONS}, None)

    # JSON-serialisable, as a Lambda return value must be.
    result = json.loads(json.dumps(result))
    assert result["teams_created"] == 30
    assert result["players_created"] > 0
    assert sorted(result["seasons"]) == SEASONS
    assert result["seasons"]["2024-25"]["games_loaded"] > 0
    assert result["seasons"]["2024-25"]["box_score_rows_loaded"] > 0
    teams, games = _counts(engine)
    assert teams == 30
    assert games == sum(s["games_loaded"] for s in result["seasons"].values())


def test_only_the_requested_seasons_are_loaded(env, engine, uploaded, scratch):
    result = load_handler.handler({"seasons": ["2025-26"]}, None)

    assert list(result["seasons"]) == ["2025-26"]
    with make_session_factory(engine)() as session:
        seasons = set(session.scalars(select(Game.season).distinct()))
    assert seasons == {"2025-26"}


def test_a_second_run_writes_nothing_new(env, engine, uploaded, scratch):
    load_handler.handler({"seasons": SEASONS}, None)
    before = _counts(engine)

    again = load_handler.handler({"seasons": SEASONS}, None)

    assert _counts(engine) == before
    assert again["teams_created"] == 0
    assert all(s["games_loaded"] == 0 for s in again["seasons"].values())


def test_downloads_exactly_the_four_files_from_the_prefix(env, uploaded, scratch, monkeypatch):
    # Decoys: the dataset's other files, and the same names outside the prefix.
    uploaded.put_object(Bucket=BUCKET, Key="nba-eoin/PlayerStatisticsExtended.csv", Body=b"x")
    uploaded.put_object(Bucket=BUCKET, Key="Games.csv", Body=b"not this one")
    seen: dict[str, object] = {}

    def fake_load(session, data_dir, seasons=None):
        data_dir = Path(data_dir)
        seen["dir"] = data_dir
        seen["files"] = sorted(p.name for p in data_dir.iterdir())
        seen["games_csv"] = (data_dir / "Games.csv").read_bytes()
        seen["seasons"] = sorted(seasons)
        return load_handler.LoadReport(teams_created=0, players_created=0, seasons={})

    monkeypatch.setattr(load_handler, "load_nba_history", fake_load)

    load_handler.handler({"seasons": SEASONS}, None)

    assert seen["files"] == sorted(FILES)
    assert seen["games_csv"] == (FIXTURE_DIR / "Games.csv").read_bytes()
    assert seen["seasons"] == SEASONS
    # Under the system temp dir, in a directory of its own.
    assert Path(seen["dir"]).parent == scratch


def test_the_temporary_directory_is_removed_after_a_load(env, uploaded, scratch):
    load_handler.handler({"seasons": ["2025-26"]}, None)

    assert list(scratch.iterdir()) == []


# ------------------------------------------------------------------- failures


def test_a_missing_object_fails_the_invocation_and_writes_nothing(env, engine, s3, scratch):
    _upload(s3, files=FILES[:3])

    with pytest.raises(load_handler.SportsDataLoadFailed) as raised:
        load_handler.handler({"seasons": SEASONS}, None)

    assert "Players.csv" in str(raised.value)
    assert _counts(engine) == (0, 0)
    assert list(scratch.iterdir()) == []


def test_a_dataset_error_fails_the_invocation_and_writes_nothing(
    env, engine, s3, scratch, tmp_path
):
    broken = tmp_path / "broken"
    broken.mkdir()
    for name in FILES:
        (broken / name).write_bytes((FIXTURE_DIR / name).read_bytes())
    # Games.csv without its homeScore column, which the loader requires: a DatasetError.
    with (FIXTURE_DIR / "Games.csv").open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        header = [c for c in reader.fieldnames or [] if c != "homeScore"]
        rows = [{k: v for k, v in row.items() if k != "homeScore"} for row in reader]
    with (broken / "Games.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=header, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    _upload(s3, source=broken)

    with pytest.raises(load_handler.SportsDataLoadFailed) as raised:
        load_handler.handler({"seasons": SEASONS}, None)

    assert "DatasetError" in str(raised.value)
    assert _counts(engine) == (0, 0)
    assert list(scratch.iterdir()) == []


def test_an_unset_bucket_fails_before_any_aws_call(env, monkeypatch):
    monkeypatch.delenv("SPORTS_DATA_BUCKET")
    _no_aws(monkeypatch)

    with pytest.raises(load_handler.SportsDataLoadFailed) as raised:
        load_handler.handler({"seasons": SEASONS}, None)

    assert "SPORTS_DATA_BUCKET" in str(raised.value)


def test_an_unset_database_url_fails_before_any_aws_call(env, monkeypatch):
    monkeypatch.delenv("DATABASE_URL")
    _no_aws(monkeypatch)

    with pytest.raises(load_handler.SportsDataLoadFailed) as raised:
        load_handler.handler({"seasons": SEASONS}, None)

    assert "DATABASE_URL" in str(raised.value)


def test_failures_raise_rather_than_return_an_error_value():
    assert issubclass(load_handler.SportsDataLoadFailed, Exception)
    assert not issubclass(load_handler.InvalidLoadEvent, load_handler.SportsDataLoadFailed)


# ------------------------------------------------------------------ the lock


def test_the_load_lock_is_its_own_key():
    assert isinstance(load_handler.LOAD_LOCK_KEY, int)
    assert load_handler.LOAD_LOCK_KEY != migrate.MIGRATION_LOCK_KEY


def test_a_second_load_fails_fast_while_one_holds_the_lock(env, engine, uploaded, scratch):
    with engine.connect() as holder:
        assert holder.execute(
            text("SELECT pg_try_advisory_lock(:key)"), {"key": load_handler.LOAD_LOCK_KEY}
        ).scalar()

        with pytest.raises(load_handler.SportsDataLoadLocked) as raised:
            load_handler.handler({"seasons": SEASONS}, None)

        holder.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": load_handler.LOAD_LOCK_KEY})

    assert "already running" in str(raised.value)
    assert issubclass(load_handler.SportsDataLoadLocked, load_handler.SportsDataLoadFailed)
    assert _counts(engine) == (0, 0)
    assert list(scratch.iterdir()) == []


def test_the_lock_is_held_during_the_load_and_released_after(
    env, engine, uploaded, scratch, monkeypatch
):
    held: list[bool] = []
    real_load = load_handler.load_nba_history

    def spying_load(session, data_dir, seasons=None):
        with engine.connect() as probe:
            got = probe.execute(
                text("SELECT pg_try_advisory_lock(:key)"), {"key": load_handler.LOAD_LOCK_KEY}
            ).scalar()
            if got:
                probe.execute(
                    text("SELECT pg_advisory_unlock(:key)"), {"key": load_handler.LOAD_LOCK_KEY}
                )
        held.append(not got)
        return real_load(session, data_dir, seasons)

    monkeypatch.setattr(load_handler, "load_nba_history", spying_load)

    load_handler.handler({"seasons": ["2025-26"]}, None)

    assert held == [True]
    with engine.connect() as after:
        assert after.execute(
            text("SELECT pg_try_advisory_lock(:key)"), {"key": load_handler.LOAD_LOCK_KEY}
        ).scalar()
        after.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": load_handler.LOAD_LOCK_KEY})


# ------------------------------------------------------- the database URL


_PASSWORD = "n0t-a-real-password-LEAKCANARY"
_UNREACHABLE_URL = f"postgresql+psycopg://loader:{_PASSWORD}@127.0.0.1:1/fanwire"


def _assert_secret_free(text_: str, secrets: tuple[str, ...], where: str) -> None:
    for secret in secrets:
        assert secret not in text_, f"{where} leaked {secret!r}"


def _assert_not_chained(exc: BaseException) -> None:
    """Lambda prints the whole cause chain: nothing may hang off it."""
    assert exc.__cause__ is None
    assert exc.__suppress_context__ is True


def test_a_failed_connection_leaks_no_credential(
    env, uploaded, scratch, monkeypatch, caplog, capsys
):
    monkeypatch.setenv("DATABASE_URL", _UNREACHABLE_URL)
    caplog.set_level(logging.DEBUG)
    secrets = (_PASSWORD, f"loader:{_PASSWORD}", _UNREACHABLE_URL)

    with pytest.raises(load_handler.SportsDataLoadFailed) as raised:
        load_handler.handler({"seasons": SEASONS}, None)

    _assert_not_chained(raised.value)
    _assert_secret_free(str(raised.value), secrets, "the exception")
    captured = capsys.readouterr()
    _assert_secret_free(caplog.text, secrets, "log records")
    _assert_secret_free(captured.out + captured.err, secrets, "stdout/stderr")


def test_a_loader_error_quoting_the_url_is_redacted(
    env, uploaded, scratch, monkeypatch, caplog, capsys
):
    url = env
    userinfo = url.split("://", 1)[1].rsplit("@", 1)[0]
    secrets = (url, f"{userinfo}@")
    caplog.set_level(logging.DEBUG)

    def leaky_load(session, data_dir, seasons=None):
        raise RuntimeError(f"could not connect to {url}: server closed the connection")

    monkeypatch.setattr(load_handler, "load_nba_history", leaky_load)

    with pytest.raises(load_handler.SportsDataLoadFailed) as raised:
        load_handler.handler({"seasons": SEASONS}, None)

    _assert_not_chained(raised.value)
    assert "RuntimeError" in str(raised.value)
    _assert_secret_free(str(raised.value), secrets, "the exception")
    captured = capsys.readouterr()
    _assert_secret_free(caplog.text, secrets, "log records")
    _assert_secret_free(captured.out + captured.err, secrets, "stdout/stderr")


def test_a_successful_load_logs_and_returns_no_credential(env, uploaded, scratch, caplog, capsys):
    url = env
    userinfo = url.split("://", 1)[1].rsplit("@", 1)[0]
    secrets = (url, f"{userinfo}@")
    caplog.set_level(logging.DEBUG)

    result = load_handler.handler({"seasons": ["2025-26"]}, None)

    _assert_secret_free(json.dumps(result), secrets, "the return value")
    captured = capsys.readouterr()
    _assert_secret_free(caplog.text, secrets, "log records")
    _assert_secret_free(captured.out + captured.err, secrets, "stdout/stderr")
