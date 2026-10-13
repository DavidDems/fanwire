"""Tests for EVENTS-003's Alembic migration, per AGENTS.md TDD workflow.
Written before that migration exists, so it is driven by "head"/"-1"; its
parent, EVENTS-001's revision `b7d3e5a8c1f2`, is named.

Upgrade: teams.nba_team_id and games.nba_game_id become NOT NULL (still
unique), and the API-SPORTS columns (`api_sports_team_id`,
`api_sports_game_id`) and the two has-source-id CHECKs are dropped.
Downgrade restores the columns (nullable) and the CHECKs, and makes the
nba.com ids nullable again.

Guard: a Team or Game row with no nba.com id cannot survive the upgrade.
The migration raises with a message naming the table and the row count, and
changes nothing -- it never deletes the row or invents an id for it.

Inserts that are meant to stay are committed and always deleted again in a
`finally`, and every test that moves the database leaves it at head.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from alembic.config import Config
from psycopg.errors import CheckViolation, NotNullViolation, UniqueViolation
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from alembic import command
from app.db import make_engine

_BACKEND_DIR = Path(__file__).resolve().parents[1]

_PARENT_REVISION = "b7d3e5a8c1f2"

_TOR = 1610612761
_BOS = 1610612738


@pytest.fixture()
def alembic_config(postgres_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", postgres_url)
    return Config(str(_BACKEND_DIR / "alembic.ini"))


@pytest.fixture()
def engine(postgres_url):
    engine = make_engine(postgres_url)
    yield engine
    engine.dispose()


@pytest.fixture()
def at_head(alembic_config):
    command.upgrade(alembic_config, "head")
    yield
    command.upgrade(alembic_config, "head")


@pytest.fixture()
def at_parent(alembic_config, engine):
    """The database at EVENTS-001's revision, back at head afterwards, with
    every teams/games row this test committed deleted first."""
    command.upgrade(alembic_config, "head")
    command.downgrade(alembic_config, _PARENT_REVISION)
    assert _current_revision(engine) == _PARENT_REVISION
    try:
        yield
    finally:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM games"))
            conn.execute(text("DELETE FROM teams"))
        command.upgrade(alembic_config, "head")


def _column(engine, table: str, column: str) -> dict | None:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT is_nullable, data_type FROM information_schema.columns "
                "WHERE table_name = :table AND column_name = :column"
            ),
            {"table": table, "column": column},
        ).first()
        return None if row is None else {"is_nullable": row[0], "data_type": row[1]}


def _has_constraint(engine, name: str) -> bool:
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT 1 FROM pg_constraint WHERE conname = :name"), {"name": name}
        ).first()
        return row is not None


def _current_revision(engine) -> str | None:
    with engine.connect() as conn:
        return conn.execute(text("SELECT version_num FROM alembic_version")).scalar()


def _count(engine, table: str) -> int:
    with engine.connect() as conn:
        return conn.execute(text(f"SELECT count(*) FROM {table}")).scalar_one()


def _insert_team(conn, abbreviation: str = "TOR", **ids: int) -> int:
    extra_cols = "".join(f", {name}" for name in ids)
    extra_vals = "".join(f", :{name}" for name in ids)
    return conn.execute(
        text(
            "INSERT INTO teams (name, abbreviation, conference, division"
            f"{extra_cols}) VALUES ('Team ' || :abbreviation, :abbreviation, 'Eastern', "
            f"'Atlantic'{extra_vals}) RETURNING id"
        ),
        {"abbreviation": abbreviation, **ids},
    ).scalar_one()


def _insert_game(conn, home_id: int, away_id: int, **ids: int) -> int:
    extra_cols = "".join(f", {name}" for name in ids)
    extra_vals = "".join(f", :{name}" for name in ids)
    return conn.execute(
        text(
            "INSERT INTO games (home_team_id, away_team_id, date, season, home_score, "
            f"away_score, player_stats{extra_cols}) VALUES (:home, :away, "
            f"'2019-10-22T00:00:00+00:00', '2019-20', 130, 122, '[]'::jsonb{extra_vals}) "
            "RETURNING id"
        ),
        {"home": home_id, "away": away_id, **ids},
    ).scalar_one()


def _mentions_count(message: str, count: int) -> bool:
    return re.search(rf"(?<!\d){count}(?!\d)", message) is not None


# --------------------------------------------------------------------- upgrade


def test_upgrade_drops_api_sports_columns(at_head, engine):
    assert _column(engine, "teams", "api_sports_team_id") is None
    assert _column(engine, "games", "api_sports_game_id") is None


def test_upgrade_drops_has_source_id_checks(at_head, engine):
    assert not _has_constraint(engine, "ck_teams_has_source_id")
    assert not _has_constraint(engine, "ck_games_has_source_id")


def test_upgrade_makes_nba_ids_not_null_bigints(at_head, engine):
    assert _column(engine, "teams", "nba_team_id") == {"is_nullable": "NO", "data_type": "bigint"}
    assert _column(engine, "games", "nba_game_id") == {"is_nullable": "NO", "data_type": "bigint"}


def test_upgrade_rejects_a_team_without_an_nba_id(at_head, engine):
    with engine.connect() as conn:
        with pytest.raises(IntegrityError) as excinfo:
            _insert_team(conn)
        conn.rollback()

    assert isinstance(excinfo.value.orig, NotNullViolation)


def test_upgrade_rejects_a_game_without_an_nba_id(at_head, engine):
    with engine.connect() as conn:
        home = _insert_team(conn, "TOR", nba_team_id=_TOR)
        away = _insert_team(conn, "BOS", nba_team_id=_BOS)
        with pytest.raises(IntegrityError) as excinfo:
            _insert_game(conn, home, away)
        conn.rollback()

    assert isinstance(excinfo.value.orig, NotNullViolation)


def test_upgrade_keeps_nba_ids_unique(at_head, engine):
    with engine.connect() as conn:
        _insert_team(conn, "TOR", nba_team_id=_TOR)
        with pytest.raises(IntegrityError) as team_dup:
            _insert_team(conn, "TO2", nba_team_id=_TOR)
        conn.rollback()

    with engine.connect() as conn:
        home = _insert_team(conn, "TOR", nba_team_id=_TOR)
        away = _insert_team(conn, "BOS", nba_team_id=_BOS)
        _insert_game(conn, home, away, nba_game_id=21900001)
        with pytest.raises(IntegrityError) as game_dup:
            _insert_game(conn, home, away, nba_game_id=21900001)
        conn.rollback()

    assert isinstance(team_dup.value.orig, UniqueViolation)
    assert isinstance(game_dup.value.orig, UniqueViolation)


# --------------------------------------------------------------------- downgrade


def test_downgrade_restores_api_sports_columns_checks_and_nullable_nba_ids(
    at_head, alembic_config, engine
):
    # Guard against a vacuous pass: the columns must be gone before "-1".
    assert _column(engine, "teams", "api_sports_team_id") is None
    command.downgrade(alembic_config, "-1")

    assert _current_revision(engine) == _PARENT_REVISION
    assert _column(engine, "teams", "api_sports_team_id")["is_nullable"] == "YES"
    assert _column(engine, "games", "api_sports_game_id")["is_nullable"] == "YES"
    assert _has_constraint(engine, "ck_teams_has_source_id")
    assert _has_constraint(engine, "ck_games_has_source_id")
    assert _column(engine, "teams", "nba_team_id")["is_nullable"] == "YES"
    assert _column(engine, "games", "nba_game_id")["is_nullable"] == "YES"

    # The restored CHECK is live, not just present by name.
    with engine.connect() as conn:
        with pytest.raises(IntegrityError) as excinfo:
            _insert_team(conn)
        conn.rollback()
    assert isinstance(excinfo.value.orig, CheckViolation)
    # at_head's teardown returns the database to head.


def test_downgrade_keeps_rows_that_have_nba_ids(at_head, alembic_config, engine):
    with engine.begin() as conn:
        home = _insert_team(conn, "TOR", nba_team_id=_TOR)
        away = _insert_team(conn, "BOS", nba_team_id=_BOS)
        _insert_game(conn, home, away, nba_game_id=21900001)
    try:
        command.downgrade(alembic_config, "-1")
        assert _count(engine, "teams") == 2
        assert _count(engine, "games") == 1
        command.upgrade(alembic_config, "head")
        assert _count(engine, "teams") == 2
        assert _count(engine, "games") == 1
    finally:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM games"))
            conn.execute(text("DELETE FROM teams"))


# --------------------------------------------------------------------- guard


def test_upgrade_stops_on_teams_without_an_nba_id_and_changes_nothing(
    at_parent, alembic_config, engine
):
    with engine.begin() as conn:
        _insert_team(conn, "AAA", api_sports_team_id=1)
        _insert_team(conn, "BBB", api_sports_team_id=2)
        _insert_team(conn, "CCC", api_sports_team_id=3)
        _insert_team(conn, "TOR", nba_team_id=_TOR)

    # Any exception type: which one is the migration's choice.
    with pytest.raises(Exception) as excinfo:
        command.upgrade(alembic_config, "head")

    message = str(excinfo.value)
    assert "teams" in message
    assert _mentions_count(message, 3), message

    assert _current_revision(engine) == _PARENT_REVISION
    assert _column(engine, "teams", "api_sports_team_id") is not None
    assert _column(engine, "games", "api_sports_game_id") is not None
    assert _column(engine, "teams", "nba_team_id")["is_nullable"] == "YES"
    assert _has_constraint(engine, "ck_teams_has_source_id")
    assert _count(engine, "teams") == 4


def test_upgrade_stops_on_games_without_an_nba_id_and_changes_nothing(
    at_parent, alembic_config, engine
):
    with engine.begin() as conn:
        home = _insert_team(conn, "TOR", nba_team_id=_TOR)
        away = _insert_team(conn, "BOS", nba_team_id=_BOS)
        _insert_game(conn, home, away, api_sports_game_id=5001)
        _insert_game(conn, home, away, api_sports_game_id=5002)
        _insert_game(conn, home, away, nba_game_id=21900001)

    # Any exception type: which one is the migration's choice.
    with pytest.raises(Exception) as excinfo:
        command.upgrade(alembic_config, "head")

    message = str(excinfo.value)
    assert "games" in message
    assert _mentions_count(message, 2), message

    assert _current_revision(engine) == _PARENT_REVISION
    assert _column(engine, "games", "api_sports_game_id") is not None
    assert _column(engine, "teams", "api_sports_team_id") is not None
    assert _column(engine, "games", "nba_game_id")["is_nullable"] == "YES"
    assert _column(engine, "teams", "nba_team_id")["is_nullable"] == "YES"
    assert _has_constraint(engine, "ck_games_has_source_id")
    assert _count(engine, "games") == 3
    assert _count(engine, "teams") == 2
