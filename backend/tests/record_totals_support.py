"""Readers for EVENTS-012's two aggregate tables, player_season_totals and
team_game_totals, shared by the totals, load-path and migration tests.

Column names are the implementation's to choose, so the readers compare
whole rows (every column but the identity `id`, which a rebuild may
renumber). The only columns named anywhere are `player_id`, `season` and
`team_id` of player_season_totals (the brief's "Shape notes").
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

TOTALS_TABLES: tuple[str, ...] = ("player_season_totals", "team_game_totals")


def snapshot(session_or_conn: Any, table: str, where: str = "") -> list[tuple]:
    """Every row of `table` but its id, sorted, as (column, value) tuples."""
    result = session_or_conn.execute(text(f"SELECT * FROM {table} {where}"))
    rows = [
        tuple(sorted((k, v) for k, v in row.items() if k != "id"))
        for row in result.mappings().all()
    ]
    return sorted(rows, key=repr)


def snapshots(session_or_conn: Any) -> dict[str, list[tuple]]:
    return {table: snapshot(session_or_conn, table) for table in TOTALS_TABLES}


def rebuilt_snapshots(engine: Engine) -> dict[str, list[tuple]]:
    """What rebuild_record_totals makes of the stored data now, read in a
    transaction that is then rolled back."""
    from app.events import records

    with Session(engine) as session:
        records.rebuild_record_totals(session)
        found = snapshots(session)
        session.rollback()
    return found


def identity_pk(conn: Any, table: str) -> tuple[str, str, str] | None:
    """(data_type, is_identity, primary-key column) of `table`'s id."""
    row = conn.execute(
        text(
            "SELECT c.data_type, c.is_identity,"
            " (SELECT string_agg(k.column_name, ',') FROM information_schema.table_constraints t"
            "  JOIN information_schema.key_column_usage k"
            "    ON k.constraint_name = t.constraint_name AND k.table_name = t.table_name"
            "  WHERE t.table_name = :table AND t.constraint_type = 'PRIMARY KEY')"
            " FROM information_schema.columns c"
            " WHERE c.table_name = :table AND c.column_name = 'id'"
        ),
        {"table": table},
    ).first()
    return tuple(row) if row is not None else None
