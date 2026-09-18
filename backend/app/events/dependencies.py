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

import boto3  # type: ignore[import-untyped]  # no boto3 stubs/py.typed marker installed
from fastapi import Depends

from app.dependencies import get_settings
from app.events.adapters import ApiSportsAdapter
from app.events.proxy import CachedEventProxy, DynamoDbLiveScoreCache, InMemoryLiveScoreCache
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
def _secrets_manager_client(region: str) -> Any:
    # Process-wide boto3 Secrets Manager client, built once per distinct
    # region -- same "build once, cache, inject" shape as
    # app.media.dependencies.get_s3_client. Takes the region explicitly
    # (rather than calling app.dependencies.get_settings() itself) so this
    # always reflects the *passed-in* Settings instance -- get_live_score_proxy
    # is a FastAPI dependency that may be given an explicit Settings in
    # tests/handlers, not necessarily the process-wide cached one.
    return boto3.client("secretsmanager", region_name=region)


@lru_cache(maxsize=1)
def _cached_secret_value(secret_arn: str, region: str) -> str:
    # Read once per cold start, per distinct secret ARN, then cached for the
    # life of the process -- the API-SPORTS key never rotates mid-invocation,
    # and re-reading it on every ingestion run would be a needless Secrets
    # Manager call (and NAT-instance egress hop, see wiki/CodeContext/
    # Modules/0x00-architecture.md "Egress") on every cold start's first use.
    return _secrets_manager_client(region).get_secret_value(SecretId=secret_arn)["SecretString"]


def _resolve_api_sports_key(settings: Settings) -> str:
    """Settings.api_sports_key (an env var -- local dev/tests, or an
    operator override) always wins when set. Otherwise, when
    Settings.api_sports_secret_arn is set (infra/lib/app-stack.ts's
    `API_SPORTS_SECRET_ARN`, ingestion Lambda only), read the real vendor
    key from Secrets Manager. Neither set -> "" (no real key configured),
    get_live_score_proxy's own signal to return None rather than build a
    proxy that would fail on first use."""
    if settings.api_sports_key:
        return settings.api_sports_key
    if settings.api_sports_secret_arn:
        return _cached_secret_value(settings.api_sports_secret_arn, settings.aws_default_region)
    return ""


@lru_cache(maxsize=1)
def _dynamodb_client(region: str) -> Any:
    # Process-wide boto3 DynamoDB client for DynamoDbLiveScoreCache, same
    # "build once, cache, inject" shape as _secrets_manager_client above.
    return boto3.client("dynamodb", region_name=region)


@lru_cache(maxsize=1)
def _process_level_proxy(
    base_url: str, api_key: str, live_score_cache_table_name: str, region: str
) -> CachedEventProxy:
    # Cached by the settings values themselves (not by the Settings
    # instance), same pattern as app.users.dependencies._default_token_verifier
    # -- one CachedEventProxy (and its cache) per process, per distinct
    # API-SPORTS config, never rebuilt per request/call.
    adapter = ApiSportsAdapter(_UrllibHttpClient(), base_url=base_url, api_key=api_key)
    cache: InMemoryLiveScoreCache | DynamoDbLiveScoreCache
    if live_score_cache_table_name:
        cache = DynamoDbLiveScoreCache(
            _dynamodb_client(region), table_name=live_score_cache_table_name
        )
    else:
        cache = InMemoryLiveScoreCache()
    return CachedEventProxy(adapter, cache)


def get_live_score_proxy(settings: Settings = Depends(get_settings)) -> CachedEventProxy | None:
    """None when no real API-SPORTS key is configured (Settings.api_sports_key
    empty and no Settings.api_sports_secret_arn either) -- feed/'s view
    assembly must treat that identically to any other live-score-unavailable
    case (no score for that game, never a failed feed request), not as an
    error to propagate. Backed by DynamoDbLiveScoreCache once
    Settings.live_score_cache_table_name is set, otherwise
    InMemoryLiveScoreCache (local dev/tests), same "no real adapter until
    the table name is known" precedent as app.dependencies.get_event_bus."""
    api_key = _resolve_api_sports_key(settings)
    if not api_key:
        return None
    return _process_level_proxy(
        settings.api_sports_base_url,
        api_key,
        settings.live_score_cache_table_name,
        settings.aws_default_region,
    )
