"""No source file in the test image is executable without a shebang.

This is what ruff's EXE002 checks, run as a test so the cause is named. A
Linux checkout (CI) gives 0644 and passes either way. Docker Desktop on Windows
sends every file in the build context as 0755, and before the test stage reset
the modes `ruff check .` in the local image reported 275 EXE002 errors that CI
never saw.
"""

from __future__ import annotations

import os
import stat
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_SOURCES = ("app", "tests", "alembic", "scripts")


@pytest.mark.skipif(os.name == "nt", reason="Windows has no executable bit to check")
def test_no_python_file_is_executable_without_a_shebang():
    offenders = [
        str(path.relative_to(_ROOT))
        for top in _SOURCES
        if (_ROOT / top).is_dir()
        for path in sorted((_ROOT / top).rglob("*.py"))
        if path.stat().st_mode & (stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        and not path.read_bytes().startswith(b"#!")
    ]

    assert offenders == [], f"{len(offenders)} executable without a shebang: {offenders[:5]}"
