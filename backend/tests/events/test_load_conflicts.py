"""Tests for EVENTS-008's loader change: a stored game whose teams or final
score disagree with the dataset is skipped, reported and alarmed, never applied,
and no longer aborts the load.

Two layers, both on the synthetic fixture tests/events/test_nba_history.py uses:
- app.events.nba_history: GameConflict, SeasonReport.games_conflicting, the
  season's report line, atomicity, re-runs, what stays fatal; a season with a
  schedule file and no games; a Games.csv ahead of PlayerStatistics.csv.
- app.events.load_handler: the result's games_conflicting, one warning line per
  conflict, and the GamesConflicting EMF metric (namespace Fanwire/SportsData).
"""

from __future__ import annotations

import dataclasses
import json
import logging
import tempfile
from datetime import datetime
from pathlib import Path

import boto3
import pytest
from moto import mock_aws
from sqlalchemy import func, select, text

from app.db import Base, make_engine, make_session_factory
from app.events import load_handler, nba_history
from app.events.dataset import DatasetError
from app.events.errors import UnrecognizedTeamError
from app.events.models import Game, PlayerGameStats, Team
from tests.events.schedule_support import SCHEDULE_HEADER, schedule_row, write_csv
from tests.events.test_nba_history import (
    BOS,
    FIXTURE_DIR,
    LAL,
    NYK,
    TOR,
    UNKNOWN_TEAM,
    _box_count,
    _copy_fixture,
    _edit_rows,
    _game,
    _read_rows,
    _snapshot,
    _write_rows,
)

BUCKET = "fanwire-sports-data-test"
REGION = "ca-central-1"
FILES = ("Games.csv", "PlayerStatistics.csv", "TeamStatistics.csv", "Players.csv")
SEASONS = ["2024-25", "2025-26"]


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


_TEAM_NAMES = {
    TOR: ("Toronto Raptors", "TOR"),
    BOS: ("Boston Celtics", "BOS"),
    NYK: ("New York Knicks", "NYK"),
    LAL: ("Los Angeles Lakers", "LAL"),
}


def _team_id(session, nba_team_id: int) -> int:
    team = session.scalar(select(Team).where(Team.nba_team_id == nba_team_id))
    if team is None:
        name, abbreviation = _TEAM_NAMES[nba_team_id]
        team = Team(
            nba_team_id=nba_team_id,
            name=name,
            abbreviation=abbreviation,
            conference="Eastern",
            division="Atlantic",
        )
        session.add(team)
        session.flush()
    return team.id


def _store_game(
    session_factory,
    nba_game_id: int,
    home: int,
    away: int,
    scores: tuple[int, int],
    season: str = "2024-25",
) -> None:
    """A game as an earlier load stored it: no venue, no label, no box score."""
    with session_factory() as session:
        session.add(
            Game(
                nba_game_id=nba_game_id,
                home_team_id=_team_id(session, home),
                away_team_id=_team_id(session, away),
                date=datetime(2024, 10, 22),
                season=season,
                home_score=scores[0],
                away_score=scores[1],
                venue=None,
                game_type="regular",
            )
        )
        session.commit()


def _load(session_factory, data_dir=FIXTURE_DIR, seasons=None):
    with session_factory() as session:
        return nba_history.load_nba_history(session, data_dir, seasons)


def _scheduled_count(session_factory, season: str | None = None) -> int:
    query = "SELECT count(*) FROM scheduled_games"
    params: dict[str, str] = {}
    if season:
        query += " WHERE season = :season"
        params["season"] = season
    with session_factory() as session:
        return session.execute(text(query), params).scalar()


# --------------------------------------------------------------------- the report types


def test_game_conflict_is_a_frozen_dataclass_with_the_named_fields():
    assert dataclasses.is_dataclass(nba_history.GameConflict)
    assert [f.name for f in dataclasses.fields(nba_history.GameConflict)] == [
        "nba_game_id",
        "stored_home_nba_team_id",
        "stored_away_nba_team_id",
        "stored_home_score",
        "stored_away_score",
        "dataset_home_nba_team_id",
        "dataset_away_nba_team_id",
        "dataset_home_score",
        "dataset_away_score",
    ]
    conflict = nba_history.GameConflict(1, 2, 3, 4, 5, 6, 7, 8, 9)
    with pytest.raises(dataclasses.FrozenInstanceError):
        conflict.nba_game_id = 2  # type: ignore[misc]


def test_games_conflicting_defaults_to_an_empty_tuple():
    field = {f.name: f for f in dataclasses.fields(nba_history.SeasonReport)}["games_conflicting"]
    assert field.default == ()


