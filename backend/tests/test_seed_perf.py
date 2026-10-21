"""PERF-001: backend/scripts/seed_perf.py, per AGENTS.md TDD workflow.
Written before the script exists.

Run the way perf/run.ps1 runs it (`python scripts/seed_perf.py`, cwd
backend/, DATABASE_URL pointing at a migrated database). It refuses to run
unless ENVIRONMENT is "development" or "perf", and is idempotent: a second
run adds no rows. It seeds synthetic teams and games, at least 300 users
whose cognito subs match the minted tokens (perf-user-1..N) and who are older
than the spam scorer's new-account window, follows, at least 20,000 posts
with replies and reposts, likes, and posts mentioning games (#GameId<id>,
with their event_mentions rows), in bulk statements rather than one ORM
insert per row (the time limit below is how that is pinned).

Each state gets its own database on the suite's one Postgres server, so the
refusal tests see an empty schema and the seeded assertions see one seed.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
import sqlalchemy
from alembic.config import Config
from sqlalchemy import text

from alembic import command
from app.db import make_engine

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_SCRIPT = _BACKEND_DIR / "scripts" / "seed_perf.py"
_SEEDED_TABLES = (
    "users",
    "follows",
    "posts",
    "post_likes",
    "event_mentions",
    "teams",
    "games",
)
_SEED_TIME_LIMIT_SECONDS = 120


@contextmanager
def _migrated_database(server, name: str) -> Iterator[str]:
    admin_url = server.get_connection_url().replace("psycopg2", "psycopg")
    admin = sqlalchemy.create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    url = admin_url.rsplit("/", 1)[0] + "/" + name
    with pytest.MonkeyPatch.context() as mp:
        mp.setenv("DATABASE_URL", url)
        mp.delenv("ENVIRONMENT", raising=False)
        mp.delenv("PERF_JWKS_PATH", raising=False)
        command.upgrade(Config(str(_BACKEND_DIR / "alembic.ini")), "head")
    try:
        yield url
    finally:
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


def _run(url: str, environment: str | None) -> subprocess.CompletedProcess[str]:
    # A missing script also exits non-zero and writes nothing; that is not a
    # refusal, so it must not pass as one.
    assert _SCRIPT.is_file(), f"{_SCRIPT} does not exist"
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env.pop("ENVIRONMENT", None)
    env.pop("PERF_JWKS_PATH", None)
    env["DATABASE_URL"] = url
    if environment is not None:
        env["ENVIRONMENT"] = environment
    return subprocess.run(
        [sys.executable, str(_SCRIPT)],
        check=False,
        cwd=_BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=600,
    )


def _counts(url: str) -> dict[str, int]:
    engine = make_engine(url)
    try:
        with engine.connect() as conn:
            return {
                table: conn.execute(text(f"SELECT count(*) FROM {table}")).scalar_one()
                for table in _SEEDED_TABLES
            }
    finally:
        engine.dispose()


def _scalar(url: str, sql: str):
    engine = make_engine(url)
    try:
        with engine.connect() as conn:
            return conn.execute(text(sql)).scalar_one()
    finally:
        engine.dispose()


def _rows(url: str, sql: str) -> list:
    engine = make_engine(url)
    try:
        with engine.connect() as conn:
            return list(conn.execute(text(sql)))
    finally:
        engine.dispose()


# --- refusal ------------------------------------------------------------


@pytest.fixture(scope="module")
def empty_db(_postgres_server):
    with _migrated_database(_postgres_server, "t_seed_perf_refusal") as url:
        yield url


@pytest.mark.parametrize("environment", [None, "", "production", "Perf", "staging", " perf"])
def test_refuses_outside_development_and_perf_and_writes_nothing(empty_db, environment):
    result = _run(empty_db, environment)

    assert result.returncode != 0
    assert "ENVIRONMENT" in result.stdout + result.stderr
    assert _counts(empty_db) == dict.fromkeys(_SEEDED_TABLES, 0)


# --- a perf seed --------------------------------------------------------


@pytest.fixture(scope="module")
def seeded(_postgres_server):
    with _migrated_database(_postgres_server, "t_seed_perf_seeded") as url:
        started = time.monotonic()
        first = _run(url, "perf")
        elapsed = time.monotonic() - started
        assert first.returncode == 0, first.stderr
        yield {"url": url, "elapsed": elapsed, "counts": _counts(url)}


def test_seed_finishes_in_bulk_time(seeded):
    assert seeded["elapsed"] < _SEED_TIME_LIMIT_SECONDS


def test_seeds_at_least_300_perf_users_with_contiguous_subs(seeded):
    url = seeded["url"]
    subs = {row[0] for row in _rows(url, "SELECT cognito_sub FROM users WHERE deleted_at IS NULL")}
    perf_numbers = sorted(
        int(match.group(1))
        for sub in subs
        if (match := re.fullmatch(r"perf-user-(\d+)", sub)) is not None
    )

    assert len(perf_numbers) >= 300
    assert perf_numbers == list(range(1, len(perf_numbers) + 1))


def test_every_perf_user_is_older_than_the_new_account_window(seeded):
    too_new = _scalar(
        seeded["url"],
        "SELECT count(*) FROM users WHERE cognito_sub LIKE 'perf-user-%' "
        "AND created_at > now() - interval '24 hours'",
    )

    assert too_new == 0


def test_seeds_follows(seeded):
    assert seeded["counts"]["follows"] > 0


def test_seeds_at_least_20000_posts(seeded):
    assert seeded["counts"]["posts"] >= 20_000


def test_seeds_replies_and_reposts(seeded):
    url = seeded["url"]

    assert _scalar(url, "SELECT count(*) FROM posts WHERE parent_post_id IS NOT NULL") > 0
    assert _scalar(url, "SELECT count(*) FROM posts WHERE is_repost") > 0


def test_seeds_likes(seeded):
    assert seeded["counts"]["post_likes"] > 0


def test_seeds_teams_and_games(seeded):
    assert seeded["counts"]["teams"] > 0
    assert seeded["counts"]["games"] > 0


def test_posts_mention_existing_games_and_carry_their_mention_rows(seeded):
    url = seeded["url"]
    game_ids = {row[0] for row in _rows(url, "SELECT id FROM games")}
    mentions = {
        (row[0], row[1]) for row in _rows(url, "SELECT post_id, game_id FROM event_mentions")
    }
    expected = set()
    for post_id, body in _rows(url, "SELECT id, text FROM posts WHERE text LIKE '%#GameId%'"):
        for match in re.finditer(r"#GameId(\d+)", body):
            game_id = int(match.group(1))
            if game_id in game_ids:
                expected.add((post_id, game_id))

    assert expected, "no post mentions an existing game"
    assert expected <= mentions


def test_a_second_run_adds_no_rows(seeded):
    result = _run(seeded["url"], "perf")

    assert result.returncode == 0, result.stderr
    assert _counts(seeded["url"]) == seeded["counts"]


# --- a development seed -------------------------------------------------


def test_runs_in_development_too(_postgres_server):
    with _migrated_database(_postgres_server, "t_seed_perf_development") as url:
        result = _run(url, "development")

        assert result.returncode == 0, result.stderr
        assert _counts(url)["users"] >= 300
