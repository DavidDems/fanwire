"""Vendor-agnostic, already-normalized data shapes plus the one typed
interface events/ ingestion depends on.

See wiki/CodeContext/Modules/0x00-architecture.md "Connection rule" (typed
interfaces are the only cross-module contact point) and
wiki/CodeContext/Standards/gof-patterns.md (Adapter). Nothing in events/
outside app.events.adapters ever sees raw vendor JSON — only these
dataclasses.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(frozen=True)
class NormalizedTeam:
    """Fields mirror app.events.models.Team, minus the internal `id`."""

    api_sports_team_id: int
    name: str
    abbreviation: str
    conference: str
    division: str
    logo_url: str | None = None


@dataclass(frozen=True)
class NormalizedGame:
    """Fields mirror app.events.models.Game, minus the internal `id`.

    `home_team_id`, `away_team_id`, and each `player_stats` entry's
    `team_id` are the *vendor's* `api_sports_team_id` at this stage, not the
    internal `Team.id` — a SportsDataSource only ever sees vendor team
    identifiers. app.events.ingestion resolves them against the
    already-seeded `teams` table and fails fast on an unrecognized team, per
    wiki/CodeContext/Modules/0x00-architecture.md "Data seeding order". Only
    the resolved internal ids are ever persisted to `Game`.
    """

    api_sports_game_id: int
    home_team_id: int
    away_team_id: int
    date: datetime
    season: str
    home_score: int
    away_score: int
    venue: str | None
    player_stats: list[dict[str, Any]] = field(default_factory=list)


class SportsDataSource(abc.ABC):
    """The one typed interface events/ ingestion depends on — see
    wiki/CodeContext/Modules/0x00-architecture.md "Connection rule" and
    wiki/CodeContext/Standards/gof-patterns.md (Adapter). Concrete vendor
    adapters (e.g. ApiSportsAdapter) implement this; callers depend on this
    interface (and app.events.factory.SportsProviderFactory, which produces
    it), never on a concrete adapter class."""

    @abc.abstractmethod
    def fetch_teams(self) -> list[NormalizedTeam]:
        """Return all known teams, normalized."""

    @abc.abstractmethod
    def fetch_games(self, *, since: datetime | None = None) -> list[NormalizedGame]:
        """Return games (with embedded box scores), normalized. `since`
        narrows to games on/after that date when supported by the vendor."""
