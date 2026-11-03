"""EVENTS-012's migration: player_season_totals and team_game_totals, created
and populated from the games and box scores already stored, and dropped
cleanly on downgrade. Written before the revision exists.

The new revision's parent is named explicitly (e8a6d4c2b901, POSTS-008's
history indexes, the head before EVENTS-012), not "-1", so this keeps meaning "undo this migration" after a
later revision becomes head (tests/test_migrations.py's lesson).

Every test leaves the database at head with the rows it wrote deleted.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text

from alembic import command
from app.db import make_engine
from tests.record_totals_support import TOTALS_TABLES, identity_pk, rebuilt_snapshots, snapshots

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_PARENT_REVISION = "e8a6d4c2b901"  # add_history_indexes (POSTS-008), head before EVENTS-012
_REVISION = "a8d3e5f1c2b7"  # add_record_totals, EVENTS-012

_STATS = (
    "field_goals_made",
    "field_goals_attempted",
    "three_pointers_made",
    "three_pointers_attempted",
    "free_throws_made",
    "free_throws_attempted",
    "offensive_rebounds",
    "defensive_rebounds",
    "rebounds",
    "assists",
    "steals",
    "blocks",
    "turnovers",
    "personal_fouls",
    "points",
    "plus_minus",
)


@pytest.fixture()
def alembic_config(postgres_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", postgres_url)
    return Config(str(_BACKEND_DIR / "alembic.ini"))


@pytest.fixture()
def engine(postgres_url):
    engine = make_engine(postgres_url)
    yield engine
    engine.dispose()


@pytest.fixture()
def at_head(alembic_config, engine):
    command.upgrade(alembic_config, "head")
    try:
        yield
    finally:
        command.upgrade(alembic_config, "head")
        with engine.begin() as conn:
            for table in TOTALS_TABLES:
                conn.execute(text(f"DELETE FROM {table}"))
            for table in ("player_game_stats", "players", "games", "teams"):
                conn.execute(text(f"DELETE FROM {table}"))


def _has_table(engine, table: str) -> bool:
    with engine.connect() as conn:
        return (
            conn.execute(
                text("SELECT 1 FROM information_schema.tables WHERE table_name = :t"), {"t": table}
            ).first()
            is not None
        )


def _insert_history(conn) -> None:
    """Two teams, three completed regular games and four Finals games (a
    champion), two players with a played line in every regular game."""
    team_ids = [
        conn.execute(
            text(
                "INSERT INTO teams (nba_team_id, name, abbreviation, conference, division)"
                " VALUES (:nba, :name, :abbr, 'East', 'Atlantic') RETURNING id"
            ),
            {"nba": nba, "name": f"{abbr} Team", "abbr": abbr},
        ).scalar_one()
        for nba, abbr in ((1610612761, "TOR"), (1610612738, "BOS"))
    ]
    player_ids = [
        conn.execute(
            text(
                "INSERT INTO players (nba_person_id, first_name, last_name)"
                " VALUES (:p, 'Test', :last) RETURNING id"
            ),
            {"p": person, "last": f"Player {person}"},
        ).scalar_one()
        for person in (9000001, 9000002)
    ]
    games = [(22400001 + n, "regular", None, f"2024-10-{22 + n} 19:30") for n in range(3)] + [
        (42400401 + n, "playoffs", "NBA Finals", f"2025-06-0{1 + n} 20:30") for n in range(4)
    ]
    for nba_game_id, game_type, label, when in games:
        game_id = conn.execute(
            text(
                "INSERT INTO games (nba_game_id, home_team_id, away_team_id, date, season,"
                " home_score, away_score, game_type, label)"
                " VALUES (:g, :home, :away, :when, '2024-25', 120, 110, :type, :label)"
                " RETURNING id"
            ),
            {
                "g": nba_game_id,
                "home": team_ids[0],
                "away": team_ids[1],
                "when": when,
                "type": game_type,
                "label": label,
            },
        ).scalar_one()
        if game_type != "regular":
            continue
        for player_id, team_id in zip(player_ids, team_ids, strict=True):
            conn.execute(
                text(
                    "INSERT INTO player_game_stats (game_id, player_id, team_id, starter,"
                    f" seconds_played, {', '.join(_STATS)})"
                    f" VALUES (:g, :p, :t, true, 1800, {', '.join(':' + s for s in _STATS)})"
                ),
                {"g": game_id, "p": player_id, "t": team_id, **dict.fromkeys(_STATS, 5)},
            )


def test_the_revision_is_the_single_head_and_chains_onto_the_parent():
    """Reads the scripts only, no database: one head, EVENTS-012's, whose
    parent is the head before it, so the history stays linear."""
    scripts = ScriptDirectory.from_config(Config(str(_BACKEND_DIR / "alembic.ini")))
    assert scripts.get_heads() == [_REVISION]
    assert scripts.get_revision(_REVISION).down_revision == _PARENT_REVISION


@pytest.mark.parametrize("table", TOTALS_TABLES)
def test_upgrade_head_creates_each_table_with_a_bigint_identity_key(at_head, engine, table):
    with engine.connect() as conn:
        assert identity_pk(conn, table) == ("bigint", "YES", "id")


def test_upgrade_populates_the_totals_from_the_stored_data(alembic_config, engine, at_head):
    command.downgrade(alembic_config, _PARENT_REVISION)
    with engine.begin() as conn:
        _insert_history(conn)

    command.upgrade(alembic_config, "head")

    with engine.connect() as conn:
        stored = snapshots(conn)
    assert all(stored.values()), {table: len(rows) for table, rows in stored.items()}
    assert stored == rebuilt_snapshots(engine)


def test_downgrade_to_the_parent_drops_both_and_upgrade_restores_them(
    alembic_config, engine, at_head
):
    with engine.begin() as conn:
        _insert_history(conn)
    assert all(_has_table(engine, table) for table in TOTALS_TABLES)

    command.downgrade(alembic_config, _PARENT_REVISION)

    assert [table for table in TOTALS_TABLES if _has_table(engine, table)] == []
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM games")).scalar_one() == 7

    command.upgrade(alembic_config, "head")

    assert all(_has_table(engine, table) for table in TOTALS_TABLES)
    with engine.connect() as conn:
        assert all(snapshots(conn).values())
