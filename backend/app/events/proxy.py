"""LiveScoreCache / InMemoryLiveScoreCache / CachedEventProxy — Proxy pattern
(wiki/CodeContext/Standards/gof-patterns.md "Proxy": "CachedEventProxy sits
in front of the real sports API call; feed/ and search/ query the proxy,
which caches live scores for a short TTL to respect provider rate limits.").
See also wiki/CodeContext/Modules/0x02-events.md and
wiki/CodeContext/Modules/0x00-architecture.md "AWS topology" (DynamoDB is
used narrowly for, among other things, "a short-TTL live-score cache behind
CachedEventProxy").

feed/ and search/ (built in later Phase 3 units, per wiki/CodeContext/
Standards/gof-patterns.md) are expected to import and call
CachedEventProxy.get_live_score() directly — wiring it into a FastAPI route
or DI dependency is out of scope here.

No real DynamoDB-backed LiveScoreCache adapter exists yet — no live AWS this
phase, same precedent as app.eventbus.EventPublisher /
app.media.pipeline.MalwareScanner (InMemoryEventPublisher / FakeMalwareScanner
are the only implementations built so far, real adapters are future work). A
production DynamoDB adapter satisfying LiveScoreCache is future work too.
"""

from __future__ import annotations

import abc
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from app.events.interfaces import NormalizedLiveScore, SportsDataSource


class LiveScoreCache(abc.ABC):
    """Narrow injected interface (Dependency Inversion, same shape as
    app.eventbus.EventPublisher / app.media.pipeline.MalwareScanner) —
    CachedEventProxy depends on this, never a concrete cache/DynamoDB
    client."""

    @abc.abstractmethod
    def get(self, api_sports_game_id: int) -> NormalizedLiveScore | None:
        """Return the cached score for this game, or None on a miss (never
        cached, or its TTL has expired)."""

    @abc.abstractmethod
    def put(self, score: NormalizedLiveScore, *, ttl_seconds: int) -> None:
        """Cache `score`, to expire ttl_seconds after this call."""


class InMemoryLiveScoreCache(LiveScoreCache):
    """Test double: dict-backed, tracks each entry's expiry via an injected
    clock so tests can advance time deterministically instead of sleeping.
    Never touches DynamoDB."""

    def __init__(self, clock: Callable[[], datetime] = lambda: datetime.now(UTC)) -> None:
        self._clock = clock
        self._entries: dict[int, tuple[NormalizedLiveScore, datetime]] = {}

    def get(self, api_sports_game_id: int) -> NormalizedLiveScore | None:
        entry = self._entries.get(api_sports_game_id)
        if entry is None:
            return None

        score, expires_at = entry
        if self._clock() >= expires_at:
            del self._entries[api_sports_game_id]
            return None
        return score

    def put(self, score: NormalizedLiveScore, *, ttl_seconds: int) -> None:
        expires_at = self._clock() + timedelta(seconds=ttl_seconds)
        self._entries[score.api_sports_game_id] = (score, expires_at)


class CachedEventProxy:
    """Proxy (wiki/CodeContext/Standards/gof-patterns.md "Proxy"): callers
    (feed/, search/) call get_live_score() instead of a SportsDataSource
    directly, so the vendor's live-score endpoint is hit at most once per
    ttl_seconds per game. A vendor miss (None) is never cached, so a game
    that hasn't started yet gets rechecked on the very next call rather than
    being stuck behind a cached negative result."""

    def __init__(
        self, source: SportsDataSource, cache: LiveScoreCache, *, ttl_seconds: int = 30
    ) -> None:
        self._source = source
        self._cache = cache
        self._ttl_seconds = ttl_seconds

    def get_live_score(self, api_sports_game_id: int) -> NormalizedLiveScore | None:
        cached = self._cache.get(api_sports_game_id)
        if cached is not None:
            return cached

        score = self._source.fetch_live_score(api_sports_game_id)
        if score is not None:
            self._cache.put(score, ttl_seconds=self._ttl_seconds)
        return score
