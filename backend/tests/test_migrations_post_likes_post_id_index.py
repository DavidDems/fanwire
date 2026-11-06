"""POSTS-009's migration: an index on post_likes(post_id), which GET /feed's
"has at least one like" check and like_counts read. post_likes' primary key
is (user_id, post_id) and its other index leads with user_id, so before
this nothing serves a lookup by post_id alone. Written before the revision
exists.

The index's name is the implementer's choice; the test finds it by its
columns. The new revision's parent is named explicitly (the head before
POSTS-009), not "-1", as tests/test_migrations_post_rate_limit_index.py
does.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import text

from alembic import command
from app.db import make_engine
from app.posts.models import PostLike

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_PARENT_REVISION = "a8d3e5f1c2b7"  # add_record_totals, head before POSTS-009


@pytest.fixture()
def alembic_config(postgres_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", postgres_url)
    return Config(str(_BACKEND_DIR / "alembic.ini"))


@pytest.fixture()
def engine(postgres_url):
    engine = make_engine(postgres_url)
    yield engine
    engine.dispose()


def _post_likes_index_columns(engine) -> list[list[str]]:
    """Every index on post_likes (the primary key's included), as its
    columns in order."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT c.relname, a.attname FROM pg_index i "
                "JOIN pg_class c ON c.oid = i.indexrelid "
                "JOIN pg_class t ON t.oid = i.indrelid "
                "JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true "
                "JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum "
                "WHERE t.relname = 'post_likes' ORDER BY c.relname, k.ord"
            )
        ).all()
    by_index: dict[str, list[str]] = {}
    for name, column in rows:
        by_index.setdefault(name, []).append(column)
    return list(by_index.values())


def _has_post_id_index(engine) -> bool:
    return ["post_id"] in _post_likes_index_columns(engine)


def test_upgrade_head_adds_an_index_on_post_likes_post_id(alembic_config, engine):
    command.upgrade(alembic_config, "head")

    assert _has_post_id_index(engine)


def test_downgrade_to_the_parent_removes_the_index_and_upgrade_restores_it(alembic_config, engine):
    command.upgrade(alembic_config, "head")
    command.downgrade(alembic_config, _PARENT_REVISION)

    assert not _has_post_id_index(engine)

    command.upgrade(alembic_config, "head")

    assert _has_post_id_index(engine)


def test_the_model_declares_the_same_index():
    """Base.metadata.create_all (which the rest of the suite builds its
    schema from) must create the index too, not only the migration."""
    columns = [[c.name for c in index.columns] for index in PostLike.__table__.indexes]
    assert ["post_id"] in columns
