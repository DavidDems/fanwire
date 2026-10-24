"""EVENTS-010: each records index serves its record as the app runs it.

The migration test (tests/test_migrations_records_indexes.py) proves the
indexes exist; this proves they are used. For each of the seven indexed
records, and for the data window every records call runs first (the
eighth index, ix_games_season: min and max of games.season), the exact
statements the app sends (records_summary's holder statement and
record_list's page statement, and each one's window statement, with their
bound parameters) are captured, then explained on the same connection, after ANALYZE, with
the planner told to avoid sequential scans, bitmap scans and explicit sorts
(_PLANNER_SETTINGS). Those are cost penalties, not bans: what is left
cheapest is a plain index scan that answers the query's filter, and, for a
top-of-list record, its ORDER BY. So an index missing from the plan means
its key or predicate no longer matches the query: a later change to a
candidates query, or to an index, that silently drops it back to a full
scan fails here.

Why not seqscans alone: on a fixture this small the planner then reads
"seconds_played IS NOT NULL" through whichever of the four identically
predicated single-stat indexes it likes (a bitmap scan) and sorts the few
hundred rows, or drives the triple-double count from games through the
unique (game_id, player_id) index. Both are right for 400 rows and wrong
for the full load; the settings above make the tiny fixture plan like the
large one. Costs and timings are not asserted; the fixture is far too
small for them to mean anything.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session

from app.db import Base, make_session_factory
from app.events.records import RECORDS, record_list, records_summary
from tests.events.players_support import make_players_engine
from tests.events.records_support import build_fixture

# record id -> the index that must serve it
RECORD_INDEXES: tuple[tuple[str, str], ...] = (
    ("player-points-game", "ix_player_game_stats_points_played"),
    ("player-rebounds-game", "ix_player_game_stats_rebounds_played"),
    ("player-assists-game", "ix_player_game_stats_assists_played"),
    ("player-threes-game", "ix_player_game_stats_three_pointers_made_played"),
    ("player-career-triple-doubles", "ix_player_game_stats_triple_doubles"),
    ("team-largest-win", "ix_games_margin"),
    ("player-championships", "ix_games_nba_finals"),
)

# The index that must serve the data window (records._window), the first
# statement of every records call.
WINDOW_INDEX = "ix_games_season"

# Each set off with SET LOCAL, for the EXPLAIN's transaction only.
_PLANNER_SETTINGS: tuple[str, ...] = ("enable_seqscan", "enable_bitmapscan", "enable_sort")


@dataclass
class Executed:
    """The statements sent to the database, each with its DBAPI parameters."""

    statements: list[tuple[str, Any]] = field(default_factory=list)


@contextmanager
def executed(engine: Engine) -> Iterator[Executed]:
    """Like records_support.recorded_queries, but keeping the parameters, so
    a statement can be sent again exactly as the app sent it."""
    log = Executed()

    def _before(
        conn: Any, cursor: Any, statement: str, parameters: Any, context: Any, executemany: bool
    ) -> None:
        log.statements.append((statement, parameters))

    event.listen(engine, "before_cursor_execute", _before)
    try:
        yield log
    finally:
        event.remove(engine, "before_cursor_execute", _before)


def _plan(session: Session, statement: str, parameters: Any) -> str:
    """EXPLAIN of a captured statement, on the session's connection and in its
    transaction, with _PLANNER_SETTINGS off for that transaction only."""
    conn = session.connection()
    for setting in _PLANNER_SETTINGS:
        conn.exec_driver_sql(f"SET LOCAL {setting} = off")
    rows = conn.exec_driver_sql("EXPLAIN " + statement, parameters).scalars().all()
    return "\n".join(rows)


@pytest.fixture(scope="module")
def engine(postgres_url):
    engine = make_players_engine(postgres_url)
    with make_session_factory(engine)() as session:
        build_fixture(session)
        session.commit()
    with engine.begin() as conn:
        conn.exec_driver_sql("ANALYZE")
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def session(engine):
    with make_session_factory(engine)() as session:
        yield session
        session.rollback()


@pytest.mark.parametrize(("record_id", "index"), RECORD_INDEXES)
def test_the_list_statement_uses_the_records_index(engine, session, record_id, index):
    with executed(engine) as log:
        result = record_list(session, record_id, limit=100, offset=0)
    assert result is not None
    # The data window, then the page with its total.
    assert len(log.statements) == 2, [s for s, _ in log.statements]
    statement, parameters = log.statements[-1]

    plan = _plan(session, statement, parameters)

    assert index in plan, f"{record_id}'s list does not use {index}:\n{plan}"


@pytest.mark.parametrize(("record_id", "index"), RECORD_INDEXES)
def test_the_summary_holder_statement_uses_the_records_index(engine, session, record_id, index):
    with executed(engine) as log:
        records_summary(session)
    # The data window, then one holder statement per record in RECORDS order.
    assert len(log.statements) == 1 + len(RECORDS), [s for s, _ in log.statements]
    position = [record.id for record in RECORDS].index(record_id)
    statement, parameters = log.statements[1 + position]

    plan = _plan(session, statement, parameters)

    assert index in plan, f"{record_id}'s holder does not use {index}:\n{plan}"


@pytest.mark.parametrize(
    "call",
    [
        pytest.param(
            lambda s: record_list(s, "player-points-game", limit=100, offset=0), id="list"
        ),
        pytest.param(records_summary, id="summary"),
    ],
)
def test_the_window_statement_uses_the_season_index(engine, session, call):
    with executed(engine) as log:
        call(session)
    # The data window is the first statement of every records call.
    assert log.statements, "no statement was sent"
    statement, parameters = log.statements[0]
    assert "min(games.season)" in statement and "max(games.season)" in statement, statement

    plan = _plan(session, statement, parameters)

    assert WINDOW_INDEX in plan, f"the data window does not use {WINDOW_INDEX}:\n{plan}"
