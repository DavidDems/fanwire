"""Tests that EVENTS-001's Alembic migration (nba.com ids on teams/games,
nullable API-SPORTS ids, an at-least-one-id CHECK, games.game_type) applies
cleanly on top of its parent and rolls back cleanly, per AGENTS.md TDD
workflow. Same style as tests/test_migrations.py.

Pinned by name to its own revision (`b7d3e5a8c1f2`) and its parent
(`f4a1c9d2b6e7`): "head"/"-1" stopped meaning this migration once
EVENTS-003's migration (which drops the API-SPORTS columns) became head.
Every test that moves the database leaves it at head afterwards.

Every insert here runs in a connection that is rolled back, never committed:
the downgrade restores NOT NULL on the API-SPORTS id columns, which would
fail on a leftover row that has none.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic.config import Config
from psycopg.errors import CheckViolation
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from alembic import command
from app.db import make_engine

_BACKEND_DIR = Path(__file__).resolve().parents[1]

_THIS_REVISION = "b7d3e5a8c1f2"
_PARENT_REVISION = "f4a1c9d2b6e7"


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
def at_this_revision(alembic_config):
    """The database at this migration's revision, whatever later revisions
    exist; back at head afterwards. Up to head first, then down: alembic
    refuses to "upgrade" to an ancestor of the current revision."""
    command.upgrade(alembic_config, "head")
    command.downgrade(alembic_config, _THIS_REVISION)
    yield
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


def _insert_team(conn, **ids: int) -> None:
    extra_cols = "".join(f", {name}" for name in ids)
    extra_vals = "".join(f", :{name}" for name in ids)
    conn.execute(
        text(
            "INSERT INTO teams (name, abbreviation, conference, division"
            f"{extra_cols}) VALUES ('Toronto Raptors', 'TOR', 'Eastern', 'Atlantic'{extra_vals})"
        ),
        ids,
    )


def test_upgrade_adds_nba_id_and_game_type_columns(at_this_revision, engine):

    nba_team_id = _column(engine, "teams", "nba_team_id")
    nba_game_id = _column(engine, "games", "nba_game_id")
    game_type = _column(engine, "games", "game_type")
    assert nba_team_id == {"is_nullable": "YES", "data_type": "bigint"}
    assert nba_game_id == {"is_nullable": "YES", "data_type": "bigint"}
    assert game_type == {"is_nullable": "YES", "data_type": "text"}


def test_upgrade_makes_api_sports_ids_nullable(at_this_revision, engine):

    assert _column(engine, "teams", "api_sports_team_id")["is_nullable"] == "YES"
    assert _column(engine, "games", "api_sports_game_id")["is_nullable"] == "YES"


def test_upgrade_accepts_a_team_with_only_an_nba_id(at_this_revision, engine):

    with engine.connect() as conn:
        _insert_team(conn, nba_team_id=1610612761)
        conn.rollback()


def test_upgrade_rejects_a_team_with_neither_id(at_this_revision, engine):

    with engine.connect() as conn:
        with pytest.raises(IntegrityError) as excinfo:
            _insert_team(conn)
        conn.rollback()

    # The CHECK constraint, not the old NOT NULL on api_sports_team_id.
    assert isinstance(excinfo.value.orig, CheckViolation)


def test_upgrade_makes_nba_team_id_unique(at_this_revision, engine):

    with engine.connect() as conn:
        _insert_team(conn, nba_team_id=1610612761)
        with pytest.raises(IntegrityError):
            _insert_team(conn, nba_team_id=1610612761)
        conn.rollback()


def test_downgrade_to_parent_removes_nba_id_and_game_type_columns(
    at_this_revision, alembic_config, engine
):
    # Guard against a vacuous pass: the columns must be there before going down.
    assert _column(engine, "games", "nba_game_id") is not None
    command.downgrade(alembic_config, _PARENT_REVISION)

    assert _column(engine, "teams", "nba_team_id") is None
    assert _column(engine, "games", "nba_game_id") is None
    assert _column(engine, "games", "game_type") is None
    assert _column(engine, "teams", "api_sports_team_id")["is_nullable"] == "NO"
    assert _column(engine, "games", "api_sports_game_id")["is_nullable"] == "NO"
    # at_this_revision's teardown returns the database to head.