def test_a_clean_load_has_no_conflicts_and_an_unchanged_report_line(session_factory):
    report = _load(session_factory)

    for season in report.seasons.values():
        assert season.games_conflicting == ()
        assert "conflict" not in season.line().lower()


# --------------------------------------------------------------------- the skip


def test_a_disagreeing_score_is_left_as_stored_and_named(session_factory):
    _store_game(session_factory, 22400001, TOR, BOS, (121, 115))

    report = _load(session_factory)

    assert report.seasons["2024-25"].games_conflicting == (
        nba_history.GameConflict(
            nba_game_id=22400001,
            stored_home_nba_team_id=TOR,
            stored_away_nba_team_id=BOS,
            stored_home_score=121,
            stored_away_score=115,
            dataset_home_nba_team_id=TOR,
            dataset_away_nba_team_id=BOS,
            dataset_home_score=120,
            dataset_away_score=115,
        ),
    )
    assert report.seasons["2025-26"].games_conflicting == ()
    with session_factory() as session:
        game = _game(session, 22400001)
        assert (game.home_score, game.away_score) == (121, 115)
        assert game.venue is None
        assert game.home_line_score is None
        assert _box_count(session, 22400001) == 0


def test_disagreeing_teams_are_left_as_stored_and_named(session_factory):
    # Stored with home and away swapped: the dataset says TOR (home) v BOS.
    _store_game(session_factory, 22400001, BOS, TOR, (120, 115))

    report = _load(session_factory)

    (conflict,) = report.seasons["2024-25"].games_conflicting
    assert conflict.nba_game_id == 22400001
    assert (conflict.stored_home_nba_team_id, conflict.stored_away_nba_team_id) == (BOS, TOR)
    assert (conflict.dataset_home_nba_team_id, conflict.dataset_away_nba_team_id) == (TOR, BOS)
    with session_factory() as session:
        game = _game(session, 22400001)
        home = session.get(Team, game.home_team_id)
        assert home.nba_team_id == BOS
        assert game.venue is None


def test_every_other_game_the_schedule_and_the_box_scores_load_in_the_same_run(session_factory):
    _store_game(session_factory, 22400001, TOR, BOS, (121, 115))

    report = _load(session_factory)

    season = report.seasons["2024-25"]
    assert season.games_loaded == 5  # the six stored games less the conflicting one
    assert season.games_updated == 0
    with session_factory() as session:
        assert _game(session, 22400002) is not None
        assert _game(session, 62400001) is not None
        assert _box_count(session, 22400002) > 0
        assert _game(session, 22500001) is not None
        assert _box_count(session, 22500001) > 0
    assert _scheduled_count(session_factory) > 0
    # The records library's totals are rebuilt in the same transaction.
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(PlayerGameStats)) > 0


def test_several_conflicts_are_all_named(session_factory):
    _store_game(session_factory, 22400001, TOR, BOS, (121, 115))
    _store_game(session_factory, 22400002, BOS, NYK, (111, 105))

    report = _load(session_factory)

    ids = sorted(c.nba_game_id for c in report.seasons["2024-25"].games_conflicting)
    assert ids == [22400001, 22400002]


def test_the_report_line_names_the_conflicting_games(session_factory):
    _store_game(session_factory, 22400001, TOR, BOS, (121, 115))
    _store_game(session_factory, 22400002, BOS, NYK, (111, 105))

    report = _load(session_factory)

    line = report.seasons["2024-25"].line()
    assert "conflict" in line.lower()
    assert "22400001" in line
    assert "22400002" in line
    assert "conflict" not in report.seasons["2025-26"].line().lower()
    assert any("22400001" in each for each in report.lines())


def test_a_second_run_reports_the_same_conflict_and_writes_nothing(session_factory):
    _store_game(session_factory, 22400001, TOR, BOS, (121, 115))
    first = _load(session_factory)
    with session_factory() as session:
        before = _snapshot(session)

    second = _load(session_factory)

    assert second.seasons["2024-25"].games_conflicting == first.seasons["2024-25"].games_conflicting
    assert len(second.seasons["2024-25"].games_conflicting) == 1
    assert second.seasons["2024-25"].games_loaded == 0
    with session_factory() as session:
        assert _snapshot(session) == before


def test_a_game_that_agrees_is_not_a_conflict(session_factory):
    _store_game(session_factory, 22400001, TOR, BOS, (120, 115))

    report = _load(session_factory)

    assert report.seasons["2024-25"].games_conflicting == ()


# --------------------------------------------------------------------- what stays fatal


