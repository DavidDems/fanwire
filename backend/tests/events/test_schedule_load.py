"""EVENTS-014: load_nba_history also loads each season's published schedule
(LeagueSchedule<YY>_<YY>.csv) into scheduled_games. Spec:
.ai/tasks/EVENTS-014/task.json. Written before the implementation.

The fixture's tests/fixtures/nba_data/LeagueSchedule25_26.csv has the real
2025-26 header and holds: the two 2025-26 games Games.csv already has
(22500001 regular, 42500101 NBA Finals Game 1), regular games not in it
(22500002-22500005; 22500004 and 22500005 start at the same minute), an
NBA Cup quarterfinal with undecided teams (0) and a midnight start
(22501201, blank arena), the Cup final with undecided teams and a set time
(62500001), a play-in game (52500201), an unplayed Finals Game 2
(42500102, "Game 2"), a preseason row (12500007), an All-Star row between
two teams no loader knows (32500011), and an identical duplicate of
22500002. There is no 2024-25 schedule file.

Every expected value comes from the fixture's CSVs read here
(tests/events/schedule_support.py), never from the loader.
"""

from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import func, select, text

from app.db import Base, make_engine, make_session_factory
from app.events import nba_history
from app.events.errors import UnrecognizedPlayerError, UnrecognizedTeamError
from app.events.models import Game, Player, PlayerGameStats, Team
from tests.events.schedule_support import (
    FIXTURE_DIR,
    SCHEDULE_25_26,
    SCHEDULE_HEADER,
    SCHEDULE_HEADER_24_25,
    clause_number,
    copy_fixture,
    expected_rows,
    fixture_schedule_rows,
    games_csv_ids,
    read_csv,
    schedule_lines,
    schedule_row,
    scheduled_game_model,
    stored_schedule,
    write_csv,
)

UNKNOWN_TEAM = "1610612999"
BOS, NYK, TOR, LAL = "1610612738", "1610612752", "1610612761", "1610612747"


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


def _load(session_factory, data_dir=FIXTURE_DIR, seasons=None):
    with session_factory() as session:
        return nba_history.load_nba_history(session, data_dir, seasons)


def _schedule(session_factory):
    with session_factory() as session:
        return stored_schedule(session)


def _assert_nothing_written(session_factory) -> None:
    model = scheduled_game_model()
    with session_factory() as session:
        for table in (Team, Game, Player, PlayerGameStats, model):
            count = session.scalar(select(func.count()).select_from(table))
            assert count == 0, table.__name__


def _edit_schedule(data_dir, match: str, **changes: str) -> None:
    path = data_dir / SCHEDULE_25_26
    header, rows = read_csv(path)
    hits = [row for row in rows if row["gameId"] == match]
    assert hits, match
    for row in hits:
        row.update(changes)
    write_csv(path, header, rows)


def _append_schedule(data_dir, row: dict[str, str]) -> None:
    path = data_dir / SCHEDULE_25_26
    header, rows = read_csv(path)
    rows.append(row)
    write_csv(path, header, rows)


# --------------------------------------------------------------------- the fixture


def test_the_fixture_holds_the_rows_the_spec_names():
    """Not the loader: the fixture itself has what criterion 17 asks for."""
    header, rows = read_csv(FIXTURE_DIR / SCHEDULE_25_26)
    assert header == SCHEDULE_HEADER
    ids = [row["gameId"] for row in rows]
    in_games = games_csv_ids()
    schedule_ids = {int(i) for i in ids}
    assert {22500001, 42500101} <= schedule_ids & in_games
    assert schedule_ids - in_games, "rows for games not in Games.csv"
    assert any(
        row["homeTeamId"] == "0" and row["gameDateTimeEst"].endswith("00:00:00") for row in rows
    )
    prefixes = {i[0] for i in ids}
    assert {"1", "2", "3", "4", "5", "6"} <= prefixes
    duplicated = [i for i in set(ids) if ids.count(i) > 1]
    assert duplicated and all(
        len({tuple(r.items()) for r in rows if r["gameId"] == i}) == 1 for i in duplicated
    )


