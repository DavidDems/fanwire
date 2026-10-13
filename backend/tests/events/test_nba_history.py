"""Tests for app.events.nba_history.load_nba_history (EVENTS-001), per
AGENTS.md TDD workflow. Written before app/events/nba_history.py exists.

The loader reads the Kaggle "NBA games" dataset's teams.csv, games.csv and
games_details.csv. These tests run against a small synthetic fixture with the
dataset's exact column names (tests/fixtures/nba_history/), never the dataset
itself. What the fixture holds, by season:

2019-20 (SEASON 2019):
- 21900001 regular season, TOR 130 - BOS 122. Duplicated in games.csv (the
  two rows differ only in percentage columns). Its box score has three
  starters and a bench player for TOR plus a DNP, two starters and a bench
  player for BOS, and one duplicated (GAME_ID, PLAYER_ID) row (Jayson Tatum:
  first row 21 points, duplicate 23).
- 21900002 regular season with a blank PTS_home: skipped, no score.
- 41900001 playoffs, TOR 134 - BOS 110.
- 31900001 All-Star: skipped.
- 11900001 preseason (blank scores): skipped.

2020-21 (SEASON 2020):
- 22000001 regular season, BOS 122 - GSW 121 (points written as integers).
- 52000001 play-in, LAL 103 - GSW 100.

Failure cases build modified copies of the fixture in tmp_path.
"""

from __future__ import annotations

import csv
import shutil
from datetime import datetime
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.db import Base, make_engine, make_session_factory
from app.events import nba_history
from app.events.ingestion import UnrecognizedTeamError
from app.events.models import Game, Team

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "nba_history"

TOR = 1610612761
BOS = 1610612738
LAL = 1610612747
GSW = 1610612744
NYK = 1610612752  # a real nba.com team id that is NOT in the fixture's teams.csv
MIA = 1610612748


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


# --------------------------------------------------------------------- helpers


def _copy_fixture(tmp_path: Path) -> Path:
    data_dir = tmp_path / "nba"
    shutil.copytree(FIXTURE_DIR, data_dir)
    return data_dir


def _read_rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return list(reader.fieldnames or []), list(reader)


def _append_row(path: Path, **values: str) -> None:
    """Append one row to a fixture CSV, every column not named left blank."""
    header, rows = _read_rows(path)
    unknown = set(values) - set(header)
    assert not unknown, f"not columns of {path.name}: {unknown}"
    rows.append({column: values.get(column, "") for column in header})
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=header, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def _game_row(
    game_id: str, date: str, season: str, home: int, away: int, pts_home: str, pts_away: str
) -> dict[str, str]:
    return {
        "GAME_DATE_EST": date,
        "GAME_ID": game_id,
        "GAME_STATUS_TEXT": "Final",
        "HOME_TEAM_ID": str(home),
        "VISITOR_TEAM_ID": str(away),
        "SEASON": season,
        "TEAM_ID_home": str(home),
        "PTS_home": pts_home,
        "TEAM_ID_away": str(away),
        "PTS_away": pts_away,
        "HOME_TEAM_WINS": "1",
    }


def _count(session, model) -> int:
    return session.scalar(select(func.count()).select_from(model))


def _team_by_nba_id(session, nba_team_id: int) -> Team:
    team = session.scalar(select(Team).where(Team.nba_team_id == nba_team_id))
    assert team is not None, f"no Team with nba_team_id={nba_team_id}"
    return team


def _game_by_nba_id(session, nba_game_id: int) -> Game | None:
    return session.scalar(select(Game).where(Game.nba_game_id == nba_game_id))


def _naive(value: datetime) -> datetime:
    return value.replace(tzinfo=None)


def _stat(name: str, team_id: int, points: int, rebounds: int, assists: int, position):
    return {
        "player_name": name,
        "team_id": team_id,
        "points": points,
        "rebounds": rebounds,
        "assists": assists,
        "position": position,
    }


def _snapshot(session) -> tuple[list[tuple], list[tuple]]:
    teams = session.execute(
        select(Team.nba_team_id, Team.name, Team.abbreviation).order_by(Team.nba_team_id)
    ).all()
    games = session.execute(
        select(Game.nba_game_id, Game.home_score, Game.away_score, Game.player_stats).order_by(
            Game.nba_game_id
        )
    ).all()
    return [tuple(t) for t in teams], [tuple(g) for g in games]


# --------------------------------------------------------------------- teams


