"""EVENTS-001: a game without an API-SPORTS id never asks the live-score
proxy for a score, per AGENTS.md TDD workflow. Written before the change
exists.

Games loaded from the Kaggle "NBA games" dataset carry only an nba.com id
(`nba_game_id`); `api_sports_game_id` is None. CachedEventProxy is keyed by
the API-SPORTS id, so feed/ must skip such a game outright -- even when its
date falls inside the live-score window -- rather than call the proxy with
None.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.db import Base, make_engine, make_session_factory
from app.events.interfaces import NormalizedLiveScore
from app.events.models import Game, Team
from app.events.service import GameRef, games_by_ids
from app.feed.views import _live_scores_for_games


class _RecordingProxy:
    """Stands in for CachedEventProxy: records every id it is asked about and
    always has a score, so a call that should not happen is visible both in
    `calls` and in the result."""

    def __init__(self) -> None:
        self.calls: list[object] = []

    def get_live_score(self, api_sports_game_id):
        self.calls.append(api_sports_game_id)
        return NormalizedLiveScore(
            api_sports_game_id=api_sports_game_id or 0,
            home_score=50,
            away_score=48,
            status="Q3",
        )


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_game_without_api_sports_id_is_never_sent_to_the_proxy():
    proxy = _RecordingProxy()
    in_window = datetime.now(UTC) - timedelta(hours=1)
    games = {1: GameRef(id=1, api_sports_game_id=None, date=in_window)}

    result = _live_scores_for_games(games, proxy)

    assert proxy.calls == []
    assert result == {}


def test_only_games_with_an_api_sports_id_are_sent_to_the_proxy():
    proxy = _RecordingProxy()
    in_window = datetime.now(UTC) - timedelta(hours=1)
    games = {
        1: GameRef(id=1, api_sports_game_id=None, date=in_window),
        2: GameRef(id=2, api_sports_game_id=5002, date=in_window),
    }

    result = _live_scores_for_games(games, proxy)

    assert proxy.calls == [5002]
    assert set(result) == {2}


def test_games_by_ids_returns_a_none_api_sports_id_for_an_nba_only_game(session_factory):
    with session_factory() as session:
        home = Team(
            nba_team_id=1610612761,
            name="Toronto Raptors",
            abbreviation="TOR",
            conference="Eastern",
            division="Atlantic",
        )
        away = Team(
            nba_team_id=1610612738,
            name="Boston Celtics",
            abbreviation="BOS",
            conference="Eastern",
            division="Atlantic",
        )
        session.add_all([home, away])
        session.commit()
        game = Game(
            nba_game_id=21900001,
            game_type="regular",
            home_team_id=home.id,
            away_team_id=away.id,
            date=datetime.now(UTC) - timedelta(hours=1),
            season="2019-20",
            home_score=130,
            away_score=122,
            player_stats=[],
        )
        session.add(game)
        session.commit()
        game_id = game.id

        refs = games_by_ids(session, [game_id])

    assert refs[game_id].api_sports_game_id is None

    proxy = _RecordingProxy()
    assert _live_scores_for_games(refs, proxy) == {}
    assert proxy.calls == []
