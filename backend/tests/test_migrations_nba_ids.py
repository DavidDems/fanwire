"""Tests that EVENTS-001's Alembic migration (nba.com ids on teams/games,
nullable API-SPORTS ids, an at-least-one-id CHECK, games.game_type) applies
cleanly on top of the existing head and rolls back cleanly, per AGENTS.md TDD
workflow. Written before that migration exists -- driven by "head"/"-1",
never a literal revision id. Same style as tests/test_migrations.py.

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


@pytest.fixture()
def alembic_config(postgres_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", postgres_url)
    return Config(str(_BACKEND_DIR / "alembic.ini"))


@pytest.fixture()
def engine(postgres_url):
    engine = make_engine(postgres_url)
    yield engine
    engine.dispose()


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


def test_upgrade_head_adds_nba_id_and_game_type_columns(alembic_config, engine):
    command.upgrade(alembic_config, "head")

    nba_team_id = _column(engine, "teams", "nba_team_id")
    nba_game_id = _column(engine, "games", "nba_game_id")
    game_type = _column(engine, "games", "game_type")
    assert nba_team_id == {"is_nullable": "YES", "data_type": "bigint"}
    assert nba_game_id == {"is_nullable": "YES", "data_type": "bigint"}
    assert game_type == {"is_nullable": "YES", "data_type": "text"}


def test_upgrade_head_makes_api_sports_ids_nullable(alembic_config, engine):
    command.upgrade(alembic_config, "head")

    assert _column(engine, "teams", "api_sports_team_id")["is_nullable"] == "YES"
    assert _column(engine, "games", "api_sports_game_id")["is_nullable"] == "YES"


def test_upgrade_head_accepts_a_team_with_only_an_nba_id(alembic_config, engine):
    command.upgrade(alembic_config, "head")

    with engine.connect() as conn:
        _insert_team(conn, nba_team_id=1610612761)
        conn.rollback()


def test_upgrade_head_rejects_a_team_with_neither_id(alembic_config, engine):
    command.upgrade(alembic_config, "head")

    with engine.connect() as conn:
        with pytest.raises(IntegrityError) as excinfo:
            _insert_team(conn)
        conn.rollback()

    # The CHECK constraint, not the old NOT NULL on api_sports_team_id.
    assert isinstance(excinfo.value.orig, CheckViolation)


def test_upgrade_head_makes_nba_team_id_unique(alembic_config, engine):
    command.upgrade(alembic_config, "head")

    with engine.connect() as conn:
        _insert_team(conn, nba_team_id=1610612761)
        with pytest.raises(IntegrityError):
            _insert_team(conn, nba_team_id=1610612761)
        conn.rollback()


def test_downgrade_one_removes_nba_id_and_game_type_columns(alembic_config, engine):
    command.upgrade(alembic_config, "head")
    # Guard against a vacuous pass: the columns must be there before "-1".
    assert _column(engine, "games", "nba_game_id") is not None
    command.downgrade(alembic_config, "-1")

    assert _column(engine, "teams", "nba_team_id") is None
    assert _column(engine, "games", "nba_game_id") is None
    assert _column(engine, "games", "game_type") is None
    assert _column(engine, "teams", "api_sports_team_id")["is_nullable"] == "NO"
    assert _column(engine, "games", "api_sports_game_id")["is_nullable"] == "NO"

    # Leave the database at head for any test that runs after this one.
    command.upgrade(alembic_config, "head")
