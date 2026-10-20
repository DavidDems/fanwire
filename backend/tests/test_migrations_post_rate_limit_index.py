"""POSTS-002's migration: an index on posts (author_id, created_at), so the
per-author rate-limit count is an index range scan, not a table scan.
Written before the revision exists.

The new revision's parent is named explicitly (the head before POSTS-002),
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
from app.posts.models import Post

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_PARENT_REVISION = "e6b2f8a4c7d1"  # add_unaccent_extension, head before POSTS-002
_INDEX = "ix_posts_author_id_created_at"


@pytest.fixture()
def alembic_config(postgres_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", postgres_url)
    return Config(str(_BACKEND_DIR / "alembic.ini"))


@pytest.fixture()
def engine(postgres_url):
    engine = make_engine(postgres_url)
    yield engine
    engine.dispose()


def _index_columns(engine) -> list[str] | None:
    """The index's columns in order, or None when it does not exist."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT a.attname FROM pg_index i "
                "JOIN pg_class c ON c.oid = i.indexrelid "
                "JOIN pg_class t ON t.oid = i.indrelid "
                "JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true "
                "JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum "
                "WHERE c.relname = :name AND t.relname = 'posts' ORDER BY k.ord"
            ),
            {"name": _INDEX},
        ).all()
    return [row[0] for row in rows] or None


def test_upgrade_head_adds_the_author_created_at_index(alembic_config, engine):
    command.upgrade(alembic_config, "head")

    assert _index_columns(engine) == ["author_id", "created_at"]


def test_downgrade_to_the_parent_removes_the_index_and_upgrade_restores_it(alembic_config, engine):
    command.upgrade(alembic_config, "head")
    command.downgrade(alembic_config, _PARENT_REVISION)

    assert _index_columns(engine) is None

    command.upgrade(alembic_config, "head")

    assert _index_columns(engine) == ["author_id", "created_at"]


def test_the_model_declares_the_same_index():
    """Base.metadata.create_all (which the rest of the suite builds its schema
    from) must create the index too, not only the migration."""
    [index] = [i for i in Post.__table__.indexes if i.name == _INDEX]
    assert [c.name for c in index.columns] == ["author_id", "created_at"]
