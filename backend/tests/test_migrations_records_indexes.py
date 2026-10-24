"""EVENTS-010's migration: the eight indexes the records read side needs on
the full NBA load, so each record's top-of-list and holder reads, and the
data window every records call reads first, are index scans, not scans of
every game or box-score row. Written before the revision exists.

Four partial indexes on one single-game stat each, over played lines; one
partial index on the played lines that are triple-doubles; one expression
index on a game's margin; one partial index on the NBA Finals games every
championship rule reads; one plain index on a game's season, for the data
window (records._window: min and max of games.season), which every records
call runs and which is otherwise a sequential scan of every game.

The new revision's parent is named explicitly (the head before EVENTS-010),
not "-1", so this test keeps meaning "undo this migration" after a later
revision becomes head -- the same lesson tests/test_migrations.py records.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import text

from alembic import command
from app.db import make_engine
from app.events.models import Game, PlayerGameStats

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_PARENT_REVISION = "d4f8b2e6a1c3"  # add_posts_linked_line_game_id, head before EVENTS-010

_PLAYED = "seconds_playedisnotnull"
_TRIPLE_DOUBLE_STATS = ("points", "rebounds", "assists", "steals", "blocks")


@dataclass(frozen=True)
class Expected:
    """An index as pg_indexes prints it, normalized by _squash: its table,
    its key (columns or expression) and the fragments its predicate must
    contain (None: not a partial index)."""

    table: str
    key: str
    where: tuple[str, ...] | None


INDEXES: dict[str, Expected] = {
    "ix_player_game_stats_points_played": Expected("player_game_stats", "points", (_PLAYED,)),
    "ix_player_game_stats_rebounds_played": Expected("player_game_stats", "rebounds", (_PLAYED,)),
    "ix_player_game_stats_assists_played": Expected("player_game_stats", "assists", (_PLAYED,)),
    "ix_player_game_stats_three_pointers_made_played": Expected(
        "player_game_stats", "three_pointers_made", (_PLAYED,)
    ),
    "ix_player_game_stats_triple_doubles": Expected(
        "player_game_stats", "player_id,game_id", (_PLAYED, *_TRIPLE_DOUBLE_STATS, "10")
    ),
    "ix_games_margin": Expected("games", "abshome_score-away_score", None),
    "ix_games_nba_finals": Expected(
        "games", "season", ("game_type", "'playoffs'", "label", "'nbafinals'")
    ),
    "ix_games_season": Expected("games", "season", None),
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
    """Lower case, without whitespace or parentheses: Postgres's own
    spacing and parenthesisation of an index definition is not the point."""
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
        assert table == expected.table, (name, definition)
        # "CREATE INDEX name ON public.table USING btree (key) [WHERE predicate]"
        key, _, predicate = definition.partition(" WHERE ")
        assert _squash(key.split(" USING btree ", 1)[1]) == expected.key, (name, definition)
        if expected.where is None:
            assert not predicate, (name, definition)
        else:
            assert predicate, f"{name} is not a partial index: {definition}"
            for fragment in expected.where:
                assert fragment in _squash(predicate), (name, fragment, definition)


def test_upgrade_head_adds_the_eight_records_indexes(alembic_config, engine):
    command.upgrade(alembic_config, "head")

    _assert_all_present(engine)


def test_downgrade_to_the_parent_removes_them_and_upgrade_restores_them(alembic_config, engine):
    command.upgrade(alembic_config, "head")
    command.downgrade(alembic_config, _PARENT_REVISION)

    assert _definitions(engine) == {}

    command.upgrade(alembic_config, "head")

    _assert_all_present(engine)


@pytest.mark.parametrize("name", list(INDEXES))
def test_the_models_declare_the_same_index(name):
    """Base.metadata.create_all (which the rest of the suite builds its schema
    from) must create each index too, not only the migration."""
    expected = INDEXES[name]
    table = {"player_game_stats": PlayerGameStats.__table__, "games": Game.__table__}[
        expected.table
    ]
    matches = [i for i in table.indexes if i.name == name]
    assert len(matches) == 1, f"{expected.table} declares no index {name}"
    where = matches[0].dialect_options["postgresql"]["where"]
    if expected.where is None:
        assert where is None, name
    else:
        assert where is not None, f"{name} must be partial (postgresql_where)"
