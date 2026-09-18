"""Tests for LiveScoreCache / InMemoryLiveScoreCache / CachedEventProxy
(Proxy pattern, wiki/CodeContext/Standards/gof-patterns.md "Proxy"), per
AGENTS.md TDD workflow. Written before app/events/proxy.py exists.
"""

from datetime import UTC, datetime, timedelta

import boto3
import pytest
from moto import mock_aws

from app.events.interfaces import NormalizedLiveScore, SportsDataSource
from app.events.proxy import CachedEventProxy, DynamoDbLiveScoreCache, InMemoryLiveScoreCache

LIVE_SCORE_CACHE_TABLE_NAME = "fanwire-live-score-cache-test"


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


# --- DynamoDbLiveScoreCache (real adapter, LIVE_SCORE_CACHE_TABLE_NAME) ---
# wiki/CodeContext/Modules/0x00-architecture.md "AWS topology": pk `game#
# <api_sports_game_id>`, TTL attribute `expires_at` (epoch seconds). IAM
# (infra/lib/app-stack.ts's `LiveScoreCache` statement) grants only
# GetItem/PutItem/UpdateItem — no DeleteItem — so an expired-but-not-yet-
# reaped item must be treated as a miss by get() without deleting it,
# mirroring InMemoryLiveScoreCache's semantics but relying on DynamoDB's own
# TTL sweep for eventual cleanup instead of an application-side delete.


@pytest.fixture()
def dynamodb_client():
    with mock_aws():
        client = boto3.client("dynamodb", region_name="us-east-1")
        client.create_table(
            TableName=LIVE_SCORE_CACHE_TABLE_NAME,
            KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "pk", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        client.update_time_to_live(
            TableName=LIVE_SCORE_CACHE_TABLE_NAME,
            TimeToLiveSpecification={"Enabled": True, "AttributeName": "expires_at"},
        )
        yield client


def test_dynamodb_cache_get_is_a_miss_when_nothing_cached(dynamodb_client, clock):
    cache = DynamoDbLiveScoreCache(dynamodb_client, table_name=LIVE_SCORE_CACHE_TABLE_NAME, clock=clock)

    assert cache.get(5001) is None


def test_dynamodb_cache_put_then_get_round_trips_the_score(dynamodb_client, clock):
    cache = DynamoDbLiveScoreCache(dynamodb_client, table_name=LIVE_SCORE_CACHE_TABLE_NAME, clock=clock)

    cache.put(_score(), ttl_seconds=30)

    assert cache.get(5001) == _score()


def test_dynamodb_cache_uses_the_game_hash_pk_convention(dynamodb_client, clock):
    cache = DynamoDbLiveScoreCache(dynamodb_client, table_name=LIVE_SCORE_CACHE_TABLE_NAME, clock=clock)

    cache.put(_score(), ttl_seconds=30)

    item = dynamodb_client.get_item(
        TableName=LIVE_SCORE_CACHE_TABLE_NAME, Key={"pk": {"S": "game#5001"}}
    )
    assert "Item" in item


def test_dynamodb_cache_get_treats_expired_but_unreaped_item_as_a_miss(dynamodb_client, clock):
    # DynamoDB's TTL sweep can lag up to 48h behind the expiry timestamp
    # (AWS docs) — moto never reaps at all, so this is exactly the
    # "expired but not yet reaped" case the contract calls out.
    cache = DynamoDbLiveScoreCache(dynamodb_client, table_name=LIVE_SCORE_CACHE_TABLE_NAME, clock=clock)
    cache.put(_score(), ttl_seconds=10)

    clock.advance(11)

    assert cache.get(5001) is None
    # Never deleted -- get()'s "miss" is a read-time check, not a write; the
    # granted IAM actions (GetItem/PutItem/UpdateItem, no DeleteItem) don't
    # allow this adapter to delete it itself.
    item = dynamodb_client.get_item(
        TableName=LIVE_SCORE_CACHE_TABLE_NAME, Key={"pk": {"S": "game#5001"}}
    )
    assert "Item" in item
