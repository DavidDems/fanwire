"""EVENTS-010 criterion 10: backend/scripts/generate_scale_fixture.py, written
before the script exists.

Run as perf work would run it (`python scripts/generate_scale_fixture.py
--seasons N --games-per-team G`, cwd backend/, DATABASE_URL pointing at a
migrated database; the defaults, 23 and 82, are the full scale). Tested at a
small scale. It:

- refuses (non-zero exit, nothing written) unless ENVIRONMENT is
  `development` or `perf`, and when any stored games.nba_game_id is below
  9,000,000,000 (a real load);
- writes 30 teams and the requested seasons, every game with an
  nba_game_id from 9,200,000,000 (clear of seed_perf.py's range); each
  season has `regular` games (G per team) and `playoffs` games, NBA Finals
  among them that make a champion as GET /events/seasons/{season}/champion
  computes it; some box-score rows are did-not-play (seconds_played null)
  and at least one played row is a triple-double;
- is deterministic (two fresh databases, the same games) and idempotent (a
  second run adds no rows).

Each state gets its own migrated database on the suite's one Postgres
server, as in test_seed_perf.py.
"""

from __future__ import annotations

import os
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
from app.db import make_engine, make_session_factory
from tests.events.players_support import make_client

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_SCRIPT = _BACKEND_DIR / "scripts" / "generate_scale_fixture.py"
_TABLES = ("teams", "games", "players", "player_game_stats")
_SEASONS = 2
_GAMES_PER_TEAM = 6
_ARGS = ("--seasons", str(_SEASONS), "--games-per-team", str(_GAMES_PER_TEAM))
_TIME_LIMIT_SECONDS = 120
_GENERATED_FROM = 9_200_000_000
_REAL_BELOW = 9_000_000_000

_TRIPLE_DOUBLES = """
SELECT count(*) FROM player_game_stats
WHERE seconds_played IS NOT NULL
  AND (CASE WHEN points >= 10 THEN 1 ELSE 0 END
     + CASE WHEN rebounds >= 10 THEN 1 ELSE 0 END
     + CASE WHEN assists >= 10 THEN 1 ELSE 0 END
     + CASE WHEN steals >= 10 THEN 1 ELSE 0 END
     + CASE WHEN blocks >= 10 THEN 1 ELSE 0 END) >= 3
"""


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


def _run(url: str, environment: str | None, *args: str) -> subprocess.CompletedProcess[str]:
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
        [sys.executable, str(_SCRIPT), *args],
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
                for table in _TABLES
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
            return [tuple(row) for row in conn.execute(text(sql))]
    finally:
        engine.dispose()


# --- refusal ------------------------------------------------------------


@pytest.fixture(scope="module")
def empty_db(_postgres_server):
    with _migrated_database(_postgres_server, "t_scale_fixture_refusal") as url:
        yield url


@pytest.mark.parametrize("environment", [None, "", "production", "test", "Perf", " perf"])
def test_refuses_outside_development_and_perf_and_writes_nothing(empty_db, environment):
    result = _run(empty_db, environment, *_ARGS)

    assert result.returncode != 0
    assert _counts(empty_db) == dict.fromkeys(_TABLES, 0)


def test_refuses_over_a_real_load_and_writes_nothing(_postgres_server):
    with _migrated_database(_postgres_server, "t_scale_fixture_real_load") as url:
        engine = make_engine(url)
        with engine.begin() as conn:
            home, away = (
                conn.execute(
                    text(
                        "INSERT INTO teams (nba_team_id, name, abbreviation, conference, division)"
                        " VALUES (:nba, :name, :abbr, 'East', 'Atlantic') RETURNING id"
                    ),
                    {"nba": nba, "name": f"Real {abbr}", "abbr": abbr},
                ).scalar_one()
                for nba, abbr in ((1610612738, "BOS"), (1610612742, "DAL"))
            )
            conn.execute(
                text(
                    "INSERT INTO games (nba_game_id, home_team_id, away_team_id, date, season,"
                    " home_score, away_score, game_type)"
                    " VALUES (22300001, :home, :away, '2023-10-24 19:30', '2023-24', 108, 104,"
                    " 'regular')"
                ),
                {"home": home, "away": away},
            )
        engine.dispose()
        before = _counts(url)

        result = _run(url, "perf", *_ARGS)

        assert result.returncode != 0
        assert _counts(url) == before


