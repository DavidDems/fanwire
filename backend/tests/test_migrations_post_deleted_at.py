"""POSTS-004's migration: posts.deleted_at, a nullable timestamptz with no
default, and nothing else. Written before the revision exists.

The new revision's parent is named explicitly (the head before POSTS-004),
not "-1", so this test keeps meaning "undo this migration" after a later
revision becomes head -- the same lesson tests/test_migrations.py records.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import text

from alembic import command
from app.db import make_engine

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_PARENT_REVISION = "a8c4e1f7b3d9"  # add_posts_author_created_at_index, head before POSTS-004
_REVISION = "b2d6f9a3c8e5"  # add_posts_deleted_at: POSTS-005's revision adds columns on top


@pytest.fixture()
def alembic_config(postgres_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", postgres_url)
    return Config(str(_BACKEND_DIR / "alembic.ini"))


@pytest.fixture()
def engine(postgres_url):
    engine = make_engine(postgres_url)
    yield engine
    engine.dispose()


def _posts_columns(engine) -> dict[str, tuple[str, str, str | None]]:
    """posts' columns: name -> (data_type, is_nullable, column_default)."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT column_name, data_type, is_nullable, column_default "
                "FROM information_schema.columns WHERE table_name = 'posts'"
            )
        ).all()
    return {name: (data_type, nullable, default) for name, data_type, nullable, default in rows}


def _posts_indexes_and_constraints(engine) -> set[str]:
    with engine.connect() as conn:
        indexes = conn.execute(
            text("SELECT indexname FROM pg_indexes WHERE tablename = 'posts'")
        ).scalars()
        constraints = conn.execute(
            text(
                "SELECT conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid "
                "WHERE t.relname = 'posts'"
            )
        ).scalars()
        return set(indexes) | set(constraints)


def _at_parent(alembic_config) -> None:
    """The database at the parent revision, whatever an earlier test in this
    module left it at (the database is per module, not per test): upgrade
    reaches it from empty, downgrade from head."""
    command.upgrade(alembic_config, _PARENT_REVISION)
    command.downgrade(alembic_config, _PARENT_REVISION)


def _seed_a_post(engine) -> int:
    """One user and one post, written at the parent revision (before the
    column exists)."""
    with engine.begin() as conn:
        user_id = conn.execute(
            text(
                "INSERT INTO users (cognito_sub, username, date_of_birth) "
                "VALUES ('sub-mig-deleted-at', 'mig_deleted_at', '1990-01-01') RETURNING id"
            )
        ).scalar_one()
        return conn.execute(
            text("INSERT INTO posts (author_id, text) VALUES (:a, 'before') RETURNING id"),
            {"a": user_id},
        ).scalar_one()


def test_upgrade_adds_a_nullable_timestamptz_deleted_at_with_no_default(alembic_config, engine):
    command.upgrade(alembic_config, "head")

    columns = _posts_columns(engine)
    assert columns["deleted_at"] == ("timestamp with time zone", "YES", None)


def test_upgrade_adds_deleted_at_and_nothing_else(alembic_config, engine):
    _at_parent(alembic_config)
    before = set(_posts_columns(engine))
    objects_before = _posts_indexes_and_constraints(engine)

    # This revision by name, not "head": a later revision (POSTS-005's data
    # links) adds columns and constraints of its own.
    command.upgrade(alembic_config, _REVISION)

    assert set(_posts_columns(engine)) - before == {"deleted_at"}
    assert before - set(_posts_columns(engine)) == set()
    # No index, no constraint: deleted rows are rare (task brief).
    assert _posts_indexes_and_constraints(engine) == objects_before


def test_existing_rows_have_deleted_at_null_after_upgrade(alembic_config, engine):
    _at_parent(alembic_config)
    post_id = _seed_a_post(engine)

    command.upgrade(alembic_config, "head")

    with engine.connect() as conn:
        deleted_at = conn.execute(
            text("SELECT deleted_at FROM posts WHERE id = :id"), {"id": post_id}
        ).scalar_one()
    assert deleted_at is None


def test_upgrade_then_downgrade_then_upgrade(alembic_config, engine):
    command.upgrade(alembic_config, "head")
    assert "deleted_at" in _posts_columns(engine)

    command.downgrade(alembic_config, _PARENT_REVISION)
    assert "deleted_at" not in _posts_columns(engine)

    command.upgrade(alembic_config, "head")
    assert _posts_columns(engine)["deleted_at"] == ("timestamp with time zone", "YES", None)
