"""Tests for SportsProviderFactory (Abstract Factory), per AGENTS.md TDD
workflow. Written before app/events/factory.py exists.
"""

from typing import Any

from app.events.adapters import ApiSportsAdapter
from app.events.factory import SportsProviderFactory
from app.events.interfaces import SportsDataSource


class _FakeHttpClient:
    def get(self, url: str, params: dict[str, Any] | None = None) -> Any:
        raise AssertionError("not called in this test")


def test_create_adapter_returns_a_sports_data_source():
    client = _FakeHttpClient()

    adapter = SportsProviderFactory.create_adapter(
        client, base_url="https://example.invalid/v1", api_key="test-key"
    )

    assert isinstance(adapter, SportsDataSource)


def test_create_adapter_returns_api_sports_adapter():
    client = _FakeHttpClient()

    adapter = SportsProviderFactory.create_adapter(
        client, base_url="https://example.invalid/v1", api_key="test-key"
    )

    assert isinstance(adapter, ApiSportsAdapter)
