"""The dataset source for the scheduled refresh (EVENTS-008).

`DatasetSource` is the seam: fetch one named file of the dataset into a
directory. `KagglehubSource` is the production implementation and the only
code that imports kagglehub. It downloads one file per call, never the whole
1.87 GB dataset and never into a DataFrame. The token is kagglehub's to read
from the environment (KAGGLE_API_TOKEN, set by app.events.refresh_handler);
this module never logs it and redacts it from any error it passes on.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path
from typing import Protocol

import kagglehub  # type: ignore[import-untyped]  # kagglehub ships no py.typed marker

__all__ = [
    "DATASET_HANDLE",
    "DatasetFileNotFound",
    "DatasetSource",
    "KagglehubSource",
    "redact_token",
]

DATASET_HANDLE = "eoinamoore/historical-nba-data-and-player-box-scores"

_REDACTED = "[redacted]"


class DatasetFileNotFound(Exception):
    """The dataset has no file of that name."""


class DatasetSource(Protocol):
    def fetch(self, file_name: str, dest_dir: Path) -> Path:
        """Put one named file of the dataset in `dest_dir` and return its
        path. A file the dataset does not have raises DatasetFileNotFound."""
        ...


def redact_token(text: str) -> str:
    """`text` without the Kaggle token currently in the environment."""
    token = os.environ.get("KAGGLE_API_TOKEN")
    return text.replace(token, _REDACTED) if token else text


def _is_not_found(message: str) -> bool:
    lowered = message.lower()
    return "404" in lowered or "not found" in lowered


class KagglehubSource:
    def __init__(self, handle: str = DATASET_HANDLE) -> None:
        self._handle = handle

    def fetch(self, file_name: str, dest_dir: Path) -> Path:
        # Lambda's only writable path is /tmp; kagglehub's default cache is
        # under the home directory.
        os.environ.setdefault("KAGGLEHUB_CACHE", str(Path(tempfile.gettempdir()) / "kagglehub"))
        try:
            downloaded = Path(kagglehub.dataset_download(self._handle, path=file_name))
        except Exception as exc:  # noqa: BLE001  # classified and re-raised below
            message = redact_token(str(exc))
            if _is_not_found(message):
                raise DatasetFileNotFound(file_name) from None
            raise RuntimeError(f"{type(exc).__name__}: {message}") from None
        target = Path(dest_dir) / file_name
        shutil.move(str(downloaded), str(target))  # frees the cache copy
        return target