# --------------------------------------------------------------------- stored rows


def test_a_full_load_stores_the_schedule_as_the_file_has_it(session_factory):
    _load(session_factory)

    expected, _ = expected_rows(fixture_schedule_rows())
    assert _schedule(session_factory) == expected


def test_each_id_prefix_follows_the_games_rule(session_factory):
    _load(session_factory)

    stored = _schedule(session_factory)
    assert stored[22500002].game_type == "regular"
    # An NBA Cup group and knockout game is a regular-season game.
    assert stored[22500003].game_type == "regular"
    assert stored[22501201].game_type == "regular"
    assert stored[62500001].game_type == "cup-final"
    assert stored[52500201].game_type == "play-in"
    assert stored[42500102].game_type == "playoffs"
    # Preseason and All-Star rows are skipped (the All-Star teams are no
    # league team, and that is never checked).
    assert 12500007 not in stored
    assert 32500011 not in stored


def test_a_game_already_played_is_also_a_schedule_row(session_factory):
    _load(session_factory)

    stored = _schedule(session_factory)
    assert {22500001, 42500101} <= set(stored)
    with session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Game)) == 8


def test_undecided_teams_are_null_and_a_midnight_start_is_time_tbd(session_factory):
    _load(session_factory)

    stored = _schedule(session_factory)
    quarterfinal = stored[22501201]
    assert (quarterfinal.home_nba_team_id, quarterfinal.away_nba_team_id) == (None, None)
    assert quarterfinal.time_tbd is True
    # The date is kept as written: midnight, not moved or dropped.
    assert quarterfinal.date == datetime(2025, 12, 9, 0, 0)
    assert quarterfinal.venue is None  # blank arenaName

    final = stored[62500001]
    assert (final.home_nba_team_id, final.away_nba_team_id) == (None, None)
    assert final.time_tbd is False
    assert final.date == datetime(2025, 12, 16, 20, 30)

    assert stored[22500002].time_tbd is False


def test_a_blank_team_is_also_undecided(session_factory, tmp_path):
    data_dir = copy_fixture(tmp_path)
    _edit_schedule(data_dir, "22500003", awayTeamId="")

    _load(session_factory, data_dir)

    game = _schedule(session_factory)[22500003]
    assert game.home_nba_team_id == 1610612744
    assert game.away_nba_team_id is None


def test_series_game_number_labels_and_venue(session_factory):
    _load(session_factory)

    stored = _schedule(session_factory)
    game_2 = stored[42500102]
    assert game_2.series_game_number == 2  # written "Game 2"
    assert (game_2.label, game_2.sub_label) == ("NBA Finals", "Game 2")
    assert game_2.venue == "Frost Bank Center"
    regular = stored[22500002]
    assert regular.series_game_number is None  # written ""
    assert (regular.label, regular.sub_label) == (None, None)
    assert stored[22500003].label == "Emirates NBA Cup"
    assert stored[22500003].sub_label == "West Group A"


@pytest.mark.parametrize("written", ["0", "0.0", "Game 0", ""])
def test_a_zero_or_blank_series_game_number_is_null(session_factory, tmp_path, written):
    data_dir = copy_fixture(tmp_path)
    _edit_schedule(data_dir, "52500201", seriesGameNumber=written)

    _load(session_factory, data_dir)

    assert _schedule(session_factory)[52500201].series_game_number is None


def test_identical_duplicates_are_stored_once(session_factory):
    _load(session_factory)

    model = scheduled_game_model()
    with session_factory() as session:
        count = session.scalar(
            select(func.count()).select_from(model).where(model.nba_game_id == 22500002)
        )
    assert count == 1


# --------------------------------------------------------------------- the report


