"""ApiSportsAdapter — Adapter pattern (wiki/CodeContext/Standards/gof-patterns.md).

This is the ONLY place in events/ that ever sees API-SPORTS' raw vendor JSON.
Everywhere else in events/ — and everything reached through
app.events.factory.SportsProviderFactory — only ever sees
app.events.interfaces.NormalizedTeam / NormalizedGame.

--- IMPORTANT: illustrative vendor shape, not verified live ------------------
The parsing below (and backend/tests/fixtures/api_sports_sample.json) is an
invented sample response shape based on API-SPORTS' typical REST JSON
conventions (a top-level "response" array; nested "teams"/"scores"/"players"
objects for the basketball endpoints) — it has NOT been verified against a
real API-SPORTS response. Whoever wires the real ingestion Lambda in a later
phase MUST reconcile this adapter's field parsing (and its auth scheme, see
`__init__` below) against the actual API-SPORTS basketball endpoint
docs/response before going live. This includes fetch_live_score's guessed
endpoint shape (`/games?id=...`) and its `status.short` field, and
_to_normalized_game's `player_stats[*].position` field (guessed as
`player.position`) — same caveat, same reconciliation task.
-------------------------------------------------------------------------------
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Protocol

from app.events.interfaces import (
    NormalizedGame,
    NormalizedLiveScore,
    NormalizedTeam,
    SportsDataSource,
)


class HttpClient(Protocol):
    """Structural interface for the HTTP client ApiSportsAdapter is given —
    satisfied by httpx.Client in production, a fake/stub in tests. Dependency
    Inversion (wiki/CodeContext/Standards/design-principles.md): this module
    depends on this narrow shape, never hard-imports httpx, so the concrete
    HTTP library is swappable without touching events/."""

    def get(self, url: str, params: dict[str, Any] | None = None) -> Any: ...


def _normalize_season(vendor_season: str) -> str:
    """Convert the adapter's illustrative vendor season shape ("2025-2026")
    into the stored "YYYY-YY" text format settled in
    wiki/CodeContext/Modules/0x02-events.md."""
    start, end = vendor_season.split("-")
    return f"{start}-{end[-2:]}"


class ApiSportsAdapter(SportsDataSource):
    """Implements SportsDataSource against API-SPORTS. `base_url` and
    `api_key` are injected constructor args, not hardcoded — the key is a
    secret injected at runtime, per wiki/CodeContext/Standards/aws-stack.md
    "Sports data ingestion" and the security baseline in
    wiki/CodeContext/Standards/design-principles.md."""

    def __init__(self, http_client: HttpClient, *, base_url: str, api_key: str) -> None:
        self._http_client = http_client
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key

    def fetch_teams(self) -> list[NormalizedTeam]:
        response = self._http_client.get(f"{self._base_url}/teams", params=self._auth_params())
        payload = response.json()
        return [self._to_normalized_team(item) for item in payload["response"]]

    def fetch_games(self, *, since: datetime | None = None) -> list[NormalizedGame]:
        params = self._auth_params()
        if since is not None:
            params["date"] = since.date().isoformat()
        response = self._http_client.get(f"{self._base_url}/games", params=params)
        payload = response.json()
        return [self._to_normalized_game(item) for item in payload["response"]]

    def fetch_live_score(self, api_sports_game_id: int) -> NormalizedLiveScore | None:
        # Illustrative/unverified endpoint shape, same caveat as the rest of
        # this file (see module docstring): guessed as the same `/games`
        # endpoint fetch_games uses, filtered by an `id` query param, per
        # API-SPORTS' typical REST conventions of scoping a collection
        # endpoint down to one resource via a query param rather than a
        # distinct path. Not verified against real API-SPORTS docs.
        params = self._auth_params()
        params["id"] = api_sports_game_id
        response = self._http_client.get(f"{self._base_url}/games", params=params)
        payload = response.json()
        items = payload["response"]
        if not items:
            return None
        return self._to_normalized_live_score(items[0])

    def _auth_params(self) -> dict[str, Any]:
        # The injected HttpClient interface is deliberately narrow
        # (get(url, params=None), no headers kwarg) so any HTTP library
        # satisfies it structurally — the API key travels as a query param
        # here as a result. Real API-SPORTS auth is header-based
        # (`x-apisports-key`); reconcile this against the real docs when
        # wiring the production ingestion Lambda (see module docstring).
        return {"key": self._api_key}

    @staticmethod
    def _to_normalized_team(item: dict[str, Any]) -> NormalizedTeam:
        standard = item["leagues"]["standard"]
        return NormalizedTeam(
            api_sports_team_id=item["id"],
            name=item["name"],
            abbreviation=item["code"],
            conference=standard["conference"],
            division=standard["division"],
            logo_url=item.get("logo"),
        )

    @staticmethod
    def _to_normalized_game(item: dict[str, Any]) -> NormalizedGame:
        player_stats = [
            {
                "player_name": stat["player"]["name"],
                "team_id": stat["team"]["id"],
                "points": stat["points"],
                "rebounds": stat["totReb"],
                "assists": stat["assists"],
                # Guessed vendor field name (illustrative, unverified — see
                # module docstring), resolving wiki/CodeContext/Modules/
                # 0x07-search.md's previously open "position field name"
                # question as "position".
                "position": stat["player"].get("position"),
            }
            for stat in item["players"]["statistics"]
        ]
        return NormalizedGame(
            api_sports_game_id=item["id"],
            home_team_id=item["teams"]["home"]["id"],
            away_team_id=item["teams"]["away"]["id"],
            date=datetime.fromisoformat(item["date"]),
            season=_normalize_season(item["league"]["season"]),
            home_score=item["scores"]["home"]["total"],
            away_score=item["scores"]["away"]["total"],
            venue=item.get("arena", {}).get("name"),
            player_stats=player_stats,
        )

    @staticmethod
    def _to_normalized_live_score(item: dict[str, Any]) -> NormalizedLiveScore:
        # `status.short` is a guessed vendor field name (illustrative, same
        # unverified-vendor-shape caveat as the rest of this file) — reconcile
        # against real API-SPORTS docs before going live, same as
        # _to_normalized_game/_normalize_season above.
        return NormalizedLiveScore(
            api_sports_game_id=item["id"],
            home_score=item["scores"]["home"]["total"],
            away_score=item["scores"]["away"]["total"],
            status=item["status"]["short"],
        )