def test_load_creates_every_team_from_teams_csv(session_factory):
    with session_factory() as session:
        report = nba_history.load_nba_history(session, FIXTURE_DIR)

    assert isinstance(report, nba_history.LoadReport)
    assert report.teams_created == 4

    with session_factory() as session:
        assert _count(session, Team) == 4

        tor = _team_by_nba_id(session, TOR)
        assert tor.name == "Toronto Raptors"
        assert tor.abbreviation == "TOR"
        assert tor.conference == "Eastern"
        assert tor.division == "Atlantic"
        assert tor.logo_url is None
        assert tor.api_sports_team_id is None

        bos = _team_by_nba_id(session, BOS)
        assert (bos.name, bos.conference, bos.division) == ("Boston Celtics", "Eastern", "Atlantic")

        lal = _team_by_nba_id(session, LAL)
        assert (lal.name, lal.conference, lal.division) == (
            "Los Angeles Lakers",
            "Western",
            "Pacific",
        )

        gsw = _team_by_nba_id(session, GSW)
        assert (gsw.name, gsw.abbreviation, gsw.conference, gsw.division) == (
            "Golden State Warriors",
            "GSW",
            "Western",
            "Pacific",
        )


def test_team_without_a_conference_mapping_is_a_dataset_error(session_factory, tmp_path):
    data_dir = _copy_fixture(tmp_path)
    _append_row(
        data_dir / "teams.csv",
        LEAGUE_ID="00",
        TEAM_ID="1610612999",
        ABBREVIATION="XXX",
        NICKNAME="Nobodies",
        CITY="Nowhere",
    )

    with session_factory() as session, pytest.raises(nba_history.DatasetError):
        nba_history.load_nba_history(session, data_dir)

    with session_factory() as session:
        assert _count(session, Team) == 0
        assert _count(session, Game) == 0


# --------------------------------------------------------------------- games


def test_load_stores_regular_playoff_and_play_in_games(session_factory):
    with session_factory() as session:
        nba_history.load_nba_history(session, FIXTURE_DIR)

    with session_factory() as session:
        stored = set(session.scalars(select(Game.nba_game_id)).all())
        assert stored == {21900001, 41900001, 22000001, 52000001}
        assert _count(session, Game) == 4


def test_regular_season_game_fields(session_factory):
    with session_factory() as session:
        nba_history.load_nba_history(session, FIXTURE_DIR)

    with session_factory() as session:
        game = _game_by_nba_id(session, 21900001)
        assert game is not None
        tor = _team_by_nba_id(session, TOR)
        bos = _team_by_nba_id(session, BOS)

        assert game.api_sports_game_id is None
        assert game.home_team_id == tor.id
        assert game.away_team_id == bos.id
        assert _naive(game.date) == datetime(2019, 10, 22, 0, 0)
        assert game.season == "2019-20"
        assert game.home_score == 130
        assert game.away_score == 122
        assert game.venue is None
        assert game.game_type == "regular"


def test_game_type_is_set_from_the_game_id_prefix(session_factory):
    with session_factory() as session:
        nba_history.load_nba_history(session, FIXTURE_DIR)

    with session_factory() as session:
        assert _game_by_nba_id(session, 21900001).game_type == "regular"
        assert _game_by_nba_id(session, 22000001).game_type == "regular"
        assert _game_by_nba_id(session, 41900001).game_type == "playoffs"
        assert _game_by_nba_id(session, 52000001).game_type == "play-in"


def test_scores_written_as_integers_or_floats_both_load_as_ints(session_factory):
    with session_factory() as session:
        nba_history.load_nba_history(session, FIXTURE_DIR)

    with session_factory() as session:
        integer_form = _game_by_nba_id(session, 22000001)  # "122" / "121"
        float_form = _game_by_nba_id(session, 52000001)  # "103.0" / "100.0"
        assert (integer_form.home_score, integer_form.away_score) == (122, 121)
        assert (float_form.home_score, float_form.away_score) == (103, 100)
        for game in (integer_form, float_form):
            assert type(game.home_score) is int
            assert type(game.away_score) is int


def test_season_is_stored_as_start_year_dash_two_digit_end_year(session_factory):
    with session_factory() as session:
        nba_history.load_nba_history(session, FIXTURE_DIR)

    with session_factory() as session:
        assert _game_by_nba_id(session, 21900001).season == "2019-20"
        assert _game_by_nba_id(session, 41900001).season == "2019-20"
        assert _game_by_nba_id(session, 22000001).season == "2020-21"
        assert _game_by_nba_id(session, 52000001).season == "2020-21"


