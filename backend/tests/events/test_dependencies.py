"""Tests for app.events.dependencies.get_live_score_proxy, per AGENTS.md
TDD workflow. Written before app/events/dependencies.py exists.

feed/ (a later unit) depends on this FastAPI dependency, never constructing
a CachedEventProxy itself. When Settings.api_sports_key is empty (no real
vendor key configured -- the common case until Phase 6 wires a real
secret), it returns None rather than a proxy that would immediately fail
every call; feed/'s view assembly is required to treat a None proxy the
same as any other live-score-unavailable case (no score, never a failed
request).
"""

from __future__ import annotations

from app.events.dependencies import get_live_score_proxy
from app.events.proxy import CachedEventProxy
from app.settings import Settings


def _settings(**overrides) -> Settings:
    return Settings(database_url="postgresql+psycopg://u:p@host:5432/db", **overrides)


def test_returns_none_when_api_sports_key_is_empty():
    settings = _settings(api_sports_key="")

    result = get_live_score_proxy(settings)

    assert result is None


def test_returns_a_cached_event_proxy_when_api_sports_key_is_set():
    settings = _settings(api_sports_base_url="https://api-sports.example.com", api_sports_key="k")

    result = get_live_score_proxy(settings)

    assert isinstance(result, CachedEventProxy)


def test_returns_the_same_process_level_proxy_instance_for_the_same_settings():
    settings = _settings(api_sports_base_url="https://api-sports.example.com", api_sports_key="k")

    first = get_live_score_proxy(settings)
    second = get_live_score_proxy(settings)

    assert first is second
