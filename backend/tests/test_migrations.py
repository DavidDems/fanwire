"""Tests that the search/ unit's Alembic migration (adding User.search_vector
/ Post.search_vector generated columns, their GIN indexes, and the GIN
index on Game.player_stats) applies cleanly on top of the existing head and
rolls back cleanly, per AGENTS.md TDD workflow and this unit's task brief
(wiki/CodeContext/Modules/0x07-search.md). Written before that migration
file exists -- driven by "head"/"-1" (symbolic identifiers), never a
literal revision string, since the revision id isn't known yet.

No existing migration-test file to follow the style of (none exists yet in
this repo) -- this drives `alembic.command` directly against a throwaway
testcontainers Postgres, the same real-Postgres-over-in-memory-substitute
principle every other integration test in this suite already follows.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import text

from alembic import command
from app.db import make_engine

_BACKEND_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture()
def alembic_config(postgres_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", postgres_url)
    return Config(str(_BACKEND_DIR / "alembic.ini"))


def _has_column(engine, table: str, column: str) -> bool:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name = :table AND column_name = :column"
            ),
            {"table": table, "column": column},
        ).first()
        return row is not None


def _has_index(engine, index_name: str) -> bool:
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT 1 FROM pg_indexes WHERE indexname = :name"), {"name": index_name}
        ).first()
        return row is not None


def test_upgrade_head_adds_search_columns_and_indexes(alembic_config, postgres_url):
    command.upgrade(alembic_config, "head")

    engine = make_engine(postgres_url)
    try:
        assert _has_column(engine, "users", "search_vector")
        assert _has_column(engine, "posts", "search_vector")
        assert _has_index(engine, "ix_users_search_vector")
        assert _has_index(engine, "ix_posts_search_vector")
        assert _has_index(engine, "ix_games_player_stats_gin")
    finally:
        engine.dispose()


def test_downgrade_one_removes_search_columns_and_indexes(alembic_config, postgres_url):
    command.upgrade(alembic_config, "head")
    command.downgrade(alembic_config, "-1")

    engine = make_engine(postgres_url)
    try:
        assert not _has_column(engine, "users", "search_vector")
        assert not _has_column(engine, "posts", "search_vector")
        assert not _has_index(engine, "ix_users_search_vector")
        assert not _has_index(engine, "ix_posts_search_vector")
        assert not _has_index(engine, "ix_games_player_stats_gin")
    finally:
        engine.dispose()
