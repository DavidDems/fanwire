"""Tests for app.events.interfaces — NormalizedLiveScore shape and the
SportsDataSource.fetch_live_score abstract contract, per AGENTS.md TDD
workflow. Written before either exists.
"""

import pytest

from app.events.interfaces import NormalizedLiveScore, SportsDataSource


def test_normalized_live_score_is_a_frozen_dataclass_with_the_expected_fields():
    score = NormalizedLiveScore(
        api_sports_game_id=5001, home_score=50, away_score=48, status="in_progress"
    )

    assert score.api_sports_game_id == 5001
    assert score.home_score == 50
    assert score.away_score == 48
    assert score.status == "in_progress"
    with pytest.raises(AttributeError):
        score.home_score = 51  # frozen


def test_sports_data_source_requires_fetch_live_score_to_be_implemented():
    class _IncompleteSource(SportsDataSource):
        def fetch_teams(self):
            return []

        def fetch_games(self, *, since=None):
            return []

    with pytest.raises(TypeError):
        _IncompleteSource()
