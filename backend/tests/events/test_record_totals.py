"""EVENTS-012: the aggregate tables and rebuild_record_totals(session).
Spec: .ai/tasks/EVENTS-012/ (criterion 10, brief "Shape notes").

Pinned:

- player_season_totals and team_game_totals exist (Base.metadata, as the
  rest of the suite builds its schema), each with a bigint identity primary
  key `id`.
- `app.events.records.rebuild_record_totals(session)` replaces both tables'
  contents from the stored games and box scores, in the caller's
  transaction: it does not commit (another connection sees the old contents
  until the caller commits; a rollback restores them), and running it twice
  gives the same rows, not twice as many.
- A player traded mid-season has one player-season entry, summed across
  teams, whose team is that of the player's last played game of the season
  (by date, not by insertion order; a later did-not-play line does not count).
- A streak record's value is the streak's length and its entry names the
  season: regular games only, ordered by date within the season.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from sqlalchemy import text

from app.db import Base, make_session_factory
from tests.events.players_support import (
    add_game,
    add_line,
    add_player,
    add_team,
    make_client,
    make_players_engine,
)
from tests.record_totals_support import TOTALS_TABLES, identity_pk, snapshots

SEASON = "2015-16"
START = datetime(2015, 10, 27, 19, 30)


def rebuild(session) -> None:
    from app.events import records

    records.rebuild_record_totals(session)


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


def _finals(session, *, winner, loser, season: str, start: datetime) -> None:
    """Four Finals wins for `winner`: a champion, so the season counts."""
    for n in range(4):
        add_game(
            session,
            home=winner,
            away=loser,
            when=start + timedelta(days=n),
            season=season,
            game_type="playoffs",
            label="NBA Finals",
            home_score=110,
            away_score=100,
        )


def _small_history(session):
    """Two teams, three regular games with lines, a champion."""
    home, away = add_team(session, "HOM"), add_team(session, "AWA")
    a, b = add_player(session, "Ann", "Home"), add_player(session, "Bo", "Away")
    for n in range(3):
        game = add_game(
            session, home=home, away=away, when=START + timedelta(days=n), season=SEASON
        )
        add_line(session, game=game, team=home, player=a, points=20 + n, rebounds=5)
        add_line(session, game=game, team=away, player=b, points=10 + n, assists=7)
    _finals(session, winner=home, loser=away, season=SEASON, start=START + timedelta(days=200))
    return home, away, a, b


# ------------------------------------------------------------------- tables


@pytest.mark.parametrize("table", TOTALS_TABLES)
def test_each_totals_table_has_a_bigint_identity_primary_key(engine, table):
    with engine.connect() as conn:
        found = identity_pk(conn, table)

    assert found == ("bigint", "YES", "id"), found


@pytest.mark.parametrize("table", TOTALS_TABLES)
def test_the_models_declare_each_totals_table(table):
    assert table in Base.metadata.tables


# ------------------------------------------------------------------ rebuild


def test_a_rebuild_fills_both_tables_from_the_stored_data(session_factory):
    with session_factory() as session:
        _small_history(session)
        assert all(rows == [] for rows in snapshots(session).values())

        rebuild(session)

        found = snapshots(session)
    assert all(found[table] for table in TOTALS_TABLES), found


def test_a_second_rebuild_replaces_rather_than_adds(session_factory):
    with session_factory() as session:
        _small_history(session)
        rebuild(session)
        first = snapshots(session)
        rebuild(session)
        second = snapshots(session)

    assert first and second == first


def test_a_rebuild_does_not_commit(engine, session_factory):
    with session_factory() as session:
        _small_history(session)
        session.commit()
        rebuild(session)
        assert all(snapshots(session).values())

        with engine.connect() as other:
            assert all(rows == [] for rows in snapshots(other).values())

        session.rollback()
        assert all(rows == [] for rows in snapshots(session).values())


def test_a_rebuild_after_a_game_is_removed_drops_it(session_factory):
    with session_factory() as session:
        _small_history(session)
        rebuild(session)
        before = snapshots(session)
        game_id = session.execute(
            text("SELECT id FROM games WHERE game_type = 'regular' ORDER BY date DESC LIMIT 1")
        ).scalar_one()
        session.execute(text("DELETE FROM player_game_stats WHERE game_id = :g"), {"g": game_id})
        session.execute(text("DELETE FROM games WHERE id = :g"), {"g": game_id})

        rebuild(session)
        after = snapshots(session)

    assert after["player_season_totals"] != before["player_season_totals"]
    assert after["team_game_totals"] != before["team_game_totals"]
    assert len(after["team_game_totals"]) < len(before["team_game_totals"])


# ---------------------------------------------------------- shape: a trade


def test_a_traded_players_season_sums_both_teams_under_the_last_played_team(
    session_factory, client
):
    with session_factory() as session:
        first, second, other = (add_team(session, x) for x in ("FST", "SND", "OTH"))
        traded = add_player(session, "Tra", "Ded")
        # The later games, for the second team, are written first: insertion
        # order must not decide the team.
        for n in range(2):
            game = add_game(
                session, home=second, away=other, when=START + timedelta(days=50 + n), season=SEASON
            )
            add_line(session, game=game, team=second, player=traded, points=30)
        for n in range(3):
            game = add_game(
                session, home=first, away=other, when=START + timedelta(days=n), season=SEASON
            )
            add_line(session, game=game, team=first, player=traded, points=20)
        # A did-not-play line for the first team after the trade: not played.
        game = add_game(
            session, home=first, away=other, when=START + timedelta(days=90), season=SEASON
        )
        add_line(session, game=game, team=first, player=traded, seconds_played=None, points=0)
        _finals(
            session, winner=first, loser=other, season=SEASON, start=START + timedelta(days=200)
        )
        rebuild(session)
        session.commit()
        traded_id, second_id = traded.id, second.id

    response = client.get("/events/records/player-points-season", params={"limit": 100})
    assert response.status_code == 200, response.text
    mine = [e for e in response.json()["entries"] if e["player"]["id"] == traded_id]

    assert len(mine) == 1, mine
    assert mine[0]["value"] == 3 * 20 + 2 * 30
    assert mine[0]["team"]["id"] == second_id
    assert mine[0]["season"] == SEASON


# --------------------------------------------------------- shape: streaks

# The streak team's regular games in date order: W W L W W W W L.
RESULTS = "WWLWWWWL"


def test_a_streak_is_the_value_and_its_entry_names_the_season(session_factory, client):
    with session_factory() as session:
        streaky, rival = add_team(session, "STK"), add_team(session, "RIV")
        # Written in reverse date order: the streak is ordered by date.
        for n in reversed(range(len(RESULTS))):
            won = RESULTS[n] == "W"
            add_game(
                session,
                home=streaky,
                away=rival,
                when=START + timedelta(days=n),
                season=SEASON,
                home_score=110 if won else 90,
                away_score=90 if won else 110,
            )
        # Finals wins are playoffs: they never extend a regular-season streak.
        _finals(
            session, winner=streaky, loser=rival, season=SEASON, start=START + timedelta(days=200)
        )
        rebuild(session)
        session.commit()
        streaky_id, rival_id = streaky.id, rival.id

    wins = client.get("/events/records/team-longest-win-streak", params={"limit": 100})
    losses = client.get("/events/records/team-longest-losing-streak", params={"limit": 100})
    assert wins.status_code == 200, wins.text
    assert losses.status_code == 200, losses.text

    best = wins.json()["entries"][0]
    assert (best["team"]["id"], best["value"], best["season"]) == (streaky_id, 4, SEASON)
    worst = losses.json()["entries"][0]
    assert (worst["team"]["id"], worst["value"], worst["season"]) == (rival_id, 4, SEASON)
