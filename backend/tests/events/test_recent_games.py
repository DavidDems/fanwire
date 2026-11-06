"""EVENTS-013: public, season-ranked results from three completed calendar dates."""

from datetime import date, datetime
from unittest.mock import patch

import pytest

from app.db import Base, make_session_factory
from app.events import service
from app.events.routes import router
from tests.events.players_support import add_game, add_team, make_client, make_players_engine
from tests.events.seasons_support import statements_for


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


def recent(client, **params):
    response = client.get("/events/games/recent", params=params)
    assert response.status_code == 200, response.text
    body = response.json()
    assert isinstance(body, list)
    return body


def test_literal_recent_route_precedes_game_id():
    paths = [route.path for route in router.routes]
    assert "/events/games/recent" in paths
    assert paths.index("/events/games/recent") < paths.index("/events/games/{game_id}")


def test_empty_database_is_public_empty_list(client):
    assert recent(client) == []


@pytest.mark.parametrize("limit", ["0", "11", "-1", "1.5", "word", ""])
def test_limit_rejects_values_outside_integer_one_to_ten(client, limit):
    assert client.get("/events/games/recent", params={"limit": limit}).status_code == 422


def test_three_distinct_completed_dates_of_any_type_not_relative_to_today(client, session_factory):
    with session_factory() as session:
        home, away = add_team(session, "TOR"), add_team(session, "PHX")
        ids = []
        for day, hour, kind in [
            (1, 19, "regular"),
            (2, 19, "regular"),
            (10, 19, "play-in"),
            (20, 18, "playoffs"),
            (20, 23, "cup-final"),
        ]:
            game = add_game(
                session,
                home=home,
                away=away,
                season="2020-21",
                when=datetime(2021, 6, day, hour),
                game_type=kind,
                label="Game label",
            )
            ids.append(game.id)
        add_game(
            session,
            home=home,
            away=away,
            season="2020-21",
            when=date(2021, 6, 30),
            home_score=0,
            away_score=0,
        )
        session.commit()
    body = recent(client, limit=10)
    assert [row["id"] for row in body] == ids[:0:-1]
    row = body[0]
    assert row["date"].startswith("2021-06-20T23:00")
    assert row["game_type"] == "cup-final"
    assert row["label"] == "Game label"
    assert row["home_team"]["abbreviation"] == "TOR"
    assert row["away_team"]["abbreviation"] == "PHX"
    assert {"id", "name", "abbreviation"} <= row["home_team"].keys()
    assert (row["home_score"], row["away_score"]) == (100, 90)


def test_ranks_are_league_wide_season_specific_and_unrecorded_teams_last(client, session_factory):
    with session_factory() as session:
        a = add_team(session, "AAA", "Alpha")
        b = add_team(session, "BBB", "Bravo")
        c = add_team(session, "CCC", "Charlie")
        c.conference = "West"
        missing = add_team(session, "ZZZ", "Absent regular record")
        # Alpha wins the older season; Charlie wins the newer season.
        for season, winner, loser in [("2020-21", a, c), ("2021-22", c, a)]:
            add_game(session, home=winner, away=b, season=season, when=date(2020, 1, 1))
            add_game(session, home=b, away=loser, season=season, when=date(2020, 1, 2))
        old = add_game(
            session, home=a, away=c, season="2020-21", when=date(2022, 1, 1), game_type="playoffs"
        )
        new = add_game(
            session, home=a, away=c, season="2021-22", when=date(2022, 1, 2), game_type="playoffs"
        )
        absent = add_game(
            session,
            home=missing,
            away=b,
            season="2021-22",
            when=date(2022, 1, 3),
            game_type="cup-final",
        )
        expected = {old.id: (1, 3), new.id: (3, 1), absent.id: (4, 2)}
        session.commit()
    body = recent(client, limit=10)
    assert {r["id"]: (r["home_rank"], r["away_rank"]) for r in body} == expected
    assert [r["id"] for r in body] == [new.id, old.id, absent.id]
    by_id = {row["id"]: row for row in body}
    assert by_id[old.id]["season"] == "2020-21"
    assert by_id[new.id]["season"] == "2021-22"
    assert by_id[old.id]["home_record"] == {"wins": 1, "losses": 0}
    assert by_id[new.id]["home_record"] == {"wins": 0, "losses": 1}
    assert by_id[absent.id]["home_record"] == {"wins": 0, "losses": 0}
    for season, ids in [("2020-21", [old.id]), ("2021-22", [new.id, absent.id])]:
        response = client.get(f"/events/seasons/{season}/standings")
        assert response.status_code == 200
        standings = {
            r["team"]["id"]: r
            for conference in response.json()["conferences"]
            for division in conference["divisions"]
            for r in division["teams"]
        }
        for game_id in ids:
            for side in ["home", "away"]:
                row = by_id[game_id]
                record = standings.get(row[f"{side}_team"]["id"], {"wins": 0, "losses": 0})
                assert row[f"{side}_record"] == {k: record[k] for k in ["wins", "losses"]}


