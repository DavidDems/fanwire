"""Tests for app.events.kaggle_source (EVENTS-008): the DatasetSource seam and
KagglehubSource, the only code that imports kagglehub.

kagglehub itself is faked (a namespace with one function, dataset_download):
no network, no real token. The call shape is the contract: one call per file,
`path=<file name>`, never the bare handle (which downloads the whole 1.87 GB
dataset), never load_dataset.
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from types import SimpleNamespace

import pytest
from app.events.kaggle_source import (
    DATASET_HANDLE,
    DatasetFileNotFound,
    KagglehubSource,
)

from app.events import kaggle_source

FAKE_TOKEN = "FAKE-TOKEN-0123"
_BACKEND_DIR = Path(__file__).resolve().parents[2]


class _FakeKagglehub:
    """Records every dataset_download call; "downloads" into a cache folder."""

    def __init__(self, cache: Path, contents: dict[str, bytes] | None = None) -> None:
        self.cache = cache
        self.contents = contents or {}
        self.calls: list[dict[str, object]] = []
        self.cache_env_seen: list[str | None] = []
        self.error: Exception | None = None

    def dataset_download(self, handle, path=None, **kwargs):
        import os

        self.calls.append({"handle": handle, "path": path, "kwargs": kwargs})
        self.cache_env_seen.append(os.environ.get("KAGGLEHUB_CACHE"))
        if self.error is not None:
            raise self.error
        target = self.cache / "datasets" / "v1" / str(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(self.contents.get(str(path), b"a,b\n1,2\n"))
        return str(target)


@pytest.fixture()
def fake(monkeypatch, tmp_path):
    monkeypatch.setenv("KAGGLEHUB_CACHE", "placeholder")  # restored on teardown
    monkeypatch.delenv("KAGGLEHUB_CACHE")
    scratch = tmp_path / "systemp"
    scratch.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(scratch))
    kagglehub = _FakeKagglehub(tmp_path / "cache")
    monkeypatch.setattr(kaggle_source, "kagglehub", kagglehub, raising=True)
    return kagglehub


def test_the_dataset_handle_is_the_eoin_moore_dataset():
    assert DATASET_HANDLE == "eoinamoore/historical-nba-data-and-player-box-scores"


def test_a_missing_file_error_is_an_exception_type():
    assert issubclass(DatasetFileNotFound, Exception)


def test_fetch_downloads_exactly_one_named_file_and_returns_it_inside_dest_dir(fake, tmp_path):
    fake.contents["Games.csv"] = b"gameId\n1\n"
    dest = tmp_path / "dest"
    dest.mkdir()

    result = KagglehubSource().fetch("Games.csv", dest)

    assert result == dest / "Games.csv"
    assert result.read_bytes() == b"gameId\n1\n"
    assert len(fake.calls) == 1
    call = fake.calls[0]
    assert call["handle"] == DATASET_HANDLE
    assert call["path"] == "Games.csv"
    assert call["kwargs"] == {}


def test_fetch_never_downloads_the_whole_dataset(fake, tmp_path):
    for name in ("Games.csv", "Players.csv", "LeagueSchedule26_27.csv"):
        KagglehubSource().fetch(name, tmp_path)

    assert [call["path"] for call in fake.calls] == [
        "Games.csv",
        "Players.csv",
        "LeagueSchedule26_27.csv",
    ]
    assert all(call["path"] for call in fake.calls)  # never path=None / the bare handle


def test_a_custom_handle_is_passed_through(fake, tmp_path):
    KagglehubSource("someone/else").fetch("Games.csv", tmp_path)

    assert fake.calls[0]["handle"] == "someone/else"


def test_kagglehub_load_dataset_and_dataframes_are_never_used(monkeypatch, tmp_path):
    only_download = SimpleNamespace(
        dataset_download=_FakeKagglehub(tmp_path / "cache").dataset_download
    )
    monkeypatch.setattr(kaggle_source, "kagglehub", only_download, raising=True)

    KagglehubSource().fetch("Games.csv", tmp_path)  # AttributeError if anything else is used


def test_the_cache_is_set_under_the_system_temp_dir_when_unset(fake, tmp_path):
    KagglehubSource().fetch("Games.csv", tmp_path)

    cache = fake.cache_env_seen[0]
    assert cache
    assert Path(cache).is_relative_to(Path(tempfile.gettempdir()))


def test_an_already_set_cache_is_left_alone(fake, monkeypatch, tmp_path):
    monkeypatch.setenv("KAGGLEHUB_CACHE", str(tmp_path / "mine"))

    KagglehubSource().fetch("Games.csv", tmp_path)

    assert fake.cache_env_seen == [str(tmp_path / "mine")]


@pytest.mark.parametrize(
    "message",
    [
        "404 Client Error: Not Found for url: https://www.kaggle.com/x",
        "Resource not found",
        "HTTP 404",
        "File NOT FOUND in dataset",
    ],
)
def test_a_not_found_style_error_is_dataset_file_not_found(fake, tmp_path, message):
    fake.error = RuntimeError(message)

    with pytest.raises(DatasetFileNotFound):
        KagglehubSource().fetch("LeagueSchedule26_27.csv", tmp_path)


def test_any_other_error_propagates_and_is_not_file_not_found(fake, tmp_path):
    fake.error = RuntimeError("503 service unavailable")

    with pytest.raises(Exception) as raised:
        KagglehubSource().fetch("Games.csv", tmp_path)

    assert not isinstance(raised.value, DatasetFileNotFound)
    assert "503" in str(raised.value)


def test_an_error_quoting_the_token_is_redacted(fake, monkeypatch, tmp_path):
    monkeypatch.setenv("KAGGLE_API_TOKEN", FAKE_TOKEN)
    fake.error = RuntimeError(f"401 unauthorized for token {FAKE_TOKEN}")

    with pytest.raises(Exception) as raised:
        KagglehubSource().fetch("Games.csv", tmp_path)

    exc = raised.value
    assert FAKE_TOKEN not in str(exc)
    assert FAKE_TOKEN not in repr(exc)
    assert exc.__cause__ is None
    assert exc.__suppress_context__ is True


def test_only_kaggle_source_imports_kagglehub():
    offenders = []
    for path in (_BACKEND_DIR / "app").rglob("*.py"):
        if path.name == "kaggle_source.py":
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped.startswith(("import kagglehub", "from kagglehub")):
                offenders.append(str(path))
    assert offenders == []