def test_the_report_gives_the_season_schedule_counts(session_factory):
    report = _load(session_factory)

    _, counts = expected_rows(fixture_schedule_rows())
    lines = schedule_lines(report.lines(), "2025-26")
    assert len(lines) == 1, report.lines()
    line = lines[0]
    assert clause_number(line, "stored", "2025-26") == counts.stored
    assert clause_number(line, "undecided", "2025-26") == counts.undecided
    assert clause_number(line, "preseason", "2025-26") == counts.preseason
    assert clause_number(line, "All-Star", "2025-26") == counts.all_star
    assert clause_number(line, "duplicate", "2025-26") == counts.duplicates


def test_the_report_says_a_season_had_no_schedule_file(session_factory):
    report = _load(session_factory)

    lines = schedule_lines(report.lines(), "2024-25")
    assert len(lines) == 1, report.lines()
    assert "no schedule file" in lines[0].lower()


def test_every_existing_report_line_is_unchanged(engine, session_factory, tmp_path):
    """The lines a load without any schedule file gives are exactly the
    non-schedule lines of the same load with one."""
    without = copy_fixture(tmp_path)
    (without / SCHEDULE_25_26).unlink()
    before = _load(session_factory, without).lines()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)

    after = _load(session_factory).lines()

    def existing(lines: list[str]) -> list[str]:
        return [line for line in lines if "schedule" not in line.lower()]

    assert existing(after) == existing(before)
    assert len(existing(after)) == 2
    assert schedule_lines(after, "2025-26"), "the schedule load reported nothing"


# --------------------------------------------------------------------- which files


def test_seasons_none_reads_every_schedule_file_present(session_factory, tmp_path):
    data_dir = copy_fixture(tmp_path)
    rows = [
        schedule_row("22600001", "2026-10-20 15:00:00", "1610612765", BOS),
        schedule_row("22600002", "2026-10-20 19:00:00", NYK, "1610612755"),
        schedule_row(
            "22601201", "2026-12-04 00:00:00", "0", "0", arena="", label="Emirates NBA Cup"
        ),
    ]
    write_csv(data_dir / "LeagueSchedule26_27.csv", SCHEDULE_HEADER, rows)

    report = _load(session_factory, data_dir)

    stored = _schedule(session_factory)
    expected_26, _ = expected_rows(rows)
    assert {k: v for k, v in stored.items() if v.season == "2026-27"} == expected_26
    assert {v.season for v in stored.values()} == {"2025-26", "2026-27"}
    assert schedule_lines(report.lines(), "2026-27"), report.lines()


def test_a_schedule_file_before_2003_04_is_not_read(session_factory, tmp_path):
    data_dir = copy_fixture(tmp_path)
    (data_dir / "LeagueSchedule02_03.csv").write_text("not,a,schedule\n1,2,3\n", encoding="utf-8")

    _load(session_factory, data_dir)

    assert {v.season for v in _schedule(session_factory).values()} == {"2025-26"}


def test_only_the_requested_seasons_schedule_is_read(session_factory):
    report = _load(session_factory, seasons=["2024-25"])

    assert _schedule(session_factory) == {}
    assert schedule_lines(report.lines(), "2025-26") == []


def test_a_season_not_loaded_keeps_its_stored_schedule(session_factory, tmp_path):
    _load(session_factory)
    before = _schedule(session_factory)
    data_dir = copy_fixture(tmp_path)
    _edit_schedule(data_dir, "22500003", gameDateTimeEst="2025-11-04 22:00:00")

    _load(session_factory, data_dir, seasons=["2024-25"])

    assert _schedule(session_factory) == before


def test_a_missing_file_keeps_the_seasons_stored_schedule(session_factory, tmp_path):
    _load(session_factory)
    before = _schedule(session_factory)
    data_dir = copy_fixture(tmp_path)
    (data_dir / SCHEDULE_25_26).unlink()

    report = _load(session_factory, data_dir, seasons=["2025-26"])

    assert _schedule(session_factory) == before
    lines = schedule_lines(report.lines(), "2025-26")
    assert len(lines) == 1 and "no schedule file" in lines[0].lower(), report.lines()


# --------------------------------------------------------------------- the header


