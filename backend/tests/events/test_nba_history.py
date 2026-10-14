"""Tests for app.events.nba_history.load_nba_history (EVENTS-004), per
AGENTS.md TDD workflow. Written before the loader reads the new dataset.

The loader reads the Eoin Moore Kaggle dataset's Games.csv,
PlayerStatistics.csv, TeamStatistics.csv and Players.csv. These tests run
against a small synthetic fixture with the dataset's exact column names
(tests/fixtures/nba_data/), never the dataset itself. Its players are
invented. Each team's five players score 30/25/20/15/10 % of its points
(rounded down, the remainder to the first). What it holds:

2024-25:
- 22400001 regular, TOR 120 - BOS 115, Scotiabank Arena. Repeated verbatim in
  Games.csv. TOR's minutes are written minutes.seconds ("47.5" = 47:50); four
  starters, one bench player (9000005), one DNP (9000006, "DNP - Coach's
  Decision"). BOS's are whole minutes; its fifth row has a blank
  playerteamId, and its first player (9000101) is repeated with 99 points.
- 22400002 NBA Cup group game typed "Regular Season", BOS 111 - NYK 104.
  BOS's minutes are true decimals ("39.166666666666664"). NYK's players add
  up to 102, two short of its score. One row per team has a blank
  playerteamId.
- 22400003 regular, GSW 101 - LAL 99, no box score at all.
- 22400004 regular, SAS 0 - LAL 0: no final score.
- 12400001 preseason (with a player, 9000099, who appears nowhere else).
- 32400001 All-Star, between two teams no loader knows.
- 62400001 NBA Cup final, NYK 97 - SAS 81, "Championship".
- 52400001 play-in, LAL 103 - GSW 100.
- 42400405 NBA Finals Game 5 (seriesGameNumber "5.0"), BOS 110 - GSW 108 in
  one overtime.

2025-26 (numbers written as ints, not floats):
- 22500001 regular, TOR 124 - LAL 123 in three overtimes. LAL's minutes fit
  neither reading of the team's 315 minutes.
- 42500101 NBA Finals Game 1 (seriesGameNumber "Game 1"), SAS 105 - NYK 100.

Players.csv also holds 9000098, who is in no box score.

Failure cases build modified copies of the fixture in tmp_path.
"""

from __future__ import annotations

import csv
import os
import shutil
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import func, select

from alembic import command
from app.db import Base, make_engine, make_session_factory
from app.events import nba_history
from app.events.errors import UnrecognizedPlayerError, UnrecognizedTeamError
from app.events.models import Game, Player, PlayerGameStats, Team

_BACKEND_DIR = Path(__file__).resolve().parents[2]
FIXTURE_DIR = _BACKEND_DIR / "tests" / "fixtures" / "nba_data"

TOR = 1610612761
BOS = 1610612738
NYK = 1610612752
GSW = 1610612744
LAL = 1610612747
SAS = 1610612759
UNKNOWN_TEAM = 1610612999


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def loaded(session_factory):
    """The whole fixture loaded once; returns the report."""
    with session_factory() as session:
        return nba_history.load_nba_history(session, FIXTURE_DIR)


# --------------------------------------------------------------------- helpers


def _copy_fixture(tmp_path: Path) -> Path:
    data_dir = tmp_path / "nba"
    shutil.copytree(FIXTURE_DIR, data_dir)
    return data_dir


def _read_rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return list(reader.fieldnames or []), list(reader)