def test_season_rolls_over_the_century(session_factory, tmp_path):
    """SEASON 1999 -> "1999-00", not "1999-100"."""
    data_dir = _copy_fixture(tmp_path)
    _append_row(
        data_dir / "games.csv",
        **_game_row("29900001", "1999-11-02", "1999", TOR, BOS, "95.0", "90.0"),
    )

    with session_factory() as session:
        report = nba_history.load_nba_history(session, data_dir)

    assert "1999-00" in report.seasons
    with session_factory() as session:
        assert _game_by_nba_id(session, 29900001).season == "1999-00"


def test_preseason_and_all_star_games_are_skipped_and_counted(session_factory):
    with session_factory() as session:
        report = nba_history.load_nba_history(session, FIXTURE_DIR)

    season = report.seasons["2019-20"]
    assert season.skipped_preseason == 1
    assert season.skipped_all_star == 1
    assert report.seasons["2020-21"].skipped_preseason == 0
    assert report.seasons["2020-21"].skipped_all_star == 0

    with session_factory() as session:
        assert _game_by_nba_id(session, 11900001) is None
        assert _game_by_nba_id(session, 31900001) is None


def test_game_with_no_final_score_is_skipped_and_counted(session_factory):
    with session_factory() as session:
        report = nba_history.load_nba_history(session, FIXTURE_DIR)

    assert report.seasons["2019-20"].skipped_no_score == 1
    assert report.seasons["2020-21"].skipped_no_score == 0
    with session_factory() as session:
        assert _game_by_nba_id(session, 21900002) is None


def test_full_season_report(session_factory):
    with session_factory() as session:
        report = nba_history.load_nba_history(session, FIXTURE_DIR)

    assert set(report.seasons) == {"2019-20", "2020-21"}
    assert report.seasons["2019-20"] == nba_history.SeasonReport(
        season="2019-20",
        loaded=2,
        already_present=0,
        skipped_preseason=1,
        skipped_all_star=1,
        skipped_no_score=1,
        duplicate_game_rows=1,
        duplicate_player_rows=1,
    )
    assert report.seasons["2020-21"] == nba_history.SeasonReport(
        season="2020-21",
        loaded=2,
        already_present=0,
        skipped_preseason=0,
        skipped_all_star=0,
        skipped_no_score=0,
        duplicate_game_rows=0,
        duplicate_player_rows=0,
    )


def test_report_lines_name_each_season_with_its_counts(session_factory):
    with session_factory() as session:
        report = nba_history.load_nba_history(session, FIXTURE_DIR)

    lines = report.lines()
    assert len(lines) == 2
    for season in ("2019-20", "2020-21"):
        matching = [line for line in lines if season in line]
        assert len(matching) == 1, f"expected one line for {season}: {lines}"
        line = matching[0].lower()
        assert "loaded" in line
        assert "skipped" in line
        assert str(report.seasons[season].loaded) in line


# --------------------------------------------------------------------- box score


def test_player_stats_hold_every_player_who_played(session_factory):
    with session_factory() as session:
        nba_history.load_nba_history(session, FIXTURE_DIR)

    with session_factory() as session:
        tor = _team_by_nba_id(session, TOR).id
        bos = _team_by_nba_id(session, BOS).id
        game = _game_by_nba_id(session, 21900001)

        stats = sorted(game.player_stats, key=lambda s: s["player_name"])
        assert stats == [
            _stat("Enes Kanter", bos, 8, 9, 1, None),
            _stat("Fred VanVleet", tor, 34, 7, 7, None),
            _stat("Jayson Tatum", bos, 21, 6, 3, "F"),
            _stat("Kemba Walker", bos, 12, 4, 2, "G"),
            _stat("Kyle Lowry", tor, 22, 5, 8, "G"),
            _stat("Marc Gasol", tor, 3, 6, 4, "C"),
            _stat("Pascal Siakam", tor, 34, 18, 3, "F"),
        ]
        for entry in stats:
            for key in ("points", "rebounds", "assists", "team_id"):
                assert type(entry[key]) is int, (entry, key)


def test_dnp_player_is_excluded_from_player_stats(session_factory):
    with session_factory() as session:
        nba_history.load_nba_history(session, FIXTURE_DIR)

    with session_factory() as session:
        game = _game_by_nba_id(session, 21900001)
        names = [s["player_name"] for s in game.player_stats]
        assert "Patrick McCaw" not in names


