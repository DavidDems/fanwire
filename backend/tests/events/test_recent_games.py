"""EVENTS-013/015: public, season-ranked results, newest calendar date first.

EVENTS-015: candidates are every completed game on the newest `limit` completed
dates; the order is calendar date descending, then rank sum ascending, then
start time and id descending.
"""

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


def test_completed_games_of_any_type_newest_date_first_not_relative_to_today(
    client, session_factory
):
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
    # EVENTS-015: limit 10 spans ten dates, so the oldest (June 1) game is included.
    body = recent(client, limit=10)
    assert [row["id"] for row in body] == ids[::-1]
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
    # limit 3 keeps the window to the three 2022 dates (the 2020 record games are older).
    body = recent(client, limit=3)
    assert {r["id"]: (r["home_rank"], r["away_rank"]) for r in body} == expected
    assert [r["id"] for r in body] == [absent.id, new.id, old.id]
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
    # limit 4: the four playoff games fill the list before the 2020 record games.
    assert {row["id"]: row["home_rank"] for row in recent(client, limit=4)} == expected


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


def ranked_teams(session, n):
    """n teams ranked 1..n in 2020-21: all unbeaten, team k (0-based) with n - k
    regular wins over a winless sink team, all on 2020-01-01. Returns the list
    in rank order, so teams[k] has rank k + 1."""
    sink = add_team(session, "SNK", "Sink")
    teams = [add_team(session, f"T{k:02d}", f"Team {k:02d}") for k in range(n)]
    for k, team in enumerate(teams):
        for _ in range(n - k):
            add_game(session, home=team, away=sink, season="2020-21", when=date(2020, 1, 1))
    return teams


def playoff(session, teams, home, away, when):
    return add_game(
        session,
        home=teams[home],
        away=teams[away],
        season="2020-21",
        when=when,
        game_type="playoffs",
    ).id


def test_newest_date_fills_first_then_best_ranked_of_the_day_before(client, session_factory):
    # The brief's example: 3 games on the newest date, 8 the day before, limit 5.
    with session_factory() as session:
        t = ranked_teams(session, 12)
        newest = datetime(2021, 6, 10)
        before = datetime(2021, 6, 9)
        # Newest date, inserted out of rank and out of time order. Rank sums:
        # (10, 11) -> 23, (0, 5) -> 7, (6, 7) -> 15.
        weak = playoff(session, t, 10, 11, newest.replace(hour=22))
        best = playoff(session, t, 0, 5, newest.replace(hour=18))
        mid = playoff(session, t, 6, 7, newest.replace(hour=20))
        # Day before: sums 3, 5, ..., 17, inserted in a shuffled order. Every one
        # of them beats the newest date's best (7) or ties it at most.
        before_ids = {}
        for a, hour in [(4, 19), (0, 12), (7, 21), (2, 13), (5, 20), (1, 23), (6, 14), (3, 15)]:
            before_ids[a] = playoff(session, t, a, a + 1, before.replace(hour=hour))
        session.commit()
    body = recent(client, limit=5)
    assert [r["id"] for r in body] == [best, mid, weak, before_ids[0], before_ids[1]]
    ranks = [(r["home_rank"], r["away_rank"]) for r in body]
    assert ranks == [(1, 6), (7, 8), (11, 12), (1, 2), (2, 3)]


def test_strong_game_on_an_older_date_never_outranks_a_newer_date(client, session_factory):
    with session_factory() as session:
        t = ranked_teams(session, 6)
        # Calendar date as stored: 00:30 on June 10 is newer than 23:30 on June 9.
        weakest = playoff(session, t, 4, 5, datetime(2021, 6, 10, 0, 30))  # sum 11
        middle = playoff(session, t, 2, 3, datetime(2021, 6, 9, 23, 30))  # sum 7
        strongest = playoff(session, t, 0, 1, datetime(2021, 6, 8, 19))  # sum 3
        session.commit()
    assert [r["id"] for r in recent(client, limit=3)] == [weakest, middle, strongest]
    assert [r["id"] for r in recent(client, limit=2)] == [weakest, middle]


def test_date_window_is_the_newest_limit_dates_not_a_fixed_three(client, session_factory):
    with session_factory() as session:
        t = ranked_teams(session, 14)
        # One game per date, June 1..7; older dates get the stronger matchups.
        ids = [
            playoff(session, t, 2 * (7 - day), 2 * (7 - day) + 1, date(2021, 6, day))
            for day in range(1, 8)
        ]
        session.commit()
    newest_first = ids[::-1]
    assert [r["id"] for r in recent(client, limit=5)] == newest_first[:5]
    # limit 10 reaches past June 1 to the 2020-01-01 record games (the eighth date).
    body = recent(client, limit=10)
    assert [r["id"] for r in body[:7]] == newest_first
    assert len(body) == 10
    assert {r["date"][:10] for r in body[7:]} == {"2020-01-01"}


def test_equal_sums_within_a_date_order_by_later_start_then_higher_id(client, session_factory):
    with session_factory() as session:
        t = ranked_teams(session, 4)
        day = datetime(2021, 6, 10)
        # (0, 3) and (1, 2) both sum to 5; (0, 1) sums to 3.
        early_low_id = playoff(session, t, 0, 3, day.replace(hour=19))
        late_low_id = playoff(session, t, 1, 2, day.replace(hour=21))
        late_high_id = playoff(session, t, 0, 3, day.replace(hour=21))
        early_high_id = playoff(session, t, 1, 2, day.replace(hour=19))
        latest = playoff(session, t, 2, 1, day.replace(hour=23))
        strongest = playoff(session, t, 0, 1, day.replace(hour=12))
        session.commit()
    # limit 6: the window's six dates include 2020-01-01, but June 10 fills the list.
    assert [r["id"] for r in recent(client, limit=6)] == [
        strongest,
        latest,
        late_high_id,
        late_low_id,
        early_high_id,
        early_low_id,
    ]


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