# --- a small generated database -------------------------------------------


@pytest.fixture(scope="module")
def generated(_postgres_server):
    with _migrated_database(_postgres_server, "t_scale_fixture_generated") as url:
        started = time.monotonic()
        first = _run(url, "perf", *_ARGS) if _SCRIPT.is_file() else None
        elapsed = time.monotonic() - started
        yield {"url": url, "elapsed": elapsed, "counts": _counts(url), "run": first}


def _succeeded(generated) -> None:
    """Asserted in each test, not the fixture, so each fails on its own."""
    run = generated["run"]
    assert run is not None, f"{_SCRIPT} does not exist"
    assert run.returncode == 0, run.stdout + run.stderr


def test_finishes_in_time_at_a_small_scale(generated):
    _succeeded(generated)
    assert generated["elapsed"] < _TIME_LIMIT_SECONDS


def test_writes_thirty_teams_and_the_requested_seasons(generated):
    _succeeded(generated)
    url = generated["url"]

    assert generated["counts"]["teams"] == 30
    assert _scalar(url, "SELECT count(DISTINCT season) FROM games") == _SEASONS


def test_every_game_is_in_the_generators_id_range(generated):
    _succeeded(generated)
    url = generated["url"]

    assert generated["counts"]["games"] > 0
    assert _scalar(url, "SELECT min(nba_game_id) FROM games") >= _GENERATED_FROM


def test_each_team_plays_the_requested_regular_games_each_season(generated):
    _succeeded(generated)
    rows = _rows(
        generated["url"],
        "SELECT season, team_id, count(*) FROM ("
        " SELECT season, home_team_id AS team_id FROM games WHERE game_type = 'regular'"
        " UNION ALL"
        " SELECT season, away_team_id FROM games WHERE game_type = 'regular') AS t"
        " GROUP BY season, team_id",
    )

    assert len(rows) == 30 * _SEASONS
    assert {games for _, _, games in rows} == {_GAMES_PER_TEAM}


def test_each_season_has_playoffs_and_a_champion(generated):
    _succeeded(generated)
    url = generated["url"]
    seasons = [row[0] for row in _rows(url, "SELECT DISTINCT season FROM games ORDER BY 1")]
    engine = make_engine(url)
    client = make_client(make_session_factory(engine))
    try:
        for season in seasons:
            playoffs = _scalar(
                url,
                f"SELECT count(*) FROM games WHERE season = '{season}' AND game_type = 'playoffs'",
            )
            finals = _scalar(
                url,
                f"SELECT count(*) FROM games WHERE season = '{season}'"
                " AND game_type = 'playoffs' AND label = 'NBA Finals'",
            )
            assert playoffs > finals >= 4, season
            response = client.get(f"/events/seasons/{season}/champion")
            assert response.status_code == 200, response.text
            assert response.json()["champion"] is not None, season
    finally:
        engine.dispose()


def test_box_scores_have_dnp_rows_and_a_triple_double(generated):
    _succeeded(generated)
    url = generated["url"]

    assert generated["counts"]["players"] > 0
    assert _scalar(url, "SELECT count(*) FROM player_game_stats WHERE seconds_played IS NULL") > 0
    assert (
        _scalar(url, "SELECT count(*) FROM player_game_stats WHERE seconds_played IS NOT NULL") > 0
    )
    assert _scalar(url, _TRIPLE_DOUBLES) >= 1


def test_a_second_run_adds_no_rows(generated):
    _succeeded(generated)
    result = _run(generated["url"], "perf", *_ARGS)

    assert result.returncode == 0, result.stderr
    assert _counts(generated["url"]) == generated["counts"]


def test_is_deterministic_and_runs_in_development_too(_postgres_server, generated):
    _succeeded(generated)
    with _migrated_database(_postgres_server, "t_scale_fixture_again") as url:
        result = _run(url, "development", *_ARGS)
        assert result.returncode == 0, result.stderr

        def games(at: str) -> set:
            return set(_rows(at, "SELECT nba_game_id, home_score, away_score FROM games"))

        def lines(at: str) -> list:
            return _rows(
                at,
                "SELECT count(*), sum(points), count(seconds_played) FROM player_game_stats",
            )

        assert _counts(url) == generated["counts"]
        assert games(url) == games(generated["url"])
        assert lines(url) == lines(generated["url"])