def test_bench_player_position_is_none_never_invented(session_factory):
    with session_factory() as session:
        nba_history.load_nba_history(session, FIXTURE_DIR)

    with session_factory() as session:
        game = _game_by_nba_id(session, 21900001)
        by_name = {s["player_name"]: s for s in game.player_stats}
        assert by_name["Fred VanVleet"]["position"] is None
        assert by_name["Enes Kanter"]["position"] is None


def test_player_stats_of_other_loaded_games(session_factory):
    with session_factory() as session:
        nba_history.load_nba_history(session, FIXTURE_DIR)

    with session_factory() as session:
        lal = _team_by_nba_id(session, LAL).id
        gsw = _team_by_nba_id(session, GSW).id
        play_in = _game_by_nba_id(session, 52000001)
        assert sorted(play_in.player_stats, key=lambda s: s["player_name"]) == [
            _stat("LeBron James", lal, 22, 11, 10, "F"),
            _stat("Stephen Curry", gsw, 37, 5, 6, "G"),
        ]

        bos = _team_by_nba_id(session, BOS).id
        integer_form = _game_by_nba_id(session, 22000001)
        assert sorted(integer_form.player_stats, key=lambda s: s["player_name"]) == [
            _stat("Jayson Tatum", bos, 30, 5, 2, "F"),
            _stat("Stephen Curry", gsw, 23, 5, 4, "G"),
        ]


# --------------------------------------------------------------------- duplicates


def test_duplicate_game_rows_load_once_and_are_counted(session_factory):
    with session_factory() as session:
        report = nba_history.load_nba_history(session, FIXTURE_DIR)

    assert report.seasons["2019-20"].duplicate_game_rows == 1
    with session_factory() as session:
        assert session.scalar(select(func.count()).where(Game.nba_game_id == 21900001)) == 1


def test_duplicate_player_row_keeps_the_first_and_is_counted(session_factory):
    with session_factory() as session:
        report = nba_history.load_nba_history(session, FIXTURE_DIR)

    assert report.seasons["2019-20"].duplicate_player_rows == 1
    with session_factory() as session:
        game = _game_by_nba_id(session, 21900001)
        tatum = [s for s in game.player_stats if s["player_name"] == "Jayson Tatum"]
        assert len(tatum) == 1
        assert tatum[0]["points"] == 21  # the first row's value, not the duplicate's 23


def test_conflicting_duplicate_game_rows_are_a_dataset_error(session_factory, tmp_path):
    data_dir = _copy_fixture(tmp_path)
    # Same GAME_ID as the fixture's 21900001 (TOR 130 - BOS 122), but a different score.
    _append_row(
        data_dir / "games.csv",
        **_game_row("21900001", "2019-10-22", "2019", TOR, BOS, "131.0", "122.0"),
    )

    with session_factory() as session, pytest.raises(nba_history.DatasetError):
        nba_history.load_nba_history(session, data_dir)

    with session_factory() as session:
        assert _count(session, Team) == 0
        assert _count(session, Game) == 0


# --------------------------------------------------------------------- unknown teams


def test_unknown_team_in_games_csv_stops_the_load_naming_it(session_factory, tmp_path):
    data_dir = _copy_fixture(tmp_path)
    _append_row(
        data_dir / "games.csv",
        **_game_row("21900099", "2019-11-01", "2019", NYK, BOS, "100.0", "99.0"),
    )

    with session_factory() as session, pytest.raises(UnrecognizedTeamError) as excinfo:
        nba_history.load_nba_history(session, data_dir)

    assert str(NYK) in str(excinfo.value)
    with session_factory() as session:
        assert _count(session, Team) == 0
        assert _count(session, Game) == 0


def test_unknown_team_in_games_details_csv_stops_the_load_naming_it(session_factory, tmp_path):
    data_dir = _copy_fixture(tmp_path)
    _append_row(
        data_dir / "games_details.csv",
        GAME_ID="21900001",
        TEAM_ID=str(NYK),
        TEAM_ABBREVIATION="NYK",
        TEAM_CITY="New York",
        PLAYER_ID="203944",
        PLAYER_NAME="Julius Randle",
        NICKNAME="Julius",
        START_POSITION="F",
        MIN="30:00",
        REB="10.0",
        AST="3.0",
        PTS="20.0",
    )

    with session_factory() as session, pytest.raises(UnrecognizedTeamError) as excinfo:
        nba_history.load_nba_history(session, data_dir)

    assert str(NYK) in str(excinfo.value)
    with session_factory() as session:
        assert _count(session, Team) == 0
        assert _count(session, Game) == 0


