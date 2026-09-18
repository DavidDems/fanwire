"""Tests for LiveScoreCache / InMemoryLiveScoreCache / CachedEventProxy
(Proxy pattern, wiki/CodeContext/Standards/gof-patterns.md "Proxy"), per
AGENTS.md TDD workflow. Written before app/events/proxy.py exists.
"""

from datetime import UTC, datetime, timedelta

import pytest

from app.events.interfaces import NormalizedLiveScore, SportsDataSource
from app.events.proxy import CachedEventProxy, InMemoryLiveScoreCache


class _FakeSource(SportsDataSource):
    """Records every fetch_live_score call and returns queued scores in
    call order — lets a test script exactly what the vendor "returns" on
    each successive call."""

    def __init__(self, scores: list[NormalizedLiveScore | None]) -> None:
        self._scores = list(scores)
        self.calls: list[int] = []

    def fetch_teams(self):
        return []

    def fetch_games(self, *, since=None):
        return []

    def fetch_live_score(self, api_sports_game_id: int):
        self.calls.append(api_sports_game_id)
        return self._scores.pop(0)


class _MutableClock:
    """Injectable clock test double — advanced explicitly instead of
    sleeping, per the prompt's testability requirement."""

    def __init__(self, now: datetime) -> None:
        self._now = now

    def __call__(self) -> datetime:
        return self._now

    def advance(self, seconds: float) -> None:
        self._now += timedelta(seconds=seconds)


def _score(**overrides) -> NormalizedLiveScore:
    defaults = {
        "api_sports_game_id": 5001,
        "home_score": 50,
        "away_score": 48,
        "status": "in_progress",
    }
    defaults.update(overrides)
    return NormalizedLiveScore(**defaults)


@pytest.fixture()
def clock() -> _MutableClock:
    return _MutableClock(datetime(2026, 1, 1, tzinfo=UTC))


def test_cache_hit_avoids_calling_the_source_a_second_time(clock):
    source = _FakeSource([_score()])
    proxy = CachedEventProxy(source, InMemoryLiveScoreCache(clock), ttl_seconds=30)

    first = proxy.get_live_score(5001)
    second = proxy.get_live_score(5001)

    assert first == second == _score()
    assert source.calls == [5001]


def test_cache_miss_calls_the_source_and_populates_the_cache(clock):
    cache = InMemoryLiveScoreCache(clock)
    source = _FakeSource([_score()])
    proxy = CachedEventProxy(source, cache, ttl_seconds=30)

    result = proxy.get_live_score(5001)

    assert result == _score()
    assert source.calls == [5001]
    assert cache.get(5001) == _score()


def test_expired_entry_is_treated_as_a_miss_and_refetches(clock):
    source = _FakeSource([_score(home_score=50), _score(home_score=60)])
    proxy = CachedEventProxy(source, InMemoryLiveScoreCache(clock), ttl_seconds=30)

    first = proxy.get_live_score(5001)
    clock.advance(31)
    second = proxy.get_live_score(5001)

    assert first.home_score == 50
    assert second.home_score == 60
    assert source.calls == [5001, 5001]


def test_a_none_from_the_source_is_never_cached(clock):
    source = _FakeSource([None, _score()])
    proxy = CachedEventProxy(source, InMemoryLiveScoreCache(clock), ttl_seconds=30)

    first = proxy.get_live_score(5001)
    second = proxy.get_live_score(5001)

    assert first is None
    assert second == _score()
    # Called again immediately (no TTL wait) — a vendor miss is never cached.
    assert source.calls == [5001, 5001]


def test_in_memory_cache_get_evicts_expired_entries(clock):
    cache = InMemoryLiveScoreCache(clock)
    cache.put(_score(), ttl_seconds=10)

    clock.advance(11)

    assert cache.get(5001) is None