def test_rank_order_is_exact_percentage_then_wins_then_name(client, session_factory):
    with session_factory() as session:
        opponent = add_team(session, "OPP", "Opponent")
        teams = []
        # Zeta's 501/1001 and Alpha's 1/2 both display .500, but Zeta ranks first.
        for code, name, wins, losses in [
            ("ZZZ", "Zeta", 501, 500),
            ("AAA", "Alpha", 1, 1),
            ("BBB", "Bravo", 2, 2),
            ("CCC", "Charlie", 2, 2),
        ]:
            team = add_team(session, code, name)
            teams.append(team)
            for n in range(wins + losses):
                add_game(
                    session,
                    home=team,
                    away=opponent,
                    season="2020-21",
                    when=date(2020, 1, 1),
                    home_score=100 if n < wins else 90,
                    away_score=90 if n < wins else 100,
                )
        expected = {}
        for team, rank, day in zip(teams, [1, 4, 2, 3], [1, 1, 2, 3], strict=True):
            game = add_game(
                session,
                home=team,
                away=opponent,
                season="2020-21",
                when=date(2021, 6, day),
                game_type="playoffs",
            )
            expected[game.id] = rank
        session.commit()
    assert {row["id"]: row["home_rank"] for row in recent(client, limit=10)} == expected


def test_default_limit_and_equal_sum_ties_use_newer_date_then_higher_id(client, session_factory):
    with session_factory() as session:
        home, away = add_team(session, "TOR"), add_team(session, "PHX")
        ids = [
            add_game(
                session,
                home=home,
                away=away,
                season="2020-21",
                when=date(2021, 6, 1 + n // 4),
                game_type="playoffs",
            ).id
            for n in range(10)
        ]
        session.commit()
    assert [r["id"] for r in recent(client)] == ids[::-1][:5]
    assert [r["id"] for r in recent(client, limit=1)] == ids[-1:]
    assert [r["id"] for r in recent(client, limit=10)] == ids[::-1]


def test_statement_count_does_not_grow_with_candidates_limits_or_seasons(
    engine, client, session_factory
):
    with session_factory() as session:
        home, away = add_team(session, "TOR"), add_team(session, "PHX")
        add_game(session, home=home, away=away, season="2020-21", when=date(2021, 6, 1))
        session.commit()
        small = statements_for(engine, client, "/events/games/recent", limit=1)
        for n in range(30):
            add_game(
                session,
                home=home,
                away=away,
                season=f"{2020 + n % 3}-{21 + n % 3}",
                when=date(2021, 6, 1 + n % 3),
                game_type="playoffs",
            )
        session.commit()
    with patch.object(service, "_records", wraps=service._records) as records:
        large = statements_for(engine, client, "/events/games/recent", limit=10)
    assert len(small) == len(large), (small, large)
    assert 1 <= len(large) <= 6, large
    assert any("GROUP BY" in sql.upper() for sql in large)
    assert records.called, "Reuse the events record aggregation for season ranks"
