"""FastAPI dependency wiring for feed/'s (a later unit, per
wiki/CodeContext/Modules/0x06-feed.md) live-score proxy.

get_live_score_proxy() is the sanctioned way feed/ (and later search/)
reaches CachedEventProxy -- never constructing one directly, same
Dependency Inversion shape as app.users.dependencies.get_token_verifier /
app.media.dependencies.get_s3_client.

No real DynamoDB-backed LiveScoreCache adapter exists yet (see
app.events.proxy's own module docstring) -- that's future work, not
something this dependency papers over. This wires InMemoryLiveScoreCache as
the production default for now, the same "no real adapter built yet, wire
the in-process one as the default" precedent as
app.dependencies.get_event_bus (InMemoryEventPublisher) and
app.posts.dependencies.get_moderation_chain (FakeSpamScorer/FakeRateLimiter).

_UrllibHttpClient is a minimal stdlib-only implementation of
app.events.adapters.HttpClient -- httpx is a [project.optional-dependencies]
dev-only dependency in pyproject.toml (used for FastAPI's TestClient), not
part of the Lambda runtime image, so using it here would add a real
runtime dependency without asking first (out of scope for this unit's
brief). urllib.request from the standard library satisfies the same narrow
`get(url, params=None) -> object-with-.json()` protocol with nothing extra
to install.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from functools import lru_cache
from typing import Any

from fastapi import Depends

from app.dependencies import get_settings
from app.events.adapters import ApiSportsAdapter
from app.events.proxy import CachedEventProxy, InMemoryLiveScoreCache
from app.settings import Settings


class _UrllibJsonResponse:
    def __init__(self, payload: Any) -> None:
        self._payload = payload

    def json(self) -> Any:
        return self._payload


class _UrllibHttpClient:
    """Satisfies app.events.adapters.HttpClient using only the standard
    library -- see module docstring for why httpx isn't used here."""

    def get(self, url: str, params: dict[str, Any] | None = None) -> _UrllibJsonResponse:
        if params:
            url = f"{url}?{urllib.parse.urlencode(params)}"
        # Fixed https vendor URL built from Settings, never user input.
        with urllib.request.urlopen(url, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return _UrllibJsonResponse(payload)


@lru_cache(maxsize=1)
def _process_level_proxy(base_url: str, api_key: str) -> CachedEventProxy:
    # Cached by the settings values themselves (not by the Settings
    # instance), same pattern as app.users.dependencies._default_token_verifier
    # -- one CachedEventProxy (and its in-memory cache) per process, per
    # distinct API-SPORTS config, never rebuilt per request/call.
    adapter = ApiSportsAdapter(_UrllibHttpClient(), base_url=base_url, api_key=api_key)
    return CachedEventProxy(adapter, InMemoryLiveScoreCache())


def get_live_score_proxy(settings: Settings = Depends(get_settings)) -> CachedEventProxy | None:
    """None when no real API-SPORTS key is configured (Settings.api_sports_key
    empty) -- feed/'s view assembly must treat that identically to any other
    live-score-unavailable case (no score for that game, never a failed
    feed request), not as an error to propagate."""
    if not settings.api_sports_key:
        return None
    return _process_level_proxy(settings.api_sports_base_url, settings.api_sports_key)