def test_malformed_data_is_still_fatal_and_leaves_the_conflicting_game_as_stored(
    session_factory, tmp_path
):
    _store_game(session_factory, 22400001, TOR, BOS, (121, 115))
    with session_factory() as session:
        before = _snapshot(session)
    data_dir = _copy_fixture(tmp_path)
    path = data_dir / "PlayerStatistics.csv"
    header, rows = _read_rows(path)
    header.remove("numMinutes")
    for row in rows:
        del row["numMinutes"]
    _write_rows(path, header, rows)

    with session_factory() as session, pytest.raises(DatasetError) as excinfo:
        nba_history.load_nba_history(session, data_dir)

    assert "numMinutes" in str(excinfo.value)
    with session_factory() as session:
        assert _snapshot(session) == before


def test_an_unknown_team_is_still_fatal_beside_a_conflict(session_factory, tmp_path):
    _store_game(session_factory, 22400001, TOR, BOS, (121, 115))
    with session_factory() as session:
        before = _snapshot(session)
    data_dir = _copy_fixture(tmp_path)
    _edit_rows(data_dir / "Games.csv", {"gameId": "22400002"}, hometeamId=str(UNKNOWN_TEAM))

    with session_factory() as session, pytest.raises(UnrecognizedTeamError):
        nba_history.load_nba_history(session, data_dir)

    with session_factory() as session:
        assert _snapshot(session) == before


# --------------------------------------------------------------------- empty season


def test_a_season_with_a_schedule_file_and_no_games_loads_and_stores_its_schedule(
    session_factory, tmp_path
):
    data_dir = _copy_fixture(tmp_path)
    rows = [
        schedule_row("22600001", "2026-10-21 19:30:00", str(TOR), str(BOS)),
        schedule_row("22600002", "2026-10-21 22:00:00", str(LAL), str(NYK)),
    ]
    write_csv(data_dir / "LeagueSchedule26_27.csv", SCHEDULE_HEADER, rows)

    report = _load(session_factory, data_dir, seasons=["2026-27"])

    assert report.seasons["2026-27"].games_loaded == 0
    assert report.seasons["2026-27"].games_conflicting == ()
    assert "2026-27" in report.schedules
    assert _scheduled_count(session_factory, "2026-27") == 2
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Game)) == 0


# --------------------------------------------------------------------- mixed version


def _games_missing_box_scores(tmp_path: Path, nba_game_id: str) -> Path:
    """PlayerStatistics.csv one dataset version behind Games.csv: it does not
    yet have the game's rows."""
    data_dir = _copy_fixture(tmp_path)
    path = data_dir / "PlayerStatistics.csv"
    header, rows = _read_rows(path)
    _write_rows(path, header, [r for r in rows if r["gameId"] != nba_game_id])
    return data_dir


def test_a_games_file_ahead_of_the_box_scores_stores_the_game_and_the_next_run_completes_it(
    session_factory, tmp_path
):
    behind = _games_missing_box_scores(tmp_path, "22400002")
    _, full_rows = _read_rows(FIXTURE_DIR / "PlayerStatistics.csv")
    expected_rows = len({r["personId"] for r in full_rows if r["gameId"] == "22400002"})
    assert expected_rows > 0

    first = _load(session_factory, behind, seasons=["2024-25"])

    assert 22400002 in first.seasons["2024-25"].missing_box_scores
    with session_factory() as session:
        assert _game(session, 22400002) is not None
        assert _box_count(session, 22400002) == 0

    second = _load(session_factory, FIXTURE_DIR, seasons=["2024-25"])

    assert 22400002 not in second.seasons["2024-25"].missing_box_scores
    assert second.seasons["2024-25"].games_updated == 1
    assert second.seasons["2024-25"].games_conflicting == ()
    with session_factory() as session:
        assert _box_count(session, 22400002) == expected_rows
        assert _game(session, 22400002).home_score == 111


# --------------------------------------------------------------------- the handler


@pytest.fixture()
def env(monkeypatch, tmp_path, postgres_url, engine):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", postgres_url)
    monkeypatch.setenv("SPORTS_DATA_BUCKET", BUCKET)
    monkeypatch.setenv("AWS_DEFAULT_REGION", REGION)
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    root = tmp_path / "systemp"
    root.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(root))
    return postgres_url


@pytest.fixture()
def uploaded(env):
    with mock_aws():
        client = boto3.client("s3", region_name=REGION)
        client.create_bucket(
            Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": REGION}
        )
        for name in FILES:
            client.upload_file(str(FIXTURE_DIR / name), BUCKET, f"nba-eoin/{name}")
        yield client


