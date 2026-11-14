"""POSTS-005's migration: posts gains linked_game_id, linked_player_game_stats_id,
linked_player_id (bigint, nullable, FKs to games, player_game_stats and
players) and linked_player_scope (text, nullable), plus four named CHECK
constraints. Written before the revision exists.

The new revision's parent is named explicitly (the head before POSTS-005,
POSTS-004's posts.deleted_at), not "-1", so this test keeps meaning "undo
this migration" after a later revision becomes head -- the lesson
tests/test_migrations.py records.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import text

from alembic import command
from app.db import make_engine

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_PARENT_REVISION = "b2d6f9a3c8e5"  # add_posts_deleted_at, head before POSTS-005
_REVISION = "c7e3a5d9f1b4"  # add_posts_data_link_columns: POSTS-006's revision adds a CHECK on top

_COLUMNS = {
    "linked_game_id": ("bigint", "YES", None),
    "linked_player_game_stats_id": ("bigint", "YES", None),
    "linked_player_id": ("bigint", "YES", None),
    "linked_player_scope": ("text", "YES", None),
}
_FOREIGN_KEYS = {
    ("linked_game_id", "games", "id"),
    ("linked_player_game_stats_id", "player_game_stats", "id"),
    ("linked_player_id", "players", "id"),
}
_CHECKS = {
    "ck_posts_one_data_link",
    "ck_posts_no_data_link_on_reply",
    "ck_posts_player_scope_pairing",
    "ck_posts_player_scope_values",
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


def _posts_foreign_keys(engine) -> set[tuple[str, str, str]]:
    """posts' single-column FKs: (column, referenced table, referenced column)."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT a.attname, rt.relname, ra.attname "
                "FROM pg_constraint c "
                "JOIN pg_class t ON t.oid = c.conrelid "
                "JOIN pg_class rt ON rt.oid = c.confrelid "
                "JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1] "
                "JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[1] "
                "WHERE c.contype = 'f' AND t.relname = 'posts'"
            )
        ).all()
    return {tuple(row) for row in rows}


def _posts_checks(engine) -> set[str]:
    with engine.connect() as conn:
        return set(
            conn.execute(
                text(
                    "SELECT conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid "
                    "WHERE c.contype = 'c' AND t.relname = 'posts'"
                )
            ).scalars()
        )


def _at_parent(alembic_config) -> None:
    """The database at the parent revision, whatever an earlier test in this
    module left it at: upgrade reaches it from empty, downgrade from head."""
    command.upgrade(alembic_config, _PARENT_REVISION)
    command.downgrade(alembic_config, _PARENT_REVISION)


def _seed_posts(engine) -> list[int]:
    """One user, a post and a reply to it, written at the parent revision."""
    with engine.begin() as conn:
        user_id = conn.execute(
            text(
                "INSERT INTO users (cognito_sub, username, date_of_birth) "
                "VALUES ('sub-mig-data-link', 'mig_data_link', '1990-01-01') RETURNING id"
            )
        ).scalar_one()
        post_id = conn.execute(
            text("INSERT INTO posts (author_id, text) VALUES (:a, 'before') RETURNING id"),
            {"a": user_id},
        ).scalar_one()
        reply_id = conn.execute(
            text(
                "INSERT INTO posts (author_id, text, is_reply, parent_post_id) "
                "VALUES (:a, 'a reply', true, :p) RETURNING id"
            ),
            {"a": user_id, "p": post_id},
        ).scalar_one()
    return [post_id, reply_id]


def test_upgrade_adds_the_four_nullable_link_columns(alembic_config, engine):
    command.upgrade(alembic_config, "head")

    columns = _posts_columns(engine)
    assert {name: columns.get(name) for name in _COLUMNS} == _COLUMNS


def test_upgrade_adds_the_three_foreign_keys(alembic_config, engine):
    command.upgrade(alembic_config, "head")

    assert _FOREIGN_KEYS <= _posts_foreign_keys(engine)


def test_upgrade_adds_the_four_named_check_constraints(alembic_config, engine):
    _at_parent(alembic_config)
    before = _posts_checks(engine)

    # This revision by name, not "head": a later revision (POSTS-006's
    # linked_line_game_id) adds a CHECK of its own.
    command.upgrade(alembic_config, _REVISION)

    assert _posts_checks(engine) - before == _CHECKS


def test_existing_rows_have_all_four_link_columns_null_after_upgrade(alembic_config, engine):
    _at_parent(alembic_config)
    post_ids = _seed_posts(engine)

    command.upgrade(alembic_config, "head")

    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT linked_game_id, linked_player_game_stats_id, linked_player_id, "
                "linked_player_scope FROM posts WHERE id = ANY(:ids)"
            ),
            {"ids": post_ids},
        ).all()
    assert [tuple(row) for row in rows] == [(None, None, None, None)] * len(post_ids)


def test_upgrade_then_downgrade_then_upgrade(alembic_config, engine):
    command.upgrade(alembic_config, "head")
    assert set(_COLUMNS) <= set(_posts_columns(engine))

    command.downgrade(alembic_config, _PARENT_REVISION)
    assert set(_COLUMNS).isdisjoint(_posts_columns(engine))
    assert _CHECKS.isdisjoint(_posts_checks(engine))
    assert "deleted_at" in _posts_columns(engine)  # the parent's own column stays

    command.upgrade(alembic_config, "head")
    columns = _posts_columns(engine)
    assert {name: columns.get(name) for name in _COLUMNS} == _COLUMNS
    assert _CHECKS <= _posts_checks(engine)