def _write_rows(path: Path, header: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=header, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def _append_copy(path: Path, match: dict[str, str], **changes: str) -> None:
    """Append a copy of the first row matching `match`, with `changes`."""
    header, rows = _read_rows(path)
    source = next(r for r in rows if all(r[k] == v for k, v in match.items()))
    unknown = set(changes) - set(header)
    assert not unknown, f"not columns of {path.name}: {unknown}"
    rows.append({**source, **changes})
    _write_rows(path, header, rows)


def _edit_rows(path: Path, match: dict[str, str], **changes: str) -> None:
    header, rows = _read_rows(path)
    hits = 0
    for row in rows:
        if all(row[k] == v for k, v in match.items()):
            row.update(changes)
            hits += 1
    assert hits, f"no row of {path.name} matches {match}"
    _write_rows(path, header, rows)


def _count(session, model) -> int:
    return session.scalar(select(func.count()).select_from(model))


def _team(session, nba_team_id: int) -> Team:
    team = session.scalar(select(Team).where(Team.nba_team_id == nba_team_id))
    assert team is not None, f"no Team with nba_team_id={nba_team_id}"
    return team


def _game(session, nba_game_id: int) -> Game | None:
    return session.scalar(select(Game).where(Game.nba_game_id == nba_game_id))


def _player(session, nba_person_id: int) -> Player | None:
    return session.scalar(select(Player).where(Player.nba_person_id == nba_person_id))


def _box_row(session, nba_game_id: int, nba_person_id: int) -> PlayerGameStats:
    row = session.scalar(
        select(PlayerGameStats)
        .join(Game, PlayerGameStats.game_id == Game.id)
        .join(Player, PlayerGameStats.player_id == Player.id)
        .where(Game.nba_game_id == nba_game_id, Player.nba_person_id == nba_person_id)
    )
    assert row is not None, f"no box-score row for player {nba_person_id} in {nba_game_id}"
    return row


def _box_count(session, nba_game_id: int) -> int:
    return session.scalar(
        select(func.count())
        .select_from(PlayerGameStats)
        .join(Game, PlayerGameStats.game_id == Game.id)
        .where(Game.nba_game_id == nba_game_id)
    )


def _naive(value: datetime) -> datetime:
    return value.replace(tzinfo=None)


def _snapshot(session) -> tuple[list[tuple], ...]:
    teams = session.execute(
        select(Team.id, Team.nba_team_id, Team.name, Team.abbreviation).order_by(Team.id)
    ).all()
    games = session.execute(
        select(
            Game.id,
            Game.nba_game_id,
            Game.date,
            Game.home_score,
            Game.away_score,
            Game.venue,
            Game.label,
            Game.home_line_score,
        ).order_by(Game.id)
    ).all()
    players = session.execute(
        select(Player.id, Player.nba_person_id, Player.last_name).order_by(Player.id)
    ).all()
    box = session.execute(
        select(
            PlayerGameStats.id,
            PlayerGameStats.game_id,
            PlayerGameStats.player_id,
            PlayerGameStats.points,
            PlayerGameStats.seconds_played,
        ).order_by(PlayerGameStats.id)
    ).all()
    return tuple([tuple(r) for r in rows] for rows in (teams, games, players, box))


def _assert_empty(session_factory) -> None:
    with session_factory() as session:
        for model in (Team, Game, Player, PlayerGameStats):
            assert _count(session, model) == 0, model.__name__


# --------------------------------------------------------------------- teams


def test_load_creates_every_team_with_its_conference_and_division(loaded, session_factory):
    assert isinstance(loaded, nba_history.LoadReport)
    assert loaded.teams_created == 30

    with session_factory() as session:
        assert _count(session, Team) == 30

        tor = _team(session, TOR)
        assert (tor.name, tor.abbreviation, tor.conference, tor.division) == (
            "Toronto Raptors",
            "TOR",
            "Eastern",
            "Atlantic",
        )
        assert tor.logo_url is None
        sas = _team(session, SAS)
        assert (sas.name, sas.abbreviation, sas.conference, sas.division) == (
            "San Antonio Spurs",
            "SAS",
            "Western",
            "Southwest",
        )
        assert _team(session, GSW).abbreviation == "GSW"


def test_an_existing_team_keeps_its_id_and_its_row(session_factory):
    with session_factory() as session:
        team = Team(
            nba_team_id=TOR,
            name="Raptors (dev)",
            abbreviation="TOR",
            conference="Eastern",
            division="Atlantic",
        )
        session.add(team)
        session.commit()
        team_id = team.id

    with session_factory() as session:
        report = nba_history.load_nba_history(session, FIXTURE_DIR)

    assert report.teams_created == 29
    with session_factory() as session:
        tor = _team(session, TOR)
        assert tor.id == team_id
        assert tor.name == "Raptors (dev)"
        assert _game(session, 22400001).home_team_id == team_id


# --------------------------------------------------------------------- players


def test_load_stores_every_player_of_a_loaded_box_score_and_no_other(loaded, session_factory):
    assert loaded.players_created == 31

    with session_factory() as session:
        assert _count(session, Player) == 31
        assert _player(session, 9000098) is None  # in no box score
        assert _player(session, 9000099) is None  # only in a preseason game
        assert _player(session, 9000006) is not None  # a DNP is still in the box score


def test_player_attributes_come_from_players_csv(loaded, session_factory):
    with session_factory() as session:
        ada = _player(session, 9000001)
        assert (ada.first_name, ada.last_name) == ("Ada", "Forward")
        assert ada.birth_date == date(2001, 8, 1)
        assert ada.height_inches == 79
        assert ada.weight_lbs == 237
        assert ada.country == "Canada"
        assert ada.school == "Florida State"
        assert ada.jersey == "4"
        assert ada.position == "F"
        assert (ada.draft_year, ada.draft_round, ada.draft_number) == (2021, 1, 4)
        # fromYear/toYear are the start years of the first and last season.
        assert (ada.first_season, ada.last_season) == ("2021-22", "2025-26")


def test_player_position_combines_the_guard_forward_center_flags(loaded, session_factory):
    with session_factory() as session:
        assert _player(session, 9000002).position == "G-F"
        assert _player(session, 9000004).position == "F-C"
        assert _player(session, 9000005).position == "G"
        assert _player(session, 9000104).position == "C"


def test_blank_player_attributes_are_stored_as_null(loaded, session_factory):
    with session_factory() as session:
        p = _player(session, 9000003)
        assert p.first_name is None
        assert p.last_name == "Mononym"
        for attr in (
            "birth_date",
            "height_inches",
            "weight_lbs",
            "country",
            "school",
            "jersey",
            "position",
            "draft_year",
            "draft_round",
            "draft_number",
            "first_season",
            "last_season",
        ):
            assert getattr(p, attr) is None, attr


def test_undrafted_sentinel_is_stored_as_null(loaded, session_factory):
    """Players.csv writes an undrafted player's draft as -1/-1/-1."""
    with session_factory() as session:
        p = _player(session, 9000002)
        assert (p.draft_year, p.draft_round, p.draft_number) == (None, None, None)
        assert (p.first_season, p.last_season) == ("2016-17", "2025-26")


# --------------------------------------------------------------------- games


def test_load_stores_regular_cup_play_in_and_playoff_games(loaded, session_factory):
    with session_factory() as session:
        stored = set(session.scalars(select(Game.nba_game_id)).all())
    assert stored == {
        22400001,
        22400002,
        22400003,
        62400001,
        52400001,
        42400405,
        22500001,
        42500101,
    }


def test_game_fields(loaded, session_factory):
    with session_factory() as session:
        game = _game(session, 22400001)
        assert game.home_team_id == _team(session, TOR).id
        assert game.away_team_id == _team(session, BOS).id
        assert _naive(game.date) == datetime(2024, 10, 22, 19, 30)
        assert game.season == "2024-25"
        assert (game.home_score, game.away_score) == (120, 115)
        assert game.venue == "Scotiabank Arena"
        assert game.game_type == "regular"
        assert game.label is None
        assert game.sub_label is None
        assert game.series_game_number is None
        assert _game(session, 22400002).venue is None


def test_game_type_is_decided_by_the_game_id_prefix(loaded, session_factory):
    with session_factory() as session:
        assert _game(session, 22400001).game_type == "regular"
        # An NBA Cup group game is a regular-season game; its label is kept.
        cup_group = _game(session, 22400002)
        assert cup_group.game_type == "regular"
        assert (cup_group.label, cup_group.sub_label) == ("Emirates NBA Cup", "East Group B")
        cup_final = _game(session, 62400001)
        assert cup_final.game_type == "cup-final"
        assert (cup_final.label, cup_final.sub_label) == ("Emirates NBA Cup", "Championship")
        assert _game(session, 52400001).game_type == "play-in"
        assert _game(session, 42400405).game_type == "playoffs"


def test_playoff_labels_and_series_game_number(loaded, session_factory):
    with session_factory() as session:
        finals_5 = _game(session, 42400405)
        assert (finals_5.label, finals_5.sub_label) == ("NBA Finals", "Game 5")
        assert finals_5.series_game_number == 5  # written "5.0"
        assert finals_5.venue == "TD Garden"
        finals_1 = _game(session, 42500101)
        assert finals_1.series_game_number == 1  # written "Game 1"
        assert finals_1.season == "2025-26"
        assert _game(session, 52400001).label == "SoFi Play-In Tournament"


def test_line_score_is_quarters_then_overtimes(loaded, session_factory):
    with session_factory() as session:
        regulation = _game(session, 22400001)
        assert regulation.home_line_score == [30, 30, 30, 30]
        assert regulation.away_line_score == [28, 29, 29, 29]

        one_ot = _game(session, 42400405)
        assert one_ot.home_line_score == [25, 25, 25, 25, 10]
        assert one_ot.away_line_score == [24, 26, 25, 25, 8]

        # The source has ot1, ot2 and all overtimes together: the third
        # overtime and any later are one figure, otAll - ot1 - ot2.
        three_ot = _game(session, 22500001)
        assert three_ot.home_line_score == [25, 25, 25, 25, 10, 8, 6]
        assert three_ot.away_line_score == [26, 24, 25, 25, 10, 8, 5]


def test_preseason_and_all_star_games_are_skipped_and_counted(loaded, session_factory):
    season = loaded.seasons["2024-25"]
    assert season.skipped_preseason == 1
    assert season.skipped_all_star == 1
    with session_factory() as session:
        assert _game(session, 12400001) is None
        assert _game(session, 32400001) is None


def test_a_game_scored_zero_to_zero_is_skipped_as_having_no_score(loaded, session_factory):
    assert loaded.seasons["2024-25"].skipped_no_score == (22400004,)
    assert loaded.seasons["2025-26"].skipped_no_score == ()
    with session_factory() as session:
        assert _game(session, 22400004) is None


def test_a_game_with_a_blank_score_is_skipped_as_having_no_score(session_factory, tmp_path):
    data_dir = _copy_fixture(tmp_path)
    _edit_rows(data_dir / "Games.csv", {"gameId": "22400003"}, homeScore="", awayScore="")

    with session_factory() as session:
        report = nba_history.load_nba_history(session, data_dir)

    assert report.seasons["2024-25"].skipped_no_score == (22400003, 22400004)
    with session_factory() as session:
        assert _game(session, 22400003) is None


def test_a_game_without_a_box_score_is_stored_empty_and_reported(loaded, session_factory):
    assert loaded.seasons["2024-25"].missing_box_scores == (22400003,)
    assert loaded.seasons["2025-26"].missing_box_scores == ()
    with session_factory() as session:
        game = _game(session, 22400003)
        assert game is not None
        assert (game.home_score, game.away_score) == (101, 99)
        assert _box_count(session, 22400003) == 0


# --------------------------------------------------------------------- box score


def test_box_score_holds_one_row_per_player_per_game(loaded, session_factory):
    with session_factory() as session:
        assert _box_count(session, 22400001) == 11  # 6 TOR (one DNP) + 5 BOS
        assert _box_count(session, 22400002) == 10
        assert _box_count(session, 22500001) == 10
        assert _count(session, PlayerGameStats) == 71


def test_box_score_row_carries_every_stat(loaded, session_factory):
    with session_factory() as session:
        row = _box_row(session, 22400001, 9000001)
        assert row.team_id == _team(session, TOR).id
        assert row.game_id == _game(session, 22400001).id
        assert row.starter is True
        assert row.starting_position == "G"
        assert (row.field_goals_made, row.field_goals_attempted) == (15, 20)
        assert (row.three_pointers_made, row.three_pointers_attempted) == (3, 5)
        assert (row.free_throws_made, row.free_throws_attempted) == (3, 4)
        assert (row.offensive_rebounds, row.defensive_rebounds, row.rebounds) == (1, 4, 5)
        assert (row.assists, row.steals, row.blocks, row.turnovers) == (3, 1, 0, 2)
        assert row.personal_fouls == 2
        assert row.points == 36
        assert row.plus_minus == 5
        assert row.dnp_reason is None
        assert row.played is True
        for attr in ("points", "rebounds", "plus_minus", "seconds_played"):
            assert type(getattr(row, attr)) is int, attr


def test_percentages_are_not_stored():
    columns = set(PlayerGameStats.__table__.c.keys())
    assert not {c for c in columns if "percent" in c or c.endswith("_pct")}


def test_stats_written_as_ints_load_the_same_as_floats(loaded, session_factory):
    """2024-25 rows write "36.0", 2025-26 rows "39"."""
    with session_factory() as session:
        row = _box_row(session, 22500001, 9000001)
        assert row.points == 39
        assert row.plus_minus == 1


def test_bench_player_has_no_starting_position(loaded, session_factory):
    with session_factory() as session:
        bench = _box_row(session, 22400001, 9000005)
        assert bench.starter is False
        assert bench.starting_position is None
        assert bench.played is True


def test_dnp_row_is_stored_with_its_reason_and_no_minutes(loaded, session_factory):
    with session_factory() as session:
        dnp = _box_row(session, 22400001, 9000006)
        assert dnp.seconds_played is None
        assert dnp.dnp_reason == "DNP - Coach's Decision"
        assert dnp.played is False
        assert dnp.starter is False
        assert dnp.points == 0


def test_played_counts_only_rows_with_minutes(loaded, session_factory):
    with session_factory() as session:
        game_id = _game(session, 22400001).id
        played = session.scalar(
            select(func.count())
            .select_from(PlayerGameStats)
            .where(PlayerGameStats.game_id == game_id, PlayerGameStats.played)
        )
        assert played == 10


def test_blank_player_team_comes_from_the_home_flag(loaded, session_factory):
    with session_factory() as session:
        # Away (home = 0) in 22400001: BOS.
        assert _box_row(session, 22400001, 9000105).team_id == _team(session, BOS).id
        # Home (home = 1) in 22400002: BOS; away: NYK.
        assert _box_row(session, 22400002, 9000102).team_id == _team(session, BOS).id
        assert _box_row(session, 22400002, 9000204).team_id == _team(session, NYK).id


def test_a_player_team_that_contradicts_the_home_flag_is_a_dataset_error(session_factory, tmp_path):
    data_dir = _copy_fixture(tmp_path)
    _edit_rows(
        data_dir / "PlayerStatistics.csv",
        {"gameId": "22400002", "personId": "9000101"},
        playerteamId=str(NYK),
    )

    with session_factory() as session, pytest.raises(nba_history.DatasetError) as excinfo:
        nba_history.load_nba_history(session, data_dir)

    assert "22400002" in str(excinfo.value)
    _assert_empty(session_factory)


# --------------------------------------------------------------------- minutes


def test_minutes_seconds_values_are_read_as_minutes_and_seconds(loaded, session_factory):
    """TOR in 22400001: "47.5" is 47:50 and "48.4" is 48:40; read that way
    the team's rows add up to its 240 minutes, read as decimals they don't."""
    with session_factory() as session:
        assert _box_row(session, 22400001, 9000001).seconds_played == 47 * 60 + 50
        assert _box_row(session, 22400001, 9000005).seconds_played == 48 * 60 + 40


def test_decimal_minutes_are_read_as_decimals(loaded, session_factory):
    with session_factory() as session:
        assert _box_row(session, 22400002, 9000101).seconds_played == 39 * 60 + 10
        assert _box_row(session, 22400002, 9000104).seconds_played == 52 * 60 + 50


def test_whole_minutes_are_whole_minutes(loaded, session_factory):
    with session_factory() as session:
        assert _box_row(session, 22400001, 9000101).seconds_played == 48 * 60
        assert _box_row(session, 22500001, 9000001).seconds_played == 63 * 60


def test_minutes_that_fit_neither_reading_are_decimal_and_reported(loaded, session_factory):
    assert loaded.seasons["2025-26"].unclear_minutes == ((22500001, LAL),)
    assert loaded.seasons["2024-25"].unclear_minutes == ()
    with session_factory() as session:
        assert _box_row(session, 22500001, 9000401).seconds_played == 60 * 60 + 30


# --------------------------------------------------------------------- reports


def test_points_that_do_not_add_up_are_reported_not_corrected(loaded, session_factory):
    assert loaded.seasons["2024-25"].points_mismatches == (
        nba_history.PointsMismatch(
            nba_game_id=22400002, nba_team_id=NYK, team_score=104, players_points=102
        ),
    )
    assert loaded.seasons["2025-26"].points_mismatches == ()
    with session_factory() as session:
        assert _game(session, 22400002).away_score == 104


def test_full_season_report(loaded):
    assert set(loaded.seasons) == {"2024-25", "2025-26"}
    assert loaded.seasons["2024-25"] == nba_history.SeasonReport(
        season="2024-25",
        games_loaded=6,
        games_updated=0,
        games_already_present=0,
        skipped_preseason=1,
        skipped_all_star=1,
        skipped_no_score=(22400004,),
        box_score_rows_loaded=51,
        box_score_rows_already_present=0,
        box_score_rows_skipped=20,
        duplicate_game_rows=1,
        duplicate_box_score_rows=1,
        missing_box_scores=(22400003,),
        points_mismatches=(
            nba_history.PointsMismatch(
                nba_game_id=22400002, nba_team_id=NYK, team_score=104, players_points=102
            ),
        ),
        unclear_minutes=(),
    )
    assert loaded.seasons["2025-26"] == nba_history.SeasonReport(
        season="2025-26",
        games_loaded=2,
        games_updated=0,
        games_already_present=0,
        skipped_preseason=0,
        skipped_all_star=0,
        skipped_no_score=(),
        box_score_rows_loaded=20,
        box_score_rows_already_present=0,
        box_score_rows_skipped=0,
        duplicate_game_rows=0,
        duplicate_box_score_rows=0,
        missing_box_scores=(),
        points_mismatches=(),
        unclear_minutes=((22500001, LAL),),
    )


def test_report_lines_name_each_season_with_its_counts(loaded):
    lines = loaded.lines()
    for season in ("2024-25", "2025-26"):
        matching = [line for line in lines if line.startswith(season)]
        assert len(matching) == 1, f"expected one line for {season}: {lines}"
        line = matching[0].lower()
        for word in ("loaded", "updated", "already present", "skipped", "box score"):
            assert word in line, (word, line)
    text = "\n".join(lines)
    for named in ("22400003", "22400004", "22400002", "22500001"):
        assert named in text, named


# --------------------------------------------------------------------- duplicates


def test_duplicate_game_rows_load_once_and_are_counted(loaded, session_factory):
    assert loaded.seasons["2024-25"].duplicate_game_rows == 1
    with session_factory() as session:
        assert session.scalar(select(func.count()).where(Game.nba_game_id == 22400001)) == 1


def test_duplicate_box_score_row_keeps_the_first_and_is_counted(loaded, session_factory):
    assert loaded.seasons["2024-25"].duplicate_box_score_rows == 1
    with session_factory() as session:
        assert _box_row(session, 22400001, 9000101).points == 36  # not the repeat's 99


def test_conflicting_duplicate_game_rows_are_a_dataset_error(session_factory, tmp_path):
    data_dir = _copy_fixture(tmp_path)
    _append_copy(data_dir / "Games.csv", {"gameId": "22400002"}, homeScore="112")

    with session_factory() as session, pytest.raises(nba_history.DatasetError):
        nba_history.load_nba_history(session, data_dir)

    _assert_empty(session_factory)


# --------------------------------------------------------------------- unknown ids


def test_unknown_team_in_games_csv_stops_the_load_naming_it(session_factory, tmp_path):
    data_dir = _copy_fixture(tmp_path)
    _edit_rows(data_dir / "Games.csv", {"gameId": "22400003"}, hometeamId=str(UNKNOWN_TEAM))

    with session_factory() as session, pytest.raises(UnrecognizedTeamError) as excinfo:
        nba_history.load_nba_history(session, data_dir)

    assert str(UNKNOWN_TEAM) in str(excinfo.value)
    _assert_empty(session_factory)


def test_unknown_team_in_a_box_score_stops_the_load_naming_it(session_factory, tmp_path):
    data_dir = _copy_fixture(tmp_path)
    _edit_rows(
        data_dir / "PlayerStatistics.csv",
        {"gameId": "22400002", "personId": "9000101"},
        playerteamId=str(UNKNOWN_TEAM),
    )

    with session_factory() as session, pytest.raises(UnrecognizedTeamError) as excinfo:
        nba_history.load_nba_history(session, data_dir)

    assert str(UNKNOWN_TEAM) in str(excinfo.value)
    _assert_empty(session_factory)


def test_unknown_player_in_a_box_score_stops_the_load_naming_it(session_factory, tmp_path):
    data_dir = _copy_fixture(tmp_path)
    _append_copy(
        data_dir / "PlayerStatistics.csv",
        {"gameId": "42500101", "personId": "9000501"},
        personId="9999999",
        firstName="Not",
        lastName="InPlayersCsv",
    )

    with session_factory() as session, pytest.raises(UnrecognizedPlayerError) as excinfo:
        nba_history.load_nba_history(session, data_dir)

    assert "9999999" in str(excinfo.value)
    _assert_empty(session_factory)


def test_unknown_ids_in_skipped_games_do_not_stop_the_load(loaded):
    """The All-Star game names two teams no loader knows."""
    assert loaded.seasons["2024-25"].skipped_all_star == 1


def test_failed_run_leaves_the_database_exactly_as_before(session_factory, tmp_path):
    """One transaction per run: a failure rolls back every row the run
    wrote, including teams and players it created before the bad row."""
    with session_factory() as session:
        nba_history.load_nba_history(session, FIXTURE_DIR, seasons=["2024-25"])
    with session_factory() as session:
        before = _snapshot(session)

    data_dir = _copy_fixture(tmp_path)
    _append_copy(
        data_dir / "PlayerStatistics.csv",
        {"gameId": "42500101", "personId": "9000501"},
        personId="9999999",
    )
    with session_factory() as session, pytest.raises(UnrecognizedPlayerError):
        nba_history.load_nba_history(session, data_dir)

    with session_factory() as session:
        assert _snapshot(session) == before
        assert _game(session, 22500001) is None


# --------------------------------------------------------------------- existing games


def _events_001_game(session, nba_game_id: int, scores: tuple[int, int]) -> int:
    """TOR v BOS as EVENTS-001 stored it: a date without a time, no venue,
    no label, no line score, no box score."""
    tor = Team(
        nba_team_id=TOR,
        name="Toronto Raptors",
        abbreviation="TOR",
        conference="Eastern",
        division="Atlantic",
    )
    bos = Team(
        nba_team_id=BOS,
        name="Boston Celtics",
        abbreviation="BOS",
        conference="Eastern",
        division="Atlantic",
    )
    session.add_all([tor, bos])
    session.flush()
    game = Game(
        nba_game_id=nba_game_id,
        home_team_id=tor.id,
        away_team_id=bos.id,
        date=datetime(2024, 10, 22),
        season="2024-25",
        home_score=scores[0],
        away_score=scores[1],
        venue=None,
        game_type="regular",
    )
    session.add(game)
    session.commit()
    return game.id


def test_an_existing_game_keeps_its_id_and_gets_its_new_fields_and_box_score(session_factory):
    with session_factory() as session:
        game_id = _events_001_game(session, 22400001, (120, 115))

    with session_factory() as session:
        report = nba_history.load_nba_history(session, FIXTURE_DIR, seasons=["2024-25"])

    season = report.seasons["2024-25"]
    assert season.games_updated == 1
    assert season.games_loaded == 5
    assert season.games_already_present == 0
    assert season.box_score_rows_loaded == 51
    with session_factory() as session:
        game = _game(session, 22400001)
        assert game.id == game_id
        assert game.venue == "Scotiabank Arena"
        assert _naive(game.date) == datetime(2024, 10, 22, 19, 30)
        assert game.home_line_score == [30, 30, 30, 30]
        assert _box_count(session, 22400001) == 11


def test_an_existing_game_whose_score_disagrees_is_a_dataset_error(session_factory):
    with session_factory() as session:
        _events_001_game(session, 22400001, (121, 115))
    with session_factory() as session:
        before = _snapshot(session)

    with session_factory() as session, pytest.raises(nba_history.DatasetError) as excinfo:
        nba_history.load_nba_history(session, FIXTURE_DIR)

    assert "22400001" in str(excinfo.value)
    with session_factory() as session:
        assert _snapshot(session) == before


# --------------------------------------------------------------------- re-runs


def test_second_run_over_the_same_data_changes_and_reports_nothing_new(session_factory):
    with session_factory() as session:
        first = nba_history.load_nba_history(session, FIXTURE_DIR)
    with session_factory() as session:
        before = _snapshot(session)

    with session_factory() as session:
        second = nba_history.load_nba_history(session, FIXTURE_DIR)

    assert second.teams_created == 0
    assert second.players_created == 0
    assert set(second.seasons) == set(first.seasons)
    for name, first_season in first.seasons.items():
        season = second.seasons[name]
        assert season.games_loaded == 0
        assert season.games_updated == 0
        assert season.games_already_present == first_season.games_loaded
        assert season.box_score_rows_loaded == 0
        assert season.box_score_rows_already_present == first_season.box_score_rows_loaded
        assert season.missing_box_scores == ()
        assert season.points_mismatches == ()
        assert season.unclear_minutes == ()

    with session_factory() as session:
        assert _snapshot(session) == before


# --------------------------------------------------------------------- season filter


def test_limiting_to_one_season_loads_only_that_season(session_factory):
    with session_factory() as session:
        report = nba_history.load_nba_history(session, FIXTURE_DIR, seasons=["2025-26"])

    assert set(report.seasons) == {"2025-26"}
    assert report.seasons["2025-26"].games_loaded == 2
    with session_factory() as session:
        assert set(session.scalars(select(Game.nba_game_id)).all()) == {22500001, 42500101}
        # Only the players of the loaded box scores: five each of TOR, LAL, SAS, NYK.
        assert _count(session, Player) == 20
        assert _player(session, 9000006) is None


def test_loading_a_second_season_later_adds_only_that_season(session_factory):
    with session_factory() as session:
        nba_history.load_nba_history(session, FIXTURE_DIR, seasons=["2024-25"])

    with session_factory() as session:
        report = nba_history.load_nba_history(session, FIXTURE_DIR)

    assert report.teams_created == 0
    assert report.seasons["2024-25"].games_loaded == 0
    assert report.seasons["2024-25"].games_already_present == 6
    assert report.seasons["2025-26"].games_loaded == 2
    with session_factory() as session:
        assert _count(session, Game) == 8


@pytest.mark.parametrize("bad_season", ["2019", "2019-2020", "19-20", "abcd-ef", "", "2024-26"])
def test_malformed_season_argument_is_a_dataset_error(session_factory, bad_season):
    with session_factory() as session, pytest.raises(nba_history.DatasetError):
        nba_history.load_nba_history(session, FIXTURE_DIR, seasons=[bad_season])

    _assert_empty(session_factory)


@pytest.mark.parametrize(
    "missing", ["Games.csv", "PlayerStatistics.csv", "TeamStatistics.csv", "Players.csv"]
)
def test_a_missing_file_is_a_dataset_error(session_factory, tmp_path, missing):
    data_dir = _copy_fixture(tmp_path)
    (data_dir / missing).unlink()

    with session_factory() as session, pytest.raises(nba_history.DatasetError) as excinfo:
        nba_history.load_nba_history(session, data_dir)

    assert missing in str(excinfo.value)
    _assert_empty(session_factory)


def test_a_missing_column_is_a_dataset_error(session_factory, tmp_path):
    data_dir = _copy_fixture(tmp_path)
    path = data_dir / "PlayerStatistics.csv"
    header, rows = _read_rows(path)
    header.remove("numMinutes")
    for row in rows:
        del row["numMinutes"]
    _write_rows(path, header, rows)

    with session_factory() as session, pytest.raises(nba_history.DatasetError) as excinfo:
        nba_history.load_nba_history(session, data_dir)

    assert "numMinutes" in str(excinfo.value)
    _assert_empty(session_factory)


# --------------------------------------------------------------------- CLI


def _run_cli(url: str, *args: str) -> subprocess.CompletedProcess[str]:
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env["DATABASE_URL"] = url
    return subprocess.run(
        [sys.executable, str(_BACKEND_DIR / "scripts" / "load_nba_history.py"), *args],
        check=False,
        cwd=_BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
    )


@pytest.fixture()
def migrated_url(postgres_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", postgres_url)
    config = Config(str(_BACKEND_DIR / "alembic.ini"))
    command.upgrade(config, "head")
    yield postgres_url
    command.downgrade(config, "base")


def test_cli_loads_the_named_seasons_and_prints_the_report(migrated_url):
    result = _run_cli(migrated_url, "--data-dir", str(FIXTURE_DIR), "--season", "2025-26")

    assert result.returncode == 0, result.stderr
    assert "2025-26" in result.stdout
    assert "2024-25" not in result.stdout
    assert "22500001" in result.stdout  # its unclear minutes are named


def test_cli_reports_a_dataset_error_and_exits_1(migrated_url, tmp_path):
    result = _run_cli(migrated_url, "--data-dir", str(tmp_path))

    assert result.returncode == 1
    assert "nothing written" in result.stderr
