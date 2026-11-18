"""Tests for app.events.refresh_handler, the SportsDataRefresh Lambda (EVENTS-008).

A daily EventBridge rule runs it. It downloads Games.csv, PlayerStatistics.csv,
TeamStatistics.csv, Players.csv and the current season's LeagueSchedule file
one at a time from a DatasetSource into the sports-data bucket's nba-eoin/
prefix, guards the bucket's good copy (non-empty, same header, not smaller),
then invokes SportsDataLoad asynchronously for the season.

The source is a fake, S3 and Secrets Manager are moto, the Lambda client is a
recording fake, and the clock is frozen. No network, no real token, no
database: the refresh function has no DATABASE_URL.
"""

from __future__ import annotations

import json
import logging
import tempfile
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import boto3
import pytest
from freezegun import freeze_time
from moto import mock_aws

from app.events import refresh_handler
from app.events.kaggle_source import DatasetFileNotFound
from app.events.refresh_handler import (
    DatasetRefreshRejected,
    InvalidRefreshEvent,
    SportsDataRefreshFailed,
    current_season,
    handler,
)

_BACKEND_DIR = Path(__file__).resolve().parents[2]
FIXTURE_DIR = _BACKEND_DIR / "tests" / "fixtures" / "nba_data"
BUCKET = "fanwire-sports-data-test"
REGION = "ca-central-1"
LOAD_FUNCTION = "fanwire-sports-data-load-test"
TOKEN = "FAKE-TOKEN-0123"
FOUR = ("Games.csv", "PlayerStatistics.csv", "TeamStatistics.csv", "Players.csv")
SCHEDULE_25_26 = "LeagueSchedule25_26.csv"
# 2025-11-17 is in season 2025-26, whose schedule file the fixtures hold.
NOW_IN_2025_26 = "2025-11-17 15:00:00"


# --------------------------------------------------------------------- fakes


class FakeSource:
    """A DatasetSource over a dict of name -> bytes | Exception. A name it does
    not hold raises DatasetFileNotFound. Records what the world looked like at
    each fetch."""

    def __init__(self, files: dict[str, bytes | Exception]) -> None:
        self.files = files
        self.fetched: list[str] = []
        self.tokens_seen: list[str | None] = []
        self.env_seen: list[dict[str, str | None]] = []
        self.dest_listing_seen: list[list[str]] = []

    def fetch(self, file_name: str, dest_dir: Path) -> Path:
        import os

        self.fetched.append(file_name)
        self.tokens_seen.append(os.environ.get("KAGGLE_API_TOKEN"))
        self.env_seen.append(
            {key: os.environ.get(key) for key in ("KAGGLE_USERNAME", "KAGGLE_KEY")}
        )
        self.dest_listing_seen.append(sorted(p.name for p in Path(dest_dir).iterdir()))
        content = self.files.get(file_name)
        if content is None:
            raise DatasetFileNotFound(file_name)
        if isinstance(content, Exception):
            raise content
        path = Path(dest_dir) / file_name
        path.write_bytes(content)
        return path


class FakeLambda:
    """Records invoke calls, and which bucket keys existed when each was made."""

    def __init__(self, s3) -> None:
        self.s3 = s3
        self.calls: list[dict[str, object]] = []
        self.keys_at_invoke: list[set[str]] = []

    def invoke(self, **kwargs):
        self.calls.append(kwargs)
        listed = self.s3.list_objects_v2(Bucket=BUCKET, Prefix="nba-eoin/")
        self.keys_at_invoke.append({o["Key"] for o in listed.get("Contents", [])})
        return {"StatusCode": 202}


def _fixture(name: str) -> bytes:
    return (FIXTURE_DIR / name).read_bytes()


def _dataset(**overrides: bytes | Exception) -> dict[str, bytes | Exception]:
    files: dict[str, bytes | Exception] = {name: _fixture(name) for name in FOUR}
    files[SCHEDULE_25_26] = _fixture(SCHEDULE_25_26)
    files.update(overrides)
    return files


