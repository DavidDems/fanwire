"""GET /events/games/{id}: every played player in both box scores carries
`line_id`, its player_game_stats row's id, which a composer posts as a
`player_game` attachment's target; a did-not-play entry does not gain it
(EVENTS-009, .ai/tasks/EVENTS-009/task.json).
"""

from __future__ import annotations

from datetime import date

import pytest

from app.db import Base, make_session_factory
from tests.events.players_support import (
    add_game,
    add_line,
    add_player,
    add_team,
    make_client,
    make_players_engine,
)


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


def test_every_played_player_carries_its_line_id_and_dnp_entries_do_not(client, session_factory):
    with session_factory() as session:
        home, away = add_team(session, "BOS"), add_team(session, "LAL")
        game = add_game(session, home=home, away=away, when=date(2024, 1, 10), season="2023-24")
        played: dict[int, int] = {}
        for n, team in enumerate((home, home, home, away, away)):
            player = add_player(session, f"P{n}", f"L{n}")
            # One zero-seconds line: it played, so it is in `players`.
            line = add_line(
                session,
                game=game,
                team=team,
                player=player,
                starter=n % 3 == 0,
                seconds_played=0 if n == 2 else 600 + 60 * n,
            )
            played[player.id] = line.id
        for team in (home, away):
            add_line(
                session,
                game=game,
                team=team,
                player=add_player(session, "Bench", team.abbreviation),
                seconds_played=None,
                dnp_reason="DNP - Coach's Decision",
            )
        session.commit()
        game_id = game.id

    response = client.get(f"/events/games/{game_id}")
    assert response.status_code == 200, response.text
    body = response.json()

    seen: dict[int, int] = {}
    for side in ("home_box_score", "away_box_score"):
        for entry in body[side]["players"]:
            assert "line_id" in entry, entry
            seen[entry["player_id"]] = entry["line_id"]
        assert len(body[side]["did_not_play"]) == 1
        for entry in body[side]["did_not_play"]:
            assert "line_id" not in entry, entry
    assert seen == played
