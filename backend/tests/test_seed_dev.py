"""EVENTS-003: backend/scripts/seed_dev.py no longer creates Team or Game
rows, per AGENTS.md TDD workflow. Written before the change.

Its fixture teams and games were keyed only by API-SPORTS ids, which no
longer exist; games now come from the nba.com dataset loader. The script is
run the way a developer runs it (`python scripts/seed_dev.py`, DATABASE_URL
pointing at a migrated database) and must still exit successfully.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import text

from alembic import command
from app.db import make_engine

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_SCRIPT = _BACKEND_DIR / "scripts" / "seed_dev.py"


@pytest.fixture()
def migrated_url(postgres_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", postgres_url)
    command.upgrade(Config(str(_BACKEND_DIR / "alembic.ini")), "head")
    return postgres_url


def _count(url: str, table: str) -> int:
    engine = make_engine(url)
    try:
        with engine.connect() as conn:
            return conn.execute(text(f"SELECT count(*) FROM {table}")).scalar_one()
    finally:
        engine.dispose()


def test_seed_dev_creates_no_teams_or_games(migrated_url):
    assert _count(migrated_url, "teams") == 0
    assert _count(migrated_url, "games") == 0

    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env["DATABASE_URL"] = migrated_url
    result = subprocess.run(
        [sys.executable, str(_SCRIPT)],
        check=False,
        cwd=_BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )

    assert result.returncode == 0, result.stderr
    assert _count(migrated_url, "teams") == 0
    assert _count(migrated_url, "games") == 0
