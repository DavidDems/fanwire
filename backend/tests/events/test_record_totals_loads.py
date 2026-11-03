"""EVENTS-012: load_nba_history rebuilds the record totals in its own
transaction. Spec: .ai/tasks/EVENTS-012/ (criterion 11).

Pinned, on EVENTS-004's synthetic dataset (tests/fixtures/nba_data/):

- When the load commits, the totals already match the loaded data: the
  rebuild runs before the load's one commit, not after it in another.
- A load that adds a game changes a season total: the first load lacks
  22400001 (TOR 120 - BOS 115, 2024-25); the second, of the whole dataset,
  adds it, and BOS's players already had 2024-25 rows from 22400002.
- A failed load leaves the old totals exactly as they were.

load_handler, the scale fixture and seed_perf are pinned beside their own
tests (test_load_handler.py, test_generate_scale_fixture.py,
test_seed_perf.py).
"""

from __future__ import annotations

import csv
import shutil
from pathlib import Path

import pytest

from app.db import Base, make_engine, make_session_factory
from app.events import nba_history
from tests.record_totals_support import TOTALS_TABLES, rebuilt_snapshots, snapshot, snapshots

_BACKEND_DIR = Path(__file__).resolve().parents[2]
FIXTURE_DIR = _BACKEND_DIR / "tests" / "fixtures" / "nba_data"
ADDED_GAME = "22400001"
BOS = "1610612738"


@pytest.fixture()
def engine(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def session_factory(engine):
    return make_session_factory(engine)


def _without_game(tmp_path: Path, nba_game_id: str) -> Path:
    data_dir = tmp_path / "nba"
    shutil.copytree(FIXTURE_DIR, data_dir)
    path = data_dir / "Games.csv"
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        header = list(reader.fieldnames or [])
        rows = [row for row in reader if row["gameId"] != nba_game_id]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=header, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    return data_dir


def _with_unknown_team_in_a_box_score(tmp_path: Path) -> Path:
    data_dir = tmp_path / "bad"
    shutil.copytree(FIXTURE_DIR, data_dir)
    path = data_dir / "PlayerStatistics.csv"
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        header = list(reader.fieldnames or [])
        rows = list(reader)
    team_column = "playerteamId"
    hit = next(r for r in rows if r["gameId"] == ADDED_GAME and r[team_column].strip())
    hit[team_column] = "1610612999"
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=header, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    return data_dir


def _bos_season_rows(engine) -> list[tuple]:
    with engine.connect() as conn:
        return snapshot(
            conn,
            "player_season_totals",
            "WHERE season = '2024-25' AND team_id = "
            f"(SELECT id FROM teams WHERE nba_team_id = {BOS})",
        )


def test_the_totals_match_the_data_when_the_load_commits(engine, session_factory, monkeypatch):
    seen: list[dict] = []
    with session_factory() as session:
        commit = session.commit

        def spying_commit() -> None:
            seen.append(snapshots(session))
            commit()

        monkeypatch.setattr(session, "commit", spying_commit)
        nba_history.load_nba_history(session, FIXTURE_DIR)

    assert seen, "the load never committed"
    at_commit = seen[0]
    assert all(at_commit[table] for table in TOTALS_TABLES), at_commit
    assert at_commit == rebuilt_snapshots(engine)


def test_a_load_that_adds_a_game_changes_a_season_total(engine, session_factory, tmp_path):
    with session_factory() as session:
        nba_history.load_nba_history(session, _without_game(tmp_path, ADDED_GAME))
    before = _bos_season_rows(engine)
    assert before, "BOS's players have 2024-25 rows from 22400002"

    with session_factory() as session:
        nba_history.load_nba_history(session, FIXTURE_DIR)

    after = _bos_season_rows(engine)
    assert after != before
    with engine.connect() as conn:
        assert snapshots(conn) == rebuilt_snapshots(engine)


def test_a_failed_load_leaves_the_old_totals(engine, session_factory, tmp_path):
    with session_factory() as session:
        nba_history.load_nba_history(session, _without_game(tmp_path, ADDED_GAME))
    with engine.connect() as conn:
        before = snapshots(conn)
    assert all(before.values())

    with session_factory() as session, pytest.raises(Exception):  # noqa: B017
        nba_history.load_nba_history(session, _with_unknown_team_in_a_box_score(tmp_path))

    with engine.connect() as conn:
        assert snapshots(conn) == before


def test_a_load_that_fails_at_its_commit_leaves_the_old_totals(
    engine, session_factory, tmp_path, monkeypatch
):
    """Fails after every write, the rebuild's among them: one transaction."""
    with session_factory() as session:
        nba_history.load_nba_history(session, _without_game(tmp_path, ADDED_GAME))
    with engine.connect() as conn:
        before = snapshots(conn)

    with session_factory() as session:

        def failing_commit() -> None:
            raise RuntimeError("the commit failed")

        monkeypatch.setattr(session, "commit", failing_commit)
        with pytest.raises(RuntimeError):
            nba_history.load_nba_history(session, FIXTURE_DIR)

    with engine.connect() as conn:
        assert snapshots(conn) == before
