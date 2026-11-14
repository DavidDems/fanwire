"""Tests for EVENTS-004's Alembic migration, per AGENTS.md TDD workflow.
Written before that migration exists, so it is driven by "head"; its parent,
EVENTS-003's revision `c5e8a2d4f9b1`, is named.

Upgrade: adds `players` and `player_game_stats` (the box score), adds
games.label, sub_label, series_game_number, home_line_score and
away_line_score, and drops games.player_stats with its GIN index. Existing
teams and games keep their rows and ids. Downgrade reverses it, restoring
games.player_stats as an empty array on every row.

Every test that moves the database leaves it at head, with the rows it
committed deleted.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import text

from alembic import command
from app.db import make_engine

_BACKEND_DIR = Path(__file__).resolve().parents[1]

_PARENT_REVISION = "c5e8a2d4f9b1"


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
            conn.execute(text("DELETE FROM player_game_stats"))
            conn.execute(text("DELETE FROM players"))
            conn.execute(text("DELETE FROM games"))
            conn.execute(text("DELETE FROM teams"))


def _column(engine, table: str, column: str) -> dict | None:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT is_nullable, data_type FROM information_schema.columns "
                "WHERE table_name = :table AND column_name = :column"
            ),
            {"table": table, "column": column},
        ).first()
        return None if row is None else {"is_nullable": row[0], "data_type": row[1]}


def _has_table(engine, table: str) -> bool:
    with engine.connect() as conn:
        return (
            conn.execute(
                text("SELECT 1 FROM information_schema.tables WHERE table_name = :t"),
                {"t": table},
            ).first()
            is not None
        )


def _has_index(engine, index_name: str) -> bool:
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT 1 FROM pg_indexes WHERE indexname = :name"), {"name": index_name}
        ).first()
        return row is not None


def _indexed_columns(engine, table: str) -> set[tuple[str, ...]]:
    """Column lists of every index on `table`, unique constraints included."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT array_agg(a.attname ORDER BY k.ord) "
                "FROM pg_index i "
                "JOIN pg_class t ON t.oid = i.indrelid "
                "CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) "
                "JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum "
                "WHERE t.relname = :table GROUP BY i.indexrelid"
            ),
            {"table": table},
        ).all()
    return {tuple(row[0]) for row in rows}


def _insert_team_and_game(conn, *, at_parent: bool = False) -> tuple[int, int]:
    """At the parent revision games.player_stats is still required."""
    team = conn.execute(
        text(
            "INSERT INTO teams (nba_team_id, name, abbreviation, conference, division) "
            "VALUES (1610612761, 'Toronto Raptors', 'TOR', 'Eastern', 'Atlantic') RETURNING id"
        )
    ).scalar_one()
    extra_col, extra_val = (", player_stats", ", '[]'::jsonb") if at_parent else ("", "")
    game = conn.execute(
        text(
            "INSERT INTO games (nba_game_id, home_team_id, away_team_id, date, season, "
            f"home_score, away_score{extra_col}) VALUES (22400001, :t, :t, '2024-10-22', "
            f"'2024-25', 120, 115{extra_val}) RETURNING id"
        ),
        {"t": team},
    ).scalar_one()
    return team, game


# --------------------------------------------------------------------- upgrade


def test_upgrade_adds_players_and_player_game_stats(at_head, engine):
    assert _has_table(engine, "players")
    assert _has_table(engine, "player_game_stats")
    assert _column(engine, "players", "nba_person_id") == {
        "is_nullable": "NO",
        "data_type": "bigint",
    }
    assert _column(engine, "players", "id")["data_type"] == "bigint"
    assert _column(engine, "player_game_stats", "id")["data_type"] == "bigint"
    assert _column(engine, "player_game_stats", "seconds_played") == {
        "is_nullable": "YES",
        "data_type": "integer",
    }
    assert _column(engine, "player_game_stats", "dnp_reason")["is_nullable"] == "YES"
    assert _column(engine, "player_game_stats", "points")["is_nullable"] == "NO"


def test_upgrade_indexes_the_box_score_by_game_and_by_player(at_head, engine):
    indexed = _indexed_columns(engine, "player_game_stats")
    assert ("game_id", "player_id") in indexed
    assert ("player_id",) in indexed
    assert ("nba_person_id",) in _indexed_columns(engine, "players")


def test_upgrade_adds_game_labels_and_line_scores(at_head, engine):
    assert _column(engine, "games", "label") == {"is_nullable": "YES", "data_type": "text"}
    assert _column(engine, "games", "sub_label") == {"is_nullable": "YES", "data_type": "text"}
    assert _column(engine, "games", "series_game_number") == {
        "is_nullable": "YES",
        "data_type": "integer",
    }
    assert _column(engine, "games", "home_line_score") == {
        "is_nullable": "YES",
        "data_type": "ARRAY",
    }
    assert _column(engine, "games", "away_line_score") == {
        "is_nullable": "YES",
        "data_type": "ARRAY",
    }


def test_upgrade_drops_player_stats_and_its_index(at_head, engine):
    assert _column(engine, "games", "player_stats") is None
    assert not _has_index(engine, "ix_games_player_stats_gin")


def test_upgrade_keeps_existing_teams_and_games(alembic_config, engine, at_head):
    command.downgrade(alembic_config, _PARENT_REVISION)
    with engine.begin() as conn:
        team_id, game_id = _insert_team_and_game(conn, at_parent=True)

    command.upgrade(alembic_config, "head")

    with engine.connect() as conn:
        row = conn.execute(text("SELECT id, home_team_id, label, home_line_score FROM games")).one()
    assert tuple(row) == (game_id, team_id, None, None)


# --------------------------------------------------------------------- downgrade


def test_downgrade_restores_player_stats_and_drops_the_new_tables(alembic_config, engine, at_head):
    with engine.begin() as conn:
        _insert_team_and_game(conn)
    # Guard against a vacuous pass.
    assert _has_table(engine, "players")

    command.downgrade(alembic_config, _PARENT_REVISION)

    assert not _has_table(engine, "players")
    assert not _has_table(engine, "player_game_stats")
    for column in ("label", "sub_label", "series_game_number", "home_line_score"):
        assert _column(engine, "games", column) is None, column
    assert _column(engine, "games", "player_stats") == {
        "is_nullable": "NO",
        "data_type": "jsonb",
    }
    assert _has_index(engine, "ix_games_player_stats_gin")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT player_stats FROM games")).scalar_one() == []
