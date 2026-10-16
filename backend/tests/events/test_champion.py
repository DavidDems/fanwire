"""Tests for GET /events/seasons/{season}/champion (EVENTS-007). Spec:
.ai/tasks/EVENTS-007/.

Pinned contract (extra fields are tolerated):

- The response is an object with `season`, `champion` and `runner_up`
  (each an object with at least `id`, `name`, `abbreviation`, or null) and
  `result` (the series score, the champion's wins first, e.g. "4-2", or
  null).
- The champion is the team that has won four of the season's `playoffs`
  games labelled exactly "NBA Finals" (the dataset's spelling, as in
  tests/fixtures/nba_data/Games.csv). Other playoff rounds, and Finals-
  labelled games of another type, do not count.
- Until a team has four Finals wins (a season in progress, or one with no
  Finals games at all) the same shape comes back with all three null: a
  200, never a 404. A season with no stored game is a 404
  (test_seasons.py).
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from app.db import Base, make_session_factory
from app.events import nba_history
from app.events.models import Team
from tests.events.players_support import add_line, add_player, make_client, make_players_engine
from tests.events.seasons_support import Calendar, add_conference_team, add_result, statements_for

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "nba_data"
FINALS = "NBA Finals"


@pytest.fixture()
def engine(postgres_url):
    engine = make_players_engine(postgres_url)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def session_factory(engine):
    return make_session_factory(engine)


@pytest.fixture()
def client(session_factory):
    return make_client(session_factory)


def _champion(client, season: str) -> dict:
    response = client.get(f"/events/seasons/{season}/champion")
    assert response.status_code == 200, response.text
    return response.json()


def _ref(team: dict | None) -> tuple | None:
    return None if team is None else (team["id"], team["name"], team["abbreviation"])


def _series(session, *, season, start, east, west, east_home_wins, finals_results, label=FINALS):
    """One game per entry of `finals_results` (True: `east` won), with
    `east` at home on the first two, as in the NBA's 2-2-1-1-1."""
    calendar = Calendar(start)
    for n, east_won in enumerate(finals_results):
        east_home = n in (0, 1, 4, 6) if east_home_wins else n in (2, 3, 5)
        add_result(
            session,
            home=east if east_home else west,
            away=west if east_home else east,
            home_won=east_won == east_home,
            season=season,
            when=calendar.next(),
            game_type="playoffs",
            label=label,
        )


@pytest.fixture()
def teams(session_factory):
    with session_factory() as session:
        made = {
            abbreviation: add_conference_team(session, abbreviation, name, conference, division)
            for abbreviation, name, conference, division in (
                ("BOS", "Boston Celtics", "Eastern", "Atlantic"),
                ("DAL", "Dallas Mavericks", "Western", "Southwest"),
                ("MIN", "Minnesota Timberwolves", "Western", "Northwest"),
            )
        }
        session.commit()
        return {abbreviation: team.id for abbreviation, team in made.items()}


def _team_objects(session, ids: dict[str, int]) -> dict[str, Team]:
    return {abbreviation: session.get(Team, team_id) for abbreviation, team_id in ids.items()}


def test_a_finals_won_4_2_names_champion_runner_up_and_result(client, session_factory, teams):
    """BOS beats DAL 4-2 in the Finals. In the West final DAL beat MIN four
    times; those wins, labelled otherwise, are no Finals wins."""
    with session_factory() as session:
        t = _team_objects(session, teams)
        _series(
            session,
            season="2023-24",
            start=date(2024, 5, 22),
            east=t["DAL"],
            west=t["MIN"],
            east_home_wins=True,
            finals_results=[True, True, True, True],
            label="West - Conference Finals",
        )
        _series(
            session,
            season="2023-24",
            start=date(2024, 6, 6),
            east=t["BOS"],
            west=t["DAL"],
            east_home_wins=True,
            finals_results=[True, False, True, False, True, True],
        )
        session.commit()

    body = _champion(client, "2023-24")

    assert body["season"] == "2023-24"
    assert _ref(body["champion"]) == (teams["BOS"], "Boston Celtics", "BOS")
    assert _ref(body["runner_up"]) == (teams["DAL"], "Dallas Mavericks", "DAL")
    assert body["result"] == "4-2"