def _as_24_25_shape(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    """The rows as LeagueSchedule24_25.csv writes them: other column names
    and spellings, UTC timestamps."""
    return [
        {
            "gameId": row["gameId"],
            "gameDateTimeEst": row["gameDateTimeEst"] + "+00:00",
            "gameDay": row["gameDay"],
            "arenaCity": row["arenaCity"],
            "arenaState": row["arenaState"],
            "arenaName": row["arenaName"],
            "gameLabel": row["gameLabel"],
            "gameSubLabel": row["gameSubLabel"],
            "gameSubtype": row["gameSubtype"],
            "gameSequence": "1",
            "seriesGameNumber": row["seriesGameNumber"],
            "seriesText": "",
            "weekNumber": row["weekNumber"],
            "hometeamId": row["homeTeamId"],
            "awayteamId": row["awayTeamId"],
        }
        for row in rows
    ]


def test_a_2024_25_shaped_file_is_a_dataset_error_naming_it(session_factory, tmp_path):
    data_dir = copy_fixture(tmp_path)
    rows = [
        {**row, "gameId": "2240" + row["gameId"][4:]}
        for row in fixture_schedule_rows()
        if row["gameId"].startswith("225")
    ]
    write_csv(data_dir / "LeagueSchedule24_25.csv", SCHEDULE_HEADER_24_25, _as_24_25_shape(rows))

    with pytest.raises(nba_history.DatasetError) as raised:
        _load(session_factory, data_dir)

    assert "LeagueSchedule24_25.csv" in str(raised.value)
    _assert_nothing_written(session_factory)


@pytest.mark.parametrize(
    "column",
    [
        "gameId",
        "gameDateTimeEst",
        "homeTeamId",
        "awayTeamId",
        "arenaName",
        "gameLabel",
        "gameSubLabel",
        "seriesGameNumber",
    ],
)
def test_a_missing_column_is_a_dataset_error_naming_the_file(session_factory, tmp_path, column):
    data_dir = copy_fixture(tmp_path)
    path = data_dir / SCHEDULE_25_26
    header, rows = read_csv(path)
    header.remove(column)
    for row in rows:
        del row[column]
    write_csv(path, header, rows)

    with pytest.raises(nba_history.DatasetError) as raised:
        _load(session_factory, data_dir)

    assert SCHEDULE_25_26 in str(raised.value)
    _assert_nothing_written(session_factory)


# --------------------------------------------------------------------- bad rows


@pytest.mark.parametrize(
    ("game_id", "when"),
    [
        ("22400099", "2025-11-10 19:00:00"),  # a 2024-25 id in the 2025-26 file
        ("22600099", "2025-11-10 19:00:00"),  # a 2026-27 id
        ("2250009x", "2025-11-10 19:00:00"),
        ("225099", "2025-11-10 19:00:00"),
        ("", "2025-11-10 19:00:00"),
        ("22500099", "2025-13-10 19:00:00"),
        ("22500099", "not a date"),
        ("22500099", ""),
        ("22500099", "2025-11-10 19:00:00+00:00"),
    ],
    ids=[
        "wrong-season",
        "next-season",
        "id-not-a-number",
        "id-too-short",
        "id-blank",
        "date-month-13",
        "date-text",
        "date-blank",
        "date-with-utc-offset",
    ],
)
def test_a_bad_id_or_date_is_a_dataset_error(session_factory, tmp_path, game_id, when):
    data_dir = copy_fixture(tmp_path)
    _append_schedule(data_dir, schedule_row(game_id, when, BOS, NYK))

    with pytest.raises(nba_history.DatasetError):
        _load(session_factory, data_dir)

    _assert_nothing_written(session_factory)


@pytest.mark.parametrize(
    "change",
    [
        {"gameDateTimeEst": "2025-11-03 22:30:00"},
        {"awayTeamId": BOS},
        {"arenaName": "Another Arena"},
    ],
    ids=["time", "team", "arena"],
)
def test_conflicting_duplicate_rows_are_a_dataset_error(session_factory, tmp_path, change):
    data_dir = copy_fixture(tmp_path)
    source = next(row for row in fixture_schedule_rows() if row["gameId"] == "22500003")
    _append_schedule(data_dir, {**source, **change})

    with pytest.raises(nba_history.DatasetError) as raised:
        _load(session_factory, data_dir)

    assert "22500003" in str(raised.value)
    _assert_nothing_written(session_factory)


def test_an_unknown_team_is_unrecognized(session_factory, tmp_path):
    data_dir = copy_fixture(tmp_path)
    _edit_schedule(data_dir, "22500004", homeTeamId=UNKNOWN_TEAM)

    with pytest.raises(UnrecognizedTeamError) as raised:
        _load(session_factory, data_dir)

    assert UNKNOWN_TEAM in str(raised.value)
    _assert_nothing_written(session_factory)


# --------------------------------------------------------------------- reloads


def test_a_reload_replaces_the_seasons_schedule_as_a_whole(session_factory, tmp_path):
    _load(session_factory)
    data_dir = copy_fixture(tmp_path)
    path = data_dir / SCHEDULE_25_26
    header, rows = read_csv(path)
    # A cancelled game, a postponed game moved to a new id, a Cup
    # quarterfinal whose teams are now known, and a game added.
    rows = [row for row in rows if row["gameId"] not in ("22500004", "22500005")]
    for row in rows:
        if row["gameId"] == "22501201":
            row.update(
                homeTeamId=TOR, awayTeamId=NYK, gameDateTimeEst="2025-12-09 19:30:00", arenaName="X"
            )
        if row["gameId"] == "22500003":
            row.update(gameDateTimeEst="2025-11-03 22:30:00", arenaName="Chase Center (new)")
    rows.append(schedule_row("22501300", "2026-01-20 19:30:00", "1610612748", "1610612755"))
    rows.append(schedule_row("22500006", "2025-11-07 20:00:00", LAL, BOS))
    write_csv(path, header, rows)

    _load(session_factory, data_dir)

    expected, _ = expected_rows(rows)
    assert _schedule(session_factory) == expected
    assert 22500004 not in expected and 22500005 not in expected


def test_a_reload_of_the_same_file_changes_nothing(session_factory):
    _load(session_factory)
    before = _schedule(session_factory)

    _load(session_factory)

    assert _schedule(session_factory) == before


def test_a_failed_load_leaves_the_stored_schedule_as_it_was(session_factory, tmp_path):
    _load(session_factory)
    before = _schedule(session_factory)
    data_dir = copy_fixture(tmp_path)
    _edit_schedule(data_dir, "22500003", gameDateTimeEst="2025-11-04 22:00:00")
    # A later file breaks the run: the schedule change rolls back with it.
    path = data_dir / "PlayerStatistics.csv"
    header, box = read_csv(path)
    box.append({**next(r for r in box if r["gameId"] == "42500101"), "personId": "9999999"})
    write_csv(path, header, box)

    with pytest.raises(UnrecognizedPlayerError):
        _load(session_factory, data_dir)

    assert _schedule(session_factory) == before


def test_a_failed_schedule_file_leaves_the_stored_schedule_as_it_was(session_factory, tmp_path):
    _load(session_factory)
    before = _schedule(session_factory)
    data_dir = copy_fixture(tmp_path)
    _edit_schedule(data_dir, "22500003", gameDateTimeEst="2025-11-04 22:00:00")
    _append_schedule(data_dir, schedule_row("22400099", "2025-11-10 19:00:00", BOS, NYK))

    with pytest.raises(nba_history.DatasetError):
        _load(session_factory, data_dir)

    assert _schedule(session_factory) == before


def test_nothing_references_scheduled_games(engine):
    """Replacing a season's rows is safe only while no foreign key points
    at scheduled_games."""
    scheduled_game_model()  # the table exists
    with engine.connect() as conn:
        referencing = conn.execute(
            text(
                "SELECT conrelid::regclass::text FROM pg_constraint "
                "WHERE contype = 'f' AND confrelid = 'scheduled_games'::regclass"
            )
        ).all()
    assert referencing == []
