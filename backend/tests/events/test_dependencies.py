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

import boto3
import pytest
from moto import mock_aws

from app.events import dependencies as events_dependencies
from app.events.dependencies import get_live_score_proxy
from app.events.proxy import CachedEventProxy, DynamoDbLiveScoreCache, InMemoryLiveScoreCache
from app.settings import Settings


def _settings(**overrides) -> Settings:
    return Settings(database_url="postgresql+psycopg://u:p@host:5432/db", **overrides)


@pytest.fixture(autouse=True)
def _clear_module_caches():
    # _process_level_proxy / _cached_secret_value / _dynamodb_client are all
    # process-wide lru_cache state -- clear before/after every test so one
    # test's cached proxy/secret/client never leaks into another's.
    events_dependencies._process_level_proxy.cache_clear()
    events_dependencies._cached_secret_value.cache_clear()
    events_dependencies._dynamodb_client.cache_clear()
    events_dependencies._secrets_manager_client.cache_clear()
    yield
    events_dependencies._process_level_proxy.cache_clear()
    events_dependencies._cached_secret_value.cache_clear()
    events_dependencies._dynamodb_client.cache_clear()
    events_dependencies._secrets_manager_client.cache_clear()


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


def test_proxy_uses_in_memory_cache_when_no_table_name_configured():
    settings = _settings(
        api_sports_base_url="https://api-sports.example.com",
        api_sports_key="k",
        live_score_cache_table_name="",
    )

    proxy = get_live_score_proxy(settings)

    assert isinstance(proxy._cache, InMemoryLiveScoreCache)


# --- API-SPORTS key resolution from Secrets Manager (item 3) --------------
# When API_SPORTS_SECRET_ARN is set and API_SPORTS_KEY isn't, the ingestion
# Lambda's cold start reads the secret once via Secrets Manager -- never on
# every call. api_sports_base_url's own default (v1.basketball.api-sports.io)
# is covered by tests/test_settings.py, not repeated here.


@mock_aws
def test_resolves_api_sports_key_from_secrets_manager_when_env_key_unset():
    secrets_client = boto3.client("secretsmanager", region_name="us-east-1")
    secret = secrets_client.create_secret(Name="api-sports-key", SecretString="from-secrets-manager")
    settings = _settings(api_sports_key="", api_sports_secret_arn=secret["ARN"])

    proxy = get_live_score_proxy(settings)

    assert isinstance(proxy, CachedEventProxy)


@mock_aws
def test_env_api_sports_key_wins_over_secrets_manager_when_both_set():
    secrets_client = boto3.client("secretsmanager", region_name="us-east-1")
    secret = secrets_client.create_secret(Name="api-sports-key", SecretString="from-secrets-manager")
    settings = _settings(api_sports_key="from-env", api_sports_secret_arn=secret["ARN"])

    # Doesn't raise even though the secret is never read for this settings
    # combination -- proven by the next test's delete-after-first-read check.
    proxy = get_live_score_proxy(settings)

    assert isinstance(proxy, CachedEventProxy)


@mock_aws
def test_secrets_manager_value_is_cached_after_first_read():
    secrets_client = boto3.client("secretsmanager", region_name="us-east-1")
    secret = secrets_client.create_secret(Name="api-sports-key", SecretString="from-secrets-manager")
    settings = _settings(api_sports_key="", api_sports_secret_arn=secret["ARN"])

    get_live_score_proxy(settings)
    secrets_client.delete_secret(SecretId=secret["ARN"], ForceDeleteWithoutRecovery=True)

    # If this weren't cached, resolving the key again would call
    # Secrets Manager again and raise ResourceNotFoundException against the
    # now-deleted secret.
    second = get_live_score_proxy(settings)
    assert isinstance(second, CachedEventProxy)
