"""EVENTS-012: the eight partial indexes that serve the single-game player
lists measured over the 300 ms ceiling on the perf profile, each a parallel
sequential scan of player_game_stats with a sort that spills to disk.

EVENTS-010's pattern: one index per list, keyed on what the list ranks by
and restricted to played lines (`seconds_played IS NOT NULL`, the `played`
filter every single-game list applies), named
ix_player_game_stats_<stat>_played. Seven are keyed on a column; minutes
ranks on whole minutes (`seconds_played / 60`), so its key must be that
expression for the index to serve the ORDER BY. That the planner uses each
one is tests/events/test_records_indexes.py's job; this pins that the
migrations create them, the models declare them, and downgrading to the
head before EVENTS-012 (e8a6d4c2b901) removes them.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

from alembic import command
from app.db import make_engine
from app.events.models import PlayerGameStats

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_PARENT_REVISION = "e8a6d4c2b901"  # add_history_indexes (POSTS-008), head before EVENTS-012
_PLAYED = "seconds_playedisnotnull"


@dataclass(frozen=True)
class Expected:
    """An index's key as pg_indexes prints it, squashed by _squash."""

    key: str


INDEXES: dict[str, Expected] = {
    "ix_player_game_stats_plus_minus_played": Expected("plus_minus"),
    "ix_player_game_stats_free_throws_made_played": Expected("free_throws_made"),
    "ix_player_game_stats_blocks_played": Expected("blocks"),
    "ix_player_game_stats_defensive_rebounds_played": Expected("defensive_rebounds"),
    "ix_player_game_stats_steals_played": Expected("steals"),
    "ix_player_game_stats_minutes_played": Expected("seconds_played/60"),
    "ix_player_game_stats_offensive_rebounds_played": Expected("offensive_rebounds"),
    "ix_player_game_stats_field_goals_made_played": Expected("field_goals_made"),
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


def _squash(sql: str) -> str:
    """Lower case, without whitespace or parentheses."""
    return re.sub(r"[\s()]", "", sql).lower()


def _definitions(engine) -> dict[str, tuple[str, str]]:
    """Each of INDEXES that exists: name -> (table, indexdef)."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT indexname, tablename, indexdef FROM pg_indexes "
                "WHERE schemaname = 'public' AND indexname = ANY(:names)"
            ),
            {"names": list(INDEXES)},
        ).all()
    return {name: (table, definition) for name, table, definition in rows}


def _assert_all_present(engine) -> None:
    definitions = _definitions(engine)
    assert sorted(definitions) == sorted(INDEXES), "missing: " + ", ".join(
        sorted(set(INDEXES) - set(definitions))
    )
    for name, expected in INDEXES.items():
        table, definition = definitions[name]
        assert table == "player_game_stats", (name, definition)
        key, _, predicate = definition.partition(" WHERE ")
        assert _squash(key.split(" USING btree ", 1)[1]) == expected.key, (name, definition)
        assert _squash(predicate) == _PLAYED, f"{name} must be WHERE played: {definition}"


def test_upgrade_head_adds_the_eight_player_game_indexes(alembic_config, engine):
    command.upgrade(alembic_config, "head")

    _assert_all_present(engine)


def test_downgrade_to_the_parent_removes_them_and_upgrade_restores_them(alembic_config, engine):
    command.upgrade(alembic_config, "head")
    command.downgrade(alembic_config, _PARENT_REVISION)

    assert _definitions(engine) == {}

    command.upgrade(alembic_config, "head")

    _assert_all_present(engine)


@pytest.mark.parametrize("name", list(INDEXES))
def test_the_models_declare_the_same_partial_index(name):
    """Base.metadata.create_all, which the rest of the suite (and
    test_records_indexes.py) builds its schema from, must create it too."""
    matches = [i for i in PlayerGameStats.__table__.indexes if i.name == name]
    assert len(matches) == 1, f"player_game_stats declares no index {name}"
    where = matches[0].dialect_options["postgresql"]["where"]
    assert where is not None, f"{name} must be partial (postgresql_where)"
    compiled = str(where.compile(dialect=postgresql.dialect()))
    assert _squash(compiled) == "player_game_stats." + _PLAYED, (name, compiled)
