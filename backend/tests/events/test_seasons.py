"""Tests for GET /events/seasons and the 422-or-404 rule shared by every
season route (EVENTS-007). Spec: .ai/tasks/EVENTS-007/.

Pinned contract:

- GET /events/seasons is a bare JSON list of "YYYY-YY" strings: every
  season with at least one stored game, of any game type, each once, newest
  first.
- On /events/seasons/{season}/standings, /champion, /leaders and
  /events/teams/{team_id}/seasons/{season}: a malformed season is a 422; a
  well-formed season with no stored game is a 404, never an empty 200. An
  unknown team is a 404. (Leaders' own 422s are in test_leaders.py.)
"""

from __future__ import annotations

from datetime import date

import pytest

from app.db import Base, make_session_factory
from tests.events.players_support import add_game, add_team, make_client, make_players_engine
from tests.events.seasons_support import SEASON_ROUTES


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


@pytest.fixture()
def two_teams(session_factory):
    """BOS and NYK with one 2024-25 regular game. Returns (bos_id, nyk_id)."""
    with session_factory() as session:
        bos, nyk = add_team(session, "BOS"), add_team(session, "NYK")
        add_game(session, home=bos, away=nyk, when=date(2024, 11, 1), season="2024-25")
        session.commit()
        return bos.id, nyk.id


# ------------------------------------------------------------------ the list


def test_seasons_lists_every_stored_season_once_newest_first(client, session_factory):
    with session_factory() as session:
        bos, nyk = add_team(session, "BOS"), add_team(session, "NYK")
        for when, season, game_type in (
            (date(2019, 1, 5), "2018-19", "regular"),
            (date(2024, 11, 1), "2024-25", "regular"),
            (date(2024, 12, 1), "2024-25", "regular"),
            (date(2021, 5, 20), "2020-21", "playoffs"),
            (date(2023, 12, 9), "2023-24", "cup-final"),
        ):
            add_game(session, home=bos, away=nyk, when=when, season=season, game_type=game_type)
        session.commit()

    response = client.get("/events/seasons")

    assert response.status_code == 200, response.text
    assert response.json() == ["2024-25", "2023-24", "2020-21", "2018-19"]


# ----------------------------------------------------------------- 422 / 404


@pytest.mark.parametrize("route", SEASON_ROUTES)
@pytest.mark.parametrize("season", ["2024", "2024-2025", "24-25", "abcd-ef", "2024_25"])
def test_a_malformed_season_is_a_422(client, two_teams, route, season):
    response = client.get(route.format(season=season), params={"stat": "points"})

    assert response.status_code == 422, response.text


@pytest.mark.parametrize("season", ["2024", "2024-2025", "abcd-ef"])
def test_a_malformed_season_on_a_team_season_is_a_422(client, two_teams, season):
    bos_id, _ = two_teams

    response = client.get(f"/events/teams/{bos_id}/seasons/{season}")

    assert response.status_code == 422, response.text


@pytest.mark.parametrize("route", SEASON_ROUTES)
def test_a_season_without_stored_games_is_a_404(client, two_teams, route):
    # The stored season answers 200 first, so the 404 is about the season,
    # not about the route being missing.
    stored = client.get(route.format(season="2024-25"), params={"stat": "points"})
    response = client.get(route.format(season="1999-00"), params={"stat": "points"})

    assert stored.status_code == 200, stored.text
    assert response.status_code == 404, response.text


def test_a_season_without_stored_games_is_a_404_on_a_team_season(client, two_teams):
    bos_id, _ = two_teams

    stored = client.get(f"/events/teams/{bos_id}/seasons/2024-25")
    response = client.get(f"/events/teams/{bos_id}/seasons/1999-00")

    assert stored.status_code == 200, stored.text
    assert response.status_code == 404, response.text


def test_an_unknown_team_is_a_404(client, two_teams):
    bos_id, nyk_id = two_teams
    unknown = max(bos_id, nyk_id) + 1000

    stored = client.get(f"/events/teams/{bos_id}/seasons/2024-25")
    response = client.get(f"/events/teams/{unknown}/seasons/2024-25")

    assert stored.status_code == 200, stored.text
    assert response.status_code == 404, response.text
