"""SportsProviderFactory — Abstract Factory
(wiki/CodeContext/Standards/gof-patterns.md).

Single-provider (API-SPORTS) for now, per
wiki/CodeContext/Modules/0x02-events.md's GoF tie-in and the
"single-provider until proven insufficient" YAGNI decision
(wiki/CodeContext/Standards/design-principles.md). Callers depend on this
factory plus app.events.interfaces.SportsDataSource, never on
ApiSportsAdapter directly — swapping vendor families later means adding a
second `create_*` method here, not touching any caller.
"""

from __future__ import annotations

from app.events.adapters import ApiSportsAdapter, HttpClient
from app.events.interfaces import SportsDataSource


class SportsProviderFactory:
    """Produces the API-SPORTS adapter family."""

    @staticmethod
    def create_adapter(http_client: HttpClient, *, base_url: str, api_key: str) -> SportsDataSource:
        return ApiSportsAdapter(http_client, base_url=base_url, api_key=api_key)