# --------------------------------------------------------------------- fixtures


@pytest.fixture()
def scratch(monkeypatch, tmp_path):
    root = tmp_path / "systemp"
    root.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(root))
    return root


@pytest.fixture()
def aws(monkeypatch, scratch):
    """Moto S3 + Secrets Manager, the environment the function is given (and
    no DATABASE_URL), the token in the secret, a clock inside 2025-26."""
    for name in (
        "DATABASE_URL",
        "KAGGLE_API_TOKEN",
        "KAGGLE_USERNAME",
        "KAGGLE_KEY",
        "AWS_PROFILE",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("AWS_DEFAULT_REGION", REGION)
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    # Settings-free: nothing may need app.settings' DATABASE_URL.
    monkeypatch.chdir(scratch)
    with mock_aws(), freeze_time(NOW_IN_2025_26):
        s3 = boto3.client("s3", region_name=REGION)
        s3.create_bucket(Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": REGION})
        secrets = boto3.client("secretsmanager", region_name=REGION)
        arn = secrets.create_secret(Name="fanwire/kaggle-api-token", SecretString=TOKEN)["ARN"]
        monkeypatch.setenv("SPORTS_DATA_BUCKET", BUCKET)
        monkeypatch.setenv("KAGGLE_SECRET_ARN", arn)
        monkeypatch.setenv("LOAD_FUNCTION_NAME", LOAD_FUNCTION)
        yield SimpleNamespace(s3=s3, secrets=secrets, arn=arn, lam=FakeLambda(s3))


def _run(aws, files=None, event=None, source=None):
    source = source or FakeSource(files if files is not None else _dataset())
    result = handler({} if event is None else event, None, source=source, lambda_client=aws.lam)
    return result, source


def _keys(aws) -> set[str]:
    listed = aws.s3.list_objects_v2(Bucket=BUCKET, Prefix="nba-eoin/")
    return {o["Key"] for o in listed.get("Contents", [])}


def _body(aws, name: str) -> bytes:
    return aws.s3.get_object(Bucket=BUCKET, Key=f"nba-eoin/{name}")["Body"].read()


def _no_aws(monkeypatch):
    def _refuse(*args, **kwargs):
        raise AssertionError("the handler called AWS before validating its input")

    monkeypatch.setattr(boto3, "client", _refuse)
    monkeypatch.setattr(boto3, "resource", _refuse)


# --------------------------------------------------------------------- current_season


@pytest.mark.parametrize(
    ("today", "season"),
    [
        (date(2026, 9, 30), "2025-26"),
        (date(2026, 10, 1), "2026-27"),
        (date(2026, 12, 31), "2026-27"),
        (date(2027, 1, 1), "2026-27"),
        (date(2026, 7, 1), "2025-26"),
        (date(2027, 9, 30), "2026-27"),
        (date(2027, 10, 1), "2027-28"),
        (date(2099, 12, 31), "2099-00"),
    ],
)
def test_current_season_boundaries(today, season):
    assert current_season(today) == season


def test_a_scheduled_run_on_30_sep_in_toronto_is_the_old_season_even_if_utc_is_1_oct(aws):
    # 02:00 UTC on 1 October is 22:00 on 30 September in Toronto (EDT, UTC-4).
    with freeze_time("2026-10-01 02:00:00"):
        result, source = _run(aws)

    assert result["season_list"] == ["2025-26"]
    assert json.loads(aws.lam.calls[0]["Payload"]) == {"seasons": ["2025-26"]}
    assert "LeagueSchedule25_26.csv" in source.fetched


def test_a_scheduled_run_after_midnight_in_toronto_is_the_new_season(aws):
    # 05:00 UTC on 1 October is 01:00 on 1 October in Toronto.
    with freeze_time("2026-10-01 05:00:00"):
        result, source = _run(aws)

    assert result["season_list"] == ["2026-27"]
    assert json.loads(aws.lam.calls[0]["Payload"]) == {"seasons": ["2026-27"]}
    assert "LeagueSchedule26_27.csv" in source.fetched


# --------------------------------------------------------------------- the event


@pytest.mark.parametrize(
    "event",
    [
        {"foo": 1},
        {"source": "aws.s3"},
        {"seasons": "2025-26"},
        {"seasons": None},
        {"seasons": [2025]},
        {"seasons": ["2025"]},
        {"seasons": ["2025-27"]},
        {"seasons": ["2002-03"]},
        {"seasons": ["2025-26"], "data_dir": "/etc"},
        {"Seasons": ["2025-26"]},
        ["2025-26"],
        "2025-26",
        None,
    ],
)
def test_a_bad_event_raises_before_any_aws_call(aws, monkeypatch, event):
    _no_aws(monkeypatch)
    source = FakeSource(_dataset())

    with pytest.raises(InvalidRefreshEvent):
        handler(event, None, source=source, lambda_client=aws.lam)

    assert source.fetched == []
    assert aws.lam.calls == []


def test_the_exception_types():
    assert issubclass(InvalidRefreshEvent, ValueError)
    assert issubclass(SportsDataRefreshFailed, RuntimeError)
    assert issubclass(DatasetRefreshRejected, SportsDataRefreshFailed)


@pytest.mark.parametrize("name", ["SPORTS_DATA_BUCKET", "KAGGLE_SECRET_ARN", "LOAD_FUNCTION_NAME"])
def test_an_unset_config_fails_before_any_aws_call(aws, monkeypatch, name):
    monkeypatch.delenv(name)
    _no_aws(monkeypatch)
    source = FakeSource(_dataset())

    with pytest.raises(SportsDataRefreshFailed) as raised:
        handler({}, None, source=source, lambda_client=aws.lam)

    assert name in str(raised.value)
    assert source.fetched == []
    assert aws.lam.calls == []


def test_the_function_needs_no_database_url(aws):
    result, _ = _run(aws)

    assert result["season_list"] == ["2025-26"]


# --------------------------------------------------------------------- the happy path


def test_a_scheduled_event_uploads_the_five_files_then_invokes_the_load_once(aws):
    result, source = _run(aws)

    assert source.fetched == [*FOUR, SCHEDULE_25_26]
    for name in (*FOUR, SCHEDULE_25_26):
        assert _body(aws, name) == _fixture(name)
    assert set(FOUR) <= set(result["uploaded"])
    assert result["season_list"] == ["2025-26"]
    assert SCHEDULE_25_26 in json.dumps(result["schedules"])
    json.dumps(result)  # JSON-serialisable, as a Lambda return value must be

    assert len(aws.lam.calls) == 1
    call = aws.lam.calls[0]
    assert call["FunctionName"] == LOAD_FUNCTION
    assert call["InvocationType"] == "Event"
    assert isinstance(call["Payload"], bytes)
    assert json.loads(call["Payload"]) == {"seasons": ["2025-26"]}


def test_an_eventbridge_scheduled_event_is_accepted(aws):
    event = {
        "version": "0",
        "id": "11111111-2222-3333-4444-555555555555",
        "detail-type": "Scheduled Event",
        "source": "aws.events",
        "account": "123456789012",
        "time": "2025-11-17T09:00:00Z",
        "region": REGION,
        "resources": ["arn:aws:events:ca-central-1:123456789012:rule/SportsDataRefreshSchedule"],
        "detail": {},
    }

    result, _ = _run(aws, event=event)

    assert result["season_list"] == ["2025-26"]
    assert len(aws.lam.calls) == 1


def test_a_manual_event_names_its_own_seasons_and_fetches_their_schedules(aws):
    files = _dataset(
        **{
            "LeagueSchedule23_24.csv": _fixture(SCHEDULE_25_26),
            "LeagueSchedule24_25.csv": _fixture(SCHEDULE_25_26),
        }
    )

    result, source = _run(aws, files=files, event={"seasons": ["2024-25", "2023-24"]})

    assert sorted(result["season_list"]) == ["2023-24", "2024-25"]
    assert "LeagueSchedule23_24.csv" in source.fetched
    assert "LeagueSchedule24_25.csv" in source.fetched
    assert SCHEDULE_25_26 not in source.fetched  # the current season is not added
    assert sorted(json.loads(aws.lam.calls[0]["Payload"])["seasons"]) == ["2023-24", "2024-25"]
    assert len(aws.lam.calls) == 1


def test_the_load_is_invoked_only_after_every_file_is_in_the_bucket(aws):
    _run(aws)

    assert aws.lam.keys_at_invoke == [{f"nba-eoin/{name}" for name in (*FOUR, SCHEDULE_25_26)}]


def test_nothing_is_written_outside_the_prefix(aws):
    _run(aws)

    keys = {o["Key"] for o in aws.s3.list_objects_v2(Bucket=BUCKET)["Contents"]}
    assert all(key.startswith("nba-eoin/") for key in keys)


def test_one_file_is_on_disk_at_a_time_and_none_is_left(aws, scratch):
    _, source = _run(aws)

    assert all(listing == [] for listing in source.dest_listing_seen), source.dest_listing_seen
    assert not any(p.is_file() for p in scratch.rglob("*"))


def test_an_empty_bucket_is_a_first_run_not_a_failure(aws):
    assert _keys(aws) == set()

    _run(aws)

    assert len(_keys(aws)) == 5


def test_a_grown_file_replaces_the_good_copy(aws):
    old = _fixture("Games.csv")
    aws.s3.put_object(Bucket=BUCKET, Key="nba-eoin/Games.csv", Body=old)
    new = old + old.split(b"\n", 1)[1]

    _run(aws, files=_dataset(**{"Games.csv": new}))

    assert _body(aws, "Games.csv") == new


def test_a_same_size_same_header_file_is_accepted(aws):
    aws.s3.put_object(Bucket=BUCKET, Key="nba-eoin/Games.csv", Body=_fixture("Games.csv"))

    _run(aws)

    assert len(aws.lam.calls) == 1


# --------------------------------------------------------------------- schedule files


def test_a_schedule_file_the_dataset_lacks_is_skipped_and_the_load_still_runs(aws):
    files = _dataset()
    del files[SCHEDULE_25_26]

    result, source = _run(aws, files=files)

    assert SCHEDULE_25_26 in source.fetched
    assert f"nba-eoin/{SCHEDULE_25_26}" not in _keys(aws)
    assert set(FOUR) <= set(result["uploaded"])
    assert SCHEDULE_25_26 in json.dumps(result["schedules"])
    assert len(aws.lam.calls) == 1
    assert json.loads(aws.lam.calls[0]["Payload"]) == {"seasons": ["2025-26"]}


def test_any_other_error_on_the_schedule_file_fails_the_run(aws):
    files = _dataset(**{SCHEDULE_25_26: RuntimeError("503 service unavailable")})

    with pytest.raises(SportsDataRefreshFailed):
        _run(aws, files=files)

    assert aws.lam.calls == []


@pytest.mark.parametrize("name", FOUR)
def test_a_required_file_the_dataset_lacks_fails_the_run(aws, name):
    files = _dataset()
    del files[name]

    with pytest.raises(SportsDataRefreshFailed):
        _run(aws, files=files)

    assert aws.lam.calls == []


@pytest.mark.parametrize("name", FOUR)
def test_any_error_on_a_required_file_fails_the_run_and_invokes_nothing(aws, name):
    files = _dataset(**{name: RuntimeError("connection reset")})

    with pytest.raises(SportsDataRefreshFailed):
        _run(aws, files=files)

    assert aws.lam.calls == []
    assert f"nba-eoin/{SCHEDULE_25_26}" not in _keys(aws)


# --------------------------------------------------------------------- the guard


def _existing(aws, name: str, body: bytes) -> None:
    aws.s3.put_object(Bucket=BUCKET, Key=f"nba-eoin/{name}", Body=body)


def _reject(aws, files, name: str) -> DatasetRefreshRejected:
    with pytest.raises(DatasetRefreshRejected) as raised:
        _run(aws, files=files)
    assert name in str(raised.value)
    assert aws.lam.calls == []
    return raised.value


def test_an_empty_file_is_rejected_and_the_good_copy_is_untouched(aws):
    good = _fixture("Games.csv")
    _existing(aws, "Games.csv", good)

    error = _reject(aws, _dataset(**{"Games.csv": b""}), "Games.csv")

    assert _body(aws, "Games.csv") == good
    assert str(len(good)) in str(error)
    assert "0" in str(error)


def test_an_empty_first_ever_file_is_rejected(aws):
    _reject(aws, _dataset(**{"Players.csv": b""}), "Players.csv")

    assert "nba-eoin/Players.csv" not in _keys(aws)


def test_a_wrong_header_is_rejected_when_an_object_exists(aws):
    good = _fixture("Players.csv")
    _existing(aws, "Players.csv", good)
    other = b"personId,first,last\n" + b"1,a,b\n" * (len(good) // 6 + 10)
    assert len(other) > len(good)

    _reject(aws, _dataset(**{"Players.csv": other}), "Players.csv")

    assert _body(aws, "Players.csv") == good


def test_a_header_that_differs_from_the_existing_one_is_rejected_even_if_it_has_the_columns(aws):
    old_header = b"gameId,custom\n"
    _existing(aws, "Games.csv", old_header)

    _reject(aws, _dataset(), "Games.csv")

    assert _body(aws, "Games.csv") == old_header


def test_a_wrong_header_is_rejected_with_no_baseline(aws):
    _reject(aws, _dataset(**{"TeamStatistics.csv": b"a,b,c\n1,2,3\n"}), "TeamStatistics.csv")

    assert "nba-eoin/TeamStatistics.csv" not in _keys(aws)


def test_a_shrunk_file_is_rejected_naming_both_sizes_and_the_good_copy_is_untouched(aws):
    good = _fixture("PlayerStatistics.csv")
    lines = good.split(b"\n")
    shrunk = b"\n".join(lines[:-3]) + b"\n"
    assert len(shrunk) < len(good)
    _existing(aws, "PlayerStatistics.csv", good)

    error = _reject(aws, _dataset(**{"PlayerStatistics.csv": shrunk}), "PlayerStatistics.csv")

    assert str(len(good)) in str(error)
    assert str(len(shrunk)) in str(error)
    assert _body(aws, "PlayerStatistics.csv") == good


def test_a_rejection_uploads_nothing_further_and_leaves_earlier_uploads_alone(aws):
    good = _fixture("PlayerStatistics.csv")
    _existing(aws, "PlayerStatistics.csv", good)
    shrunk = b"\n".join(good.split(b"\n")[:-3]) + b"\n"

    _reject(aws, _dataset(**{"PlayerStatistics.csv": shrunk}), "PlayerStatistics.csv")

    assert _keys(aws) == {"nba-eoin/Games.csv", "nba-eoin/PlayerStatistics.csv"}
    assert _body(aws, "PlayerStatistics.csv") == good


def test_a_rejection_on_the_first_file_uploads_nothing_at_all(aws):
    _reject(aws, _dataset(**{"Games.csv": b""}), "Games.csv")

    assert _keys(aws) == set()


def test_a_shrunk_schedule_file_is_rejected(aws):
    good = _fixture(SCHEDULE_25_26)
    _existing(aws, SCHEDULE_25_26, good)
    shrunk = b"\n".join(good.split(b"\n")[:-4]) + b"\n"
    assert len(shrunk) < len(good)

    _reject(aws, _dataset(**{SCHEDULE_25_26: shrunk}), SCHEDULE_25_26)

    assert _body(aws, SCHEDULE_25_26) == good


def test_a_schedule_file_with_the_wrong_header_and_no_baseline_is_rejected(aws):
    _reject(aws, _dataset(**{SCHEDULE_25_26: b"x,y\n1,2\n"}), SCHEDULE_25_26)

    assert f"nba-eoin/{SCHEDULE_25_26}" not in _keys(aws)


# --------------------------------------------------------------------- the token


def test_the_token_is_read_at_invocation_and_only_the_token_variable_is_left(aws, monkeypatch):
    monkeypatch.setenv("KAGGLE_USERNAME", "someone")
    monkeypatch.setenv("KAGGLE_KEY", "FAKE-KEY-9999")

    _, source = _run(aws)

    assert set(source.tokens_seen) == {TOKEN}
    assert all(seen == {"KAGGLE_USERNAME": None, "KAGGLE_KEY": None} for seen in source.env_seen)


def test_a_rotated_secret_is_picked_up_by_the_next_invocation(aws):
    _run(aws)
    aws.secrets.put_secret_value(SecretId=aws.arn, SecretString="FAKE-TOKEN-ROTATED-4567")

    _, source = _run(aws)

    assert set(source.tokens_seen) == {"FAKE-TOKEN-ROTATED-4567"}


def test_an_unreadable_secret_fails_the_run_and_invokes_nothing(aws, monkeypatch):
    monkeypatch.setenv(
        "KAGGLE_SECRET_ARN", f"arn:aws:secretsmanager:{REGION}:123456789012:secret:nope-AbCdEf"
    )
    source = FakeSource(_dataset())

    with pytest.raises(SportsDataRefreshFailed):
        handler({}, None, source=source, lambda_client=aws.lam)

    assert source.fetched == []
    assert aws.lam.calls == []


def _assert_token_free(text: str, where: str) -> None:
    assert TOKEN not in text, f"the token appears in {where}"


def test_a_successful_run_leaks_the_token_nowhere(aws, caplog, capsys, scratch):
    caplog.set_level(logging.DEBUG)

    result, _ = _run(aws)

    _assert_token_free(json.dumps(result), "the return value")
    captured = capsys.readouterr()
    _assert_token_free(caplog.text, "log records")
    _assert_token_free(captured.out + captured.err, "stdout/stderr")
    for path in scratch.rglob("*"):
        if path.is_file():
            assert TOKEN.encode() not in path.read_bytes(), f"the token was written to {path}"


@pytest.mark.parametrize("name", [*FOUR, SCHEDULE_25_26])
def test_a_source_error_quoting_the_token_leaks_it_nowhere(aws, caplog, capsys, name):
    caplog.set_level(logging.DEBUG)
    files = _dataset(**{name: RuntimeError(f"401 unauthorized: bad token {TOKEN}")})

    with pytest.raises(SportsDataRefreshFailed) as raised:
        _run(aws, files=files)

    exc = raised.value
    _assert_token_free(str(exc), "str(exception)")
    _assert_token_free(repr(exc), "repr(exception)")
    _assert_token_free(repr(exc.args), "exception args")
    assert exc.__cause__ is None
    assert exc.__suppress_context__ is True
    captured = capsys.readouterr()
    _assert_token_free(caplog.text, "log records")
    _assert_token_free(captured.out + captured.err, "stdout/stderr")
    assert aws.lam.calls == []


def test_a_rejection_message_carries_no_token(aws):
    _existing(aws, "Games.csv", _fixture("Games.csv"))

    error = _reject(aws, _dataset(**{"Games.csv": b""}), "Games.csv")

    _assert_token_free(str(error), "the rejection")
    _assert_token_free(repr(error), "the rejection repr")


# --------------------------------------------------------------------- the module


def test_the_refresh_function_never_reads_app_settings():
    source = Path(refresh_handler.__file__).read_text(encoding="utf-8")
    assert "app.settings" not in source
