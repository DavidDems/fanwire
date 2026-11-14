"""EVENTS-014's migration: the scheduled_games table, and nothing else.
Written before the revision exists.

The new revision is found by its parent, b9e4d7c2a601 (USERS-008's
anonymous account tombstones, the head before EVENTS-014), never by its own
id, which the implementation chooses. Downgrading goes back to that parent
by name, which today is one step ("-1") and keeps meaning "undo this
migration" once a later revision becomes head (tests/test_migrations.py's
lesson).

Every test leaves the database at head.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text

from alembic import command
from app.db import make_engine

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_PARENT_REVISION = (
    "b9e4d7c2a601"  # anonymous_account_tombstones (USERS-008), head before EVENTS-014
)
_TABLE = "scheduled_games"

# column -> (data_type, is_nullable), as information_schema.columns gives them.
_COLUMNS = {
    "id": ("bigint", "NO"),
    "nba_game_id": ("bigint", "NO"),
    "season": ("text", "NO"),
    "date": ("timestamp without time zone", "NO"),
    "time_tbd": ("boolean", "NO"),
    "game_type": ("text", "NO"),
    "label": ("text", "YES"),
    "sub_label": ("text", "YES"),
    "venue": ("text", "YES"),
    "series_game_number": ("integer", "YES"),
    "home_team_id": ("bigint", "YES"),
    "away_team_id": ("bigint", "YES"),
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


def _scripts() -> ScriptDirectory:
    return ScriptDirectory.from_config(Config(str(_BACKEND_DIR / "alembic.ini")))


def _revision() -> str:
    """The one revision whose parent is the head before EVENTS-014."""
    children = [
        script.revision
        for script in _scripts().walk_revisions()
        if script.down_revision == _PARENT_REVISION
    ]
    assert len(children) == 1, f"revisions on top of {_PARENT_REVISION}: {children}"
    return children[0]


@pytest.fixture()
def at_revision(alembic_config):
    """The database at EVENTS-014's revision; back at head afterwards."""
    command.upgrade(alembic_config, _revision())
    try:
        yield
    finally:
        command.upgrade(alembic_config, "head")


def _columns(engine, table: str) -> dict[str, tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT column_name, data_type, is_nullable FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = :t"
            ),
            {"t": table},
        ).all()
    return {name: (data_type, nullable) for name, data_type, nullable in rows}


def _every_other_table(engine) -> dict[str, list[tuple]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT table_name, column_name, data_type, is_nullable, column_default "
                "FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name <> :t "
                "ORDER BY table_name, column_name"
            ),
            {"t": _TABLE},
        ).all()
        indexes = conn.execute(
            text(
                "SELECT tablename, indexname, indexdef FROM pg_indexes "
                "WHERE schemaname = 'public' AND tablename <> :t ORDER BY indexname"
            ),
            {"t": _TABLE},
        ).all()
        constraints = conn.execute(
            text(
                "SELECT conrelid::regclass::text, conname, pg_get_constraintdef(oid) "
                "FROM pg_constraint WHERE connamespace = 'public'::regnamespace "
                "AND conrelid <> 0 AND conrelid::regclass::text <> :t ORDER BY conname"
            ),
            {"t": _TABLE},
        ).all()
    return {
        "columns": [tuple(r) for r in rows],
        "indexes": [tuple(r) for r in indexes],
        "constraints": [tuple(r) for r in constraints],
    }


def test_the_revision_chains_onto_the_head_before_it():
    """Scripts only: one head, and EVENTS-014's revision is on its line."""
    scripts = _scripts()
    heads = scripts.get_heads()
    assert len(heads) == 1, heads
    revision = _revision()
    assert revision in {rev.revision for rev in scripts.walk_revisions("base", heads[0])}


def test_upgrade_creates_the_table_with_exactly_the_spec_columns(at_revision, engine):
    assert _columns(engine, _TABLE) == _COLUMNS


def test_the_id_is_a_bigint_identity_primary_key(at_revision, engine):
    with engine.connect() as conn:
        is_identity = conn.execute(
            text(
                "SELECT is_identity FROM information_schema.columns "
                "WHERE table_name = :t AND column_name = 'id'"
            ),
            {"t": _TABLE},
        ).scalar()
        primary_key = conn.execute(
            text(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                "WHERE conrelid = CAST(:t AS regclass) AND contype = 'p'"
            ),
            {"t": _TABLE},
        ).scalar()
    assert is_identity == "YES"
    assert primary_key == "PRIMARY KEY (id)"


def test_nba_game_id_is_unique(at_revision, engine):
    with engine.connect() as conn:
        definitions = conn.execute(
            text("SELECT indexdef FROM pg_indexes WHERE tablename = :t"), {"t": _TABLE}
        ).scalars()
        unique = [d for d in definitions if "UNIQUE" in d and d.rstrip().endswith("(nba_game_id)")]
    assert len(unique) == 1, unique


def test_an_index_serves_reads_by_season_and_date(at_revision, engine):
    with engine.connect() as conn:
        definitions = list(
            conn.execute(
                text("SELECT indexdef FROM pg_indexes WHERE tablename = :t"), {"t": _TABLE}
            ).scalars()
        )
    keys = [d.split(" USING btree ", 1)[-1].replace(" ", "") for d in definitions]
    assert "(season,date)" in keys, definitions


def test_both_teams_are_nullable_foreign_keys_to_teams(at_revision, engine):
    with engine.connect() as conn:
        definitions = list(
            conn.execute(
                text(
                    "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                    "WHERE conrelid = CAST(:t AS regclass) AND contype = 'f'"
                ),
                {"t": _TABLE},
            ).scalars()
        )
    # Whatever ON DELETE / ON UPDATE action the implementation picks.
    foreign_keys = sorted(re.sub(r" ON (DELETE|UPDATE) .*$", "", d) for d in definitions)
    assert foreign_keys == [
        "FOREIGN KEY (away_team_id) REFERENCES teams(id)",
        "FOREIGN KEY (home_team_id) REFERENCES teams(id)",
    ]


def test_no_existing_table_or_column_changes(alembic_config, engine):
    command.upgrade(alembic_config, _PARENT_REVISION)
    try:
        before = _every_other_table(engine)
        command.upgrade(alembic_config, _revision())
        after = _every_other_table(engine)
    finally:
        command.upgrade(alembic_config, "head")

    assert after == before


def test_downgrade_drops_the_table_and_upgrade_restores_it(alembic_config, engine):
    command.upgrade(alembic_config, _revision())
    try:
        assert _columns(engine, _TABLE)
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO scheduled_games (nba_game_id, season, date, time_tbd, game_type) "
                    "VALUES (22501201, '2025-26', '2025-12-09 00:00:00', true, 'regular')"
                )
            )

        command.downgrade(alembic_config, _PARENT_REVISION)

        assert _columns(engine, _TABLE) == {}
        command.upgrade(alembic_config, _revision())
        assert _columns(engine, _TABLE) == _COLUMNS
    finally:
        command.upgrade(alembic_config, "head")