def test_a_sweep_is_4_0_and_the_road_team_can_be_champion(client, session_factory, teams):
    with session_factory() as session:
        t = _team_objects(session, teams)
        _series(
            session,
            season="2022-23",
            start=date(2023, 6, 1),
            east=t["BOS"],
            west=t["DAL"],
            east_home_wins=True,
            finals_results=[False, False, False, False],
        )
        session.commit()

    body = _champion(client, "2022-23")

    assert _ref(body["champion"]) == (teams["DAL"], "Dallas Mavericks", "DAL")
    assert _ref(body["runner_up"]) == (teams["BOS"], "Boston Celtics", "BOS")
    assert body["result"] == "4-0"


def test_a_finals_in_progress_at_3_1_has_no_champion(client, session_factory, teams):
    with session_factory() as session:
        t = _team_objects(session, teams)
        _series(
            session,
            season="2025-26",
            start=date(2026, 6, 3),
            east=t["BOS"],
            west=t["DAL"],
            east_home_wins=True,
            finals_results=[True, True, False, True],
        )
        session.commit()

    body = _champion(client, "2025-26")

    assert body["season"] == "2025-26"
    assert (body["champion"], body["runner_up"], body["result"]) == (None, None, None)


def test_four_wins_outside_the_finals_make_no_champion(client, session_factory, teams):
    """Four conference-final wins, and four 'NBA Finals'-labelled games that
    are not typed playoffs, are not a title."""
    with session_factory() as session:
        t = _team_objects(session, teams)
        _series(
            session,
            season="2021-22",
            start=date(2022, 5, 20),
            east=t["DAL"],
            west=t["MIN"],
            east_home_wins=True,
            finals_results=[True, True, True, True],
            label="West - Conference Finals",
        )
        calendar = Calendar(date(2022, 6, 2))
        for _ in range(4):
            add_result(
                session,
                home=t["BOS"],
                away=t["DAL"],
                home_won=True,
                season="2021-22",
                when=calendar.next(),
                game_type="regular",
                label=FINALS,
            )
        session.commit()

    body = _champion(client, "2021-22")

    assert (body["champion"], body["runner_up"], body["result"]) == (None, None, None)


def test_a_season_of_regular_games_only_has_no_champion(client, session_factory, teams):
    with session_factory() as session:
        t = _team_objects(session, teams)
        add_result(
            session,
            home=t["BOS"],
            away=t["DAL"],
            home_won=True,
            season="2020-21",
            when=date(2021, 1, 5),
        )
        session.commit()

    body = _champion(client, "2020-21")

    assert body["season"] == "2020-21"
    assert (body["champion"], body["runner_up"], body["result"]) == (None, None, None)


def test_the_fixture_seasons_have_one_finals_game_and_no_champion(client, session_factory):
    """The fixture's Finals rows are labelled "NBA Finals": one per season."""
    with session_factory() as session:
        nba_history.load_nba_history(session, FIXTURE_DIR)

    for season in ("2024-25", "2025-26"):
        body = _champion(client, season)
        assert (body["champion"], body["runner_up"], body["result"]) == (None, None, None)


# ------------------------------------------------------------------ queries


def test_champion_is_a_fixed_number_of_queries(engine, client, session_factory, teams):
    with session_factory() as session:
        t = _team_objects(session, teams)
        _series(
            session,
            season="2018-19",
            start=date(2019, 6, 1),
            east=t["BOS"],
            west=t["DAL"],
            east_home_wins=True,
            finals_results=[True, True, True, True],
        )
        calendar = Calendar(date(2018, 10, 20))
        player = add_player(session, "Box", "Score")
        for n in range(30):
            game = add_result(
                session,
                home=t["MIN"],
                away=t["DAL"],
                home_won=n % 2 == 0,
                season="2019-20",
                when=calendar.next(),
            )
            add_line(session, game=game, team=t["MIN"], player=player, points=n)
        _series(
            session,
            season="2019-20",
            start=date(2020, 10, 1),
            east=t["BOS"],
            west=t["MIN"],
            east_home_wins=False,
            finals_results=[True, False, True, False, True, False, True],
        )
        session.commit()

    small = statements_for(engine, client, "/events/seasons/2018-19/champion")
    large = statements_for(engine, client, "/events/seasons/2019-20/champion")

    assert len(large) == len(small), (small, large)
    assert 1 <= len(large) <= 6, large
    assert _champion(client, "2019-20")["result"] == "4-3"
