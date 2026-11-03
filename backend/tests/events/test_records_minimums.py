"""EVENTS-012: a line or player under a stated minimum is never listed.
Spec: .ai/tasks/EVENTS-012/ (criterion 5, brief "Minimums").

One season with a champion, 401 regular games. Every line below is perfect
or near perfect shooting, so a minimum that is not applied puts its player
at the top:

- GAME: one line well over every game minimum (20 FGA, 12 3PA, 12 FTA).
- GAME_UNDER: one perfect line just under each (14 FGA, 7 3PA, 9 FTA).
- SEASON: 60 games of 10 FGA, 4 3PA, 3 FTA (600, 240, 180: over every season
  minimum and 58 games, under every career one and 400 games).
- SEASON_UNDER: 57 perfect games of 8 FGA, 3 3PA, 2 FTA (456, 171, 114) and
  50 points a game: under every season minimum and 58 games.
- CAREER: 401 games of 8 FGA, 3 3PA, 3 FTA (3208, 1203, 1203).
- CAREER_UNDER: 399 perfect games of 7 FGA, 2 3PA, 2 FTA (2793, 798, 798):
  under every career minimum and 400 games.

The boundary itself (exactly the minimum) is not pinned.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

import pytest

from app.db import Base, make_session_factory
from app.events.models import PlayerGameStats
from tests.events.players_support import (
    COUNTING_STATS,
    add_game,
    add_player,
    add_team,
    make_client,
    make_players_engine,
)
from tests.events.records_library import (
    CAREER_AVERAGES,
    SEASON_AVERAGES,
    SHOOTING,
    SHOT_MINIMUMS,
)
from tests.events.records_support import rebuild_totals

SEASON = "2015-16"
START = datetime(2015, 10, 1, 19, 30)
GAMES = 401


@dataclass(frozen=True)
class Shooting:
    fgm: int
    fga: int
    tpm: int
    tpa: int
    ftm: int
    fta: int


# key -> (games played, the line in each)
PLAN: dict[str, tuple[int, Shooting]] = {
    "GAME": (1, Shooting(fgm=12, fga=20, tpm=9, tpa=12, ftm=10, fta=12)),
    "GAME_UNDER": (1, Shooting(fgm=14, fga=14, tpm=7, tpa=7, ftm=9, fta=9)),
    "SEASON": (60, Shooting(fgm=5, fga=10, tpm=2, tpa=4, ftm=2, fta=3)),
    "SEASON_UNDER": (57, Shooting(fgm=8, fga=8, tpm=3, tpa=3, ftm=2, fta=2)),
    "CAREER": (401, Shooting(fgm=4, fga=8, tpm=1, tpa=3, ftm=2, fta=3)),
    "CAREER_UNDER": (399, Shooting(fgm=7, fga=7, tpm=2, tpa=2, ftm=2, fta=2)),
}
ATTEMPTS = {"fg": "fga", "3pt": "tpa", "ft": "fta"}
# Who may be listed at each scope; everyone else is under its minimum.
QUALIFIES: dict[str, frozenset[str]] = {
    "game": frozenset({"GAME"}),
    "season": frozenset({"SEASON", "CAREER", "CAREER_UNDER"}),
    "career": frozenset({"CAREER"}),
}


def _points(s: Shooting, key: str) -> int:
    return 50 if key == "SEASON_UNDER" else 2 * (s.fgm - s.tpm) + 3 * s.tpm + s.ftm


@pytest.fixture(scope="module")
def world(postgres_url):
    engine = make_players_engine(postgres_url)
    factory = make_session_factory(engine)
    with factory() as session:
        home, away = add_team(session, "MIN"), add_team(session, "MAX")
        players = {key: add_player(session, key.title(), "Shooter") for key in PLAN}
        games = [
            add_game(session, home=home, away=away, when=START + timedelta(days=n), season=SEASON)
            for n in range(GAMES)
        ]
        for n in range(4):
            add_game(
                session,
                home=home,
                away=away,
                when=START + timedelta(days=GAMES + 10 + n),
                season=SEASON,
                game_type="playoffs",
                label="NBA Finals",
                home_score=110,
                away_score=100,
            )
        for key, (played, s) in PLAN.items():
            for game in games[:played]:
                values = {stat: 0 for stat in COUNTING_STATS}
                values.update(
                    field_goals_made=s.fgm,
                    field_goals_attempted=s.fga,
                    three_pointers_made=s.tpm,
                    three_pointers_attempted=s.tpa,
                    free_throws_made=s.ftm,
                    free_throws_attempted=s.fta,
                    points=_points(s, key),
                    rebounds=3,
                    assists=3,
                    steals=1,
                    blocks=1,
                )
                session.add(
                    PlayerGameStats(
                        game_id=game.id,
                        team_id=home.id,
                        player_id=players[key].id,
                        starter=False,
                        starting_position=None,
                        seconds_played=1800,
                        plus_minus=0,
                        dnp_reason=None,
                        **values,
                    )
                )
        session.flush()
        rebuild_totals(session)
        session.commit()
        ids = {key: player.id for key, player in players.items()}
    yield make_client(factory), ids
    Base.metadata.drop_all(engine)
    engine.dispose()


def _listed(client, record_id: str) -> list[dict]:
    response = client.get(f"/events/records/{record_id}", params={"limit": 100})
    assert response.status_code == 200, response.text
    return response.json()["entries"]


@pytest.mark.parametrize(("stat", "scope"), list(SHOOTING))
def test_a_shot_pct_lists_only_players_over_its_minimum(world, stat, scope):
    client, ids = world
    _, pct_id = SHOOTING[(stat, scope)]
    allowed = {ids[key] for key in QUALIFIES[scope]}

    entries = _listed(client, pct_id)

    listed = {entry["player"]["id"] for entry in entries}
    assert listed == allowed, {key: ids[key] in listed for key in PLAN}


@pytest.mark.parametrize(("stat", "scope"), list(SHOOTING))
def test_a_shot_pct_entry_is_the_pct_with_made_and_attempted(world, stat, scope):
    client, ids = world
    _, pct_id = SHOOTING[(stat, scope)]
    by_player = {e["player"]["id"]: e for e in _listed(client, pct_id)}

    for key in QUALIFIES[scope]:
        played, s = PLAN[key]
        per_game = {"fg": (s.fgm, s.fga), "3pt": (s.tpm, s.tpa), "ft": (s.ftm, s.fta)}[stat]
        made, attempted = (
            (per_game[0], per_game[1])
            if scope == "game"
            else (
                per_game[0] * played,
                per_game[1] * played,
            )
        )
        entry = by_player[ids[key]]
        assert attempted >= SHOT_MINIMUMS[(stat, scope)]
        assert (entry["made"], entry["attempted"]) == (made, attempted), (key, entry)
        assert entry["value"] == entry["pct"] == round(made / attempted, 3), (key, entry)


@pytest.mark.parametrize(("stat", "scope"), list(SHOOTING))
def test_a_made_total_lists_players_under_the_pct_minimum_too(world, stat, scope):
    """The minimum is the percentage's: the made total has none."""
    client, ids = world
    made_id, _ = SHOOTING[(stat, scope)]

    listed = {entry["player"]["id"] for entry in _listed(client, made_id)}

    assert ids[f"{scope.upper()}_UNDER"] in listed


@pytest.mark.parametrize("record_id", SEASON_AVERAGES)
def test_a_season_average_lists_only_players_with_58_games(world, record_id):
    client, ids = world

    listed = {entry["player"]["id"] for entry in _listed(client, record_id)}

    assert ids["SEASON_UNDER"] not in listed
    assert ids["GAME"] not in listed and ids["GAME_UNDER"] not in listed
    assert {ids["SEASON"], ids["CAREER"], ids["CAREER_UNDER"]} <= listed


@pytest.mark.parametrize("record_id", CAREER_AVERAGES)
def test_a_career_average_lists_only_players_with_400_games(world, record_id):
    client, ids = world

    listed = {entry["player"]["id"] for entry in _listed(client, record_id)}

    assert listed == {ids["CAREER"]}


def test_the_season_ppg_holder_is_not_the_57_game_scorer(world):
    client, ids = world
    response = client.get("/events/records/holders", params={"ids": "player-ppg-season"})
    assert response.status_code == 200, response.text

    holder = response.json()["holders"]["player-ppg-season"]

    assert holder is not None and holder["player"]["id"] != ids["SEASON_UNDER"]
