"""POSTS-010's migration: an index on reports (reporter_id, created_at) and
one on media (uploader_id, created_at), so the per-user report and upload
rate-limit counts are index range scans, not table scans. Written before the
revision exists.

The new revision's parent is named explicitly (the head before POSTS-010),
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
from app.media.models import Media
from app.posts.models import Report

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_PARENT_REVISION = "9c009a110001"  # account_lifecycle, head before POSTS-010
_INDEXES = {
    "ix_reports_reporter_id_created_at": ("reports", ["reporter_id", "created_at"]),
    "ix_media_uploader_id_created_at": ("media", ["uploader_id", "created_at"]),
}


@pytest.fixture()
def alembic_config(postgres_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", postgres_url)
    return Config(str(_BACKEND_DIR / "alembic.ini"))


@pytest.fixture()
def engine(postgres_url):
    engine = make_engine(postgres_url)
    yield engine
    engine.dispose()


def _index_columns(engine, name: str, table: str) -> list[str] | None:
    """The index's columns in order, or None when it does not exist."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT a.attname FROM pg_index i "
                "JOIN pg_class c ON c.oid = i.indexrelid "
                "JOIN pg_class t ON t.oid = i.indrelid "
                "JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true "
                "JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum "
                "WHERE c.relname = :name AND t.relname = :table ORDER BY k.ord"
            ),
            {"name": name, "table": table},
        ).all()
    return [row[0] for row in rows] or None


def _all_index_columns(engine) -> dict[str, list[str] | None]:
    return {name: _index_columns(engine, name, table) for name, (table, _) in _INDEXES.items()}


_EXPECTED = {name: columns for name, (_, columns) in _INDEXES.items()}


def test_upgrade_head_adds_both_indexes(alembic_config, engine):
    command.upgrade(alembic_config, "head")

    assert _all_index_columns(engine) == _EXPECTED


def test_downgrade_to_the_parent_removes_both_indexes_and_upgrade_restores_them(
    alembic_config, engine
):
    command.upgrade(alembic_config, "head")
    command.downgrade(alembic_config, _PARENT_REVISION)

    assert _all_index_columns(engine) == dict.fromkeys(_INDEXES)

    command.upgrade(alembic_config, "head")

    assert _all_index_columns(engine) == _EXPECTED


@pytest.mark.parametrize(
    ("model", "name"),
    [(Report, "ix_reports_reporter_id_created_at"), (Media, "ix_media_uploader_id_created_at")],
)
def test_the_model_declares_the_same_index(model, name):
    """Base.metadata.create_all (which the rest of the suite builds its schema
    from) must create the index too, not only the migration."""
    [index] = [i for i in model.__table__.indexes if i.name == name]
    assert [c.name for c in index.columns] == _INDEXES[name][1]