class _Lines(logging.Handler):
    def __init__(self) -> None:
        super().__init__(level=logging.DEBUG)
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


@pytest.fixture()
def log_lines():
    handler = _Lines()
    logger = logging.getLogger(load_handler.logger.name)
    logger.addHandler(handler)
    yield handler
    logger.removeHandler(handler)


def _emf(captured_out: str) -> list[dict]:
    found = []
    for line in captured_out.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            doc = json.loads(line)
        except ValueError:
            continue
        if isinstance(doc, dict) and "_aws" in doc:
            found.append(doc)
    return found


def _games_conflicting_metric(captured_out: str) -> int:
    docs = [
        d
        for d in _emf(captured_out)
        if any(
            m["Name"] == "GamesConflicting"
            for directive in d["_aws"]["CloudWatchMetrics"]
            for m in directive["Metrics"]
        )
    ]
    assert len(docs) == 1, f"expected one GamesConflicting EMF line, saw {len(docs)}"
    doc = docs[0]
    (directive,) = [
        d
        for d in doc["_aws"]["CloudWatchMetrics"]
        if any(m["Name"] == "GamesConflicting" for m in d["Metrics"])
    ]
    assert directive["Namespace"] == "Fanwire/SportsData"
    (metric,) = [m for m in directive["Metrics"] if m["Name"] == "GamesConflicting"]
    assert metric["Unit"] == "Count"
    value = doc["GamesConflicting"]
    return value[0] if isinstance(value, list) else value


def test_the_result_lists_each_seasons_conflicts_as_dicts(env, engine, uploaded):
    _store_game(make_session_factory(engine), 22400001, TOR, BOS, (121, 115))

    result = load_handler.handler({"seasons": SEASONS}, None)

    result = json.loads(json.dumps(result))
    assert result["seasons"]["2024-25"]["games_conflicting"] == [
        {
            "nba_game_id": 22400001,
            "stored_home_nba_team_id": TOR,
            "stored_away_nba_team_id": BOS,
            "stored_home_score": 121,
            "stored_away_score": 115,
            "dataset_home_nba_team_id": TOR,
            "dataset_away_nba_team_id": BOS,
            "dataset_home_score": 120,
            "dataset_away_score": 115,
        }
    ]
    assert result["seasons"]["2025-26"]["games_conflicting"] == []
    assert any("22400001" in line for line in result["lines"])
    with make_session_factory(engine)() as session:
        assert _game(session, 22400002) is not None
        assert _game(session, 22400001).home_score == 121


def test_one_warning_is_logged_per_conflict_and_none_when_clean(env, engine, uploaded, log_lines):
    factory = make_session_factory(engine)
    _store_game(factory, 22400001, TOR, BOS, (121, 115))
    _store_game(factory, 22500001, TOR, LAL, (124, 120), season="2025-26")

    load_handler.handler({"seasons": SEASONS}, None)

    warnings = [r for r in log_lines.records if r.levelno == logging.WARNING]
    assert len(warnings) == 2
    text_of = [
        r.getMessage() + json.dumps(getattr(r, "__dict__", {}), default=str) for r in warnings
    ]
    assert any("22400001" in each for each in text_of)
    assert any("22500001" in each for each in text_of)


def test_no_warning_is_logged_for_a_clean_load(env, uploaded, log_lines):
    load_handler.handler({"seasons": SEASONS}, None)

    assert [r for r in log_lines.records if r.levelno >= logging.WARNING] == []


def test_the_metric_is_the_runs_total_across_seasons(env, engine, uploaded, capsys):
    factory = make_session_factory(engine)
    _store_game(factory, 22400001, TOR, BOS, (121, 115))
    _store_game(factory, 22500001, TOR, LAL, (124, 120), season="2025-26")
    capsys.readouterr()

    load_handler.handler({"seasons": SEASONS}, None)

    assert _games_conflicting_metric(capsys.readouterr().out) == 2


def test_the_metric_is_zero_when_there_are_no_conflicts(env, uploaded, capsys):
    capsys.readouterr()

    load_handler.handler({"seasons": SEASONS}, None)

    assert _games_conflicting_metric(capsys.readouterr().out) == 0


def test_a_conflict_reported_again_on_the_next_run_is_counted_again(env, engine, uploaded, capsys):
    _store_game(make_session_factory(engine), 22400001, TOR, BOS, (121, 115))
    load_handler.handler({"seasons": SEASONS}, None)
    capsys.readouterr()

    load_handler.handler({"seasons": SEASONS}, None)

    assert _games_conflicting_metric(capsys.readouterr().out) == 1