def test_failed_run_leaves_the_database_exactly_as_before(session_factory, tmp_path):
    """One transaction per run: a failure rolls back every Team and Game the
    run wrote, including teams it created before reaching the bad row."""
    with session_factory() as session:
        nba_history.load_nba_history(session, FIXTURE_DIR, seasons=["2019-20"])

    with session_factory() as session:
        before = _snapshot(session)
        teams_before = _count(session, Team)
        games_before = _count(session, Game)
    assert teams_before == 4
    assert games_before == 2

    data_dir = _copy_fixture(tmp_path)
    # A new, valid team the run would create...
    _append_row(
        data_dir / "teams.csv",
        LEAGUE_ID="00",
        TEAM_ID=str(MIA),
        ABBREVIATION="MIA",
        NICKNAME="Heat",
        CITY="Miami",
    )
    # ...a new, valid game in the other season it would load...
    _append_row(
        data_dir / "games.csv",
        **_game_row("22000050", "2021-01-05", "2020", MIA, BOS, "107.0", "105.0"),
    )
    # ...and then a game naming a team that does not exist.
    _append_row(
        data_dir / "games.csv",
        **_game_row("22000099", "2021-01-06", "2020", NYK, BOS, "100.0", "99.0"),
    )

    with session_factory() as session, pytest.raises(UnrecognizedTeamError):
        nba_history.load_nba_history(session, data_dir)

    with session_factory() as session:
        assert _count(session, Team) == teams_before
        assert _count(session, Game) == games_before
        assert session.scalar(select(Team).where(Team.nba_team_id == MIA)) is None
        assert _game_by_nba_id(session, 22000050) is None
        assert _game_by_nba_id(session, 22000001) is None
        assert _snapshot(session) == before


# --------------------------------------------------------------------- re-runs


def test_second_run_over_the_same_data_adds_nothing(session_factory):
    with session_factory() as session:
        first = nba_history.load_nba_history(session, FIXTURE_DIR)

    with session_factory() as session:
        before = _snapshot(session)

    with session_factory() as session:
        second = nba_history.load_nba_history(session, FIXTURE_DIR)

    assert second.teams_created == 0
    assert set(second.seasons) == set(first.seasons)
    for season, first_report in first.seasons.items():
        assert second.seasons[season].loaded == 0
        assert second.seasons[season].already_present == first_report.loaded

    with session_factory() as session:
        assert _count(session, Team) == 4
        assert _count(session, Game) == 4
        assert _snapshot(session) == before


# --------------------------------------------------------------------- season filter


def test_limiting_to_one_season_loads_only_that_season(session_factory):
    with session_factory() as session:
        report = nba_history.load_nba_history(session, FIXTURE_DIR, seasons=["2020-21"])

    assert set(report.seasons) == {"2020-21"}
    assert report.seasons["2020-21"].loaded == 2

    with session_factory() as session:
        stored = set(session.scalars(select(Game.nba_game_id)).all())
        assert stored == {22000001, 52000001}
        assert set(session.scalars(select(Game.season)).all()) == {"2020-21"}


def test_loading_a_second_season_later_adds_only_that_season(session_factory):
    with session_factory() as session:
        nba_history.load_nba_history(session, FIXTURE_DIR, seasons=["2019-20"])

    with session_factory() as session:
        report = nba_history.load_nba_history(session, FIXTURE_DIR)

    assert report.teams_created == 0
    assert report.seasons["2019-20"].loaded == 0
    assert report.seasons["2019-20"].already_present == 2
    assert report.seasons["2020-21"].loaded == 2
    with session_factory() as session:
        assert _count(session, Game) == 4


@pytest.mark.parametrize("bad_season", ["2019", "2019-2020", "19-20", "abcd-ef", ""])
def test_malformed_season_argument_is_a_dataset_error(session_factory, bad_season):
    with session_factory() as session, pytest.raises(nba_history.DatasetError):
        nba_history.load_nba_history(session, FIXTURE_DIR, seasons=[bad_season])

    with session_factory() as session:
        assert _count(session, Team) == 0
        assert _count(session, Game) == 0
