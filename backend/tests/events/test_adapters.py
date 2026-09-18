"""Tests for ApiSportsAdapter's vendor-JSON -> Normalized* transform, per
AGENTS.md TDD workflow. Written before app/events/adapters.py exists.

The fixture at tests/fixtures/api_sports_sample.json is an illustrative,
invented sample shape (see that file's `_comment` and the adapter module's
docstring) — not verified against a live API-SPORTS response.
"""

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from app.events.adapters import ApiSportsAdapter
from app.events.interfaces import NormalizedLiveScore, NormalizedTeam

FIXTURE_PATH = Path(__file__).resolve().parents[1] / "fixtures" / "api_sports_sample.json"
SAMPLE = json.loads(FIXTURE_PATH.read_text())


class _FakeResponse:
    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload

    def json(self) -> dict[str, Any]:
        return self._payload


class _FakeHttpClient:
    """Stub satisfying the adapter's injected-client interface: records every
    call and returns a canned fixture payload keyed by URL suffix."""

    def __init__(self, teams_payload: dict[str, Any], games_payload: dict[str, Any]) -> None:
        self._teams_payload = teams_payload
        self._games_payload = games_payload
        self.calls: list[tuple[str, dict[str, Any] | None]] = []

    def get(self, url: str, params: dict[str, Any] | None = None) -> _FakeResponse:
        self.calls.append((url, params))
        if url.endswith("/teams"):
            return _FakeResponse(self._teams_payload)
        if url.endswith("/games"):
            return _FakeResponse(self._games_payload)
        raise AssertionError(f"unexpected url requested: {url}")


@pytest.fixture()
def fake_client() -> _FakeHttpClient:
    return _FakeHttpClient(SAMPLE["teams_response"], SAMPLE["games_response"])


@pytest.fixture()
def adapter(fake_client: _FakeHttpClient) -> ApiSportsAdapter:
    return ApiSportsAdapter(fake_client, base_url="https://example.invalid/v1", api_key="test-key")


def test_fetch_teams_returns_normalized_teams_never_raw_json(adapter, fake_client):
    teams = adapter.fetch_teams()

    assert teams == [
        NormalizedTeam(
            api_sports_team_id=12,
            name="Boston Celtics",
            abbreviation="BOS",
            conference="Eastern",
            division="Atlantic",
            logo_url="https://example.invalid/logos/celtics.png",
        ),
        NormalizedTeam(
            api_sports_team_id=17,
            name="Los Angeles Lakers",
            abbreviation="LAL",
            conference="Western",
            division="Pacific",
            logo_url="https://example.invalid/logos/lakers.png",
        ),
    ]
    assert fake_client.calls[0][0].endswith("/teams")


def test_fetch_games_returns_normalized_games_with_player_stats(adapter):
    games = adapter.fetch_games()

    assert len(games) == 1
    game = games[0]
    assert game.api_sports_game_id == 5001
    assert game.home_team_id == 12
    assert game.away_team_id == 17
    assert game.date == datetime.fromisoformat("2025-11-01T19:30:00+00:00")
    assert game.season == "2025-26"
    assert game.home_score == 112
    assert game.away_score == 108
    assert game.venue == "TD Garden"
    assert game.player_stats == [
        {"player_name": "Jayson Tatum", "team_id": 12, "points": 28, "rebounds": 7, "assists": 5},
        {"player_name": "LeBron James", "team_id": 17, "points": 25, "rebounds": 8, "assists": 9},
    ]


def test_fetch_games_passes_since_as_a_date_query_param(adapter, fake_client):
    adapter.fetch_games(since=datetime(2025, 11, 1, tzinfo=UTC))

    _, params = fake_client.calls[0]
    assert params is not None
    assert params["date"] == "2025-11-01"


class _FakeLiveScoreHttpClient:
    """Stub for the live-score endpoint only — separate from _FakeHttpClient
    since fetch_live_score hits the same `/games` URL suffix as fetch_games
    but is disambiguated by the `id` query param, not the URL."""

    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload
        self.calls: list[tuple[str, dict[str, Any] | None]] = []

    def get(self, url: str, params: dict[str, Any] | None = None) -> _FakeResponse:
        self.calls.append((url, params))
        return _FakeResponse(self._payload)


def test_fetch_live_score_returns_normalized_live_score():
    payload = {
        "response": [
            {
                "id": 5001,
                "scores": {"home": {"total": 56}, "away": {"total": 52}},
                "status": {"short": "in_progress"},
            }
        ]
    }
    client = _FakeLiveScoreHttpClient(payload)
    adapter = ApiSportsAdapter(client, base_url="https://example.invalid/v1", api_key="test-key")

    score = adapter.fetch_live_score(5001)

    assert score == NormalizedLiveScore(
        api_sports_game_id=5001, home_score=56, away_score=52, status="in_progress"
    )
    url, params = client.calls[0]
    assert url.endswith("/games")
    assert params["id"] == 5001


def test_fetch_live_score_returns_none_when_vendor_has_no_data_for_the_game():
    client = _FakeLiveScoreHttpClient({"response": []})
    adapter = ApiSportsAdapter(client, base_url="https://example.invalid/v1", api_key="test-key")

    assert adapter.fetch_live_score(9999) is None


def test_api_key_is_injected_not_hardcoded(fake_client):
    adapter_a = ApiSportsAdapter(fake_client, base_url="https://example.invalid", api_key="key-a")
    adapter_b = ApiSportsAdapter(fake_client, base_url="https://example.invalid", api_key="key-b")

    adapter_a.fetch_teams()
    adapter_b.fetch_teams()

    assert fake_client.calls[0][1]["key"] == "key-a"
    assert fake_client.calls[1][1]["key"] == "key-b"
