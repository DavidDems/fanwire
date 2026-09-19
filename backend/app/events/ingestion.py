"""AbstractEventIngestionPipeline / FinalScoreIngestion — Template Method
(wiki/CodeContext/Standards/gof-patterns.md). Full pipeline shape/rationale:
wiki/CodeContext/Modules/0x00-architecture.md "Ingestion & processing
pipelines".
"""

from __future__ import annotations

import abc
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.events.interfaces import NormalizedGame, SportsDataSource
from app.events.models import Game, Team


class UnrecognizedTeamError(ValueError):
    """Raised when a Game payload references a team_id (top-level or inside
    player_stats) that isn't already seeded in Team. Fail fast, per
    wiki/CodeContext/Modules/0x00-architecture.md "Data seeding order" and
    wiki/CodeContext/Standards/design-principles.md "Fail fast" — never
    silently auto-create the Team row."""


class AbstractEventIngestionPipeline(abc.ABC):
    """Fixes the ingestion skeleton; subclasses implement each step. See
    wiki/CodeContext/Standards/gof-patterns.md's Template Method entry."""

    def run(self) -> None:
        raw_events = self.fetch_raw_events()
        normalized = self.normalize(raw_events)
        deduped = self.dedupe(normalized)
        matched = self.match_to_mentions(deduped)
        self.publish(matched)

    @abc.abstractmethod
    def fetch_raw_events(self) -> Any: ...

    @abc.abstractmethod
    def normalize(self, raw_events: Any) -> Any: ...

    @abc.abstractmethod
    def dedupe(self, normalized_events: Any) -> Any: ...

    @abc.abstractmethod
    def match_to_mentions(self, deduped_events: Any) -> Any: ...

    @abc.abstractmethod
    def publish(self, matched_events: Any) -> None: ...


class FinalScoreIngestion(AbstractEventIngestionPipeline):
    """Ingests final game results from a SportsDataSource into Game rows.

    Dedupe (judgment call, see this method's own docstring): a hand-rolled
    conditional get/put against DynamoDB, not aws-lambda-powertools'
    Idempotency utility. That utility's `idempotent_function` decorator is
    designed for exactly this "wrap a per-item step inside a batch/loop"
    shape and its DynamoDBPersistenceLayer's *defaults*
    (key_attr="id", expiry_attr="expiration") are exactly the settled
    schema below -- deliberately picked to match it even though the
    decorator itself isn't used, so the table stays powertools-compatible
    if a future change adopts it. It wasn't adopted now because: (1) its
    idempotency key is derived by hashing the JSON-serialized payload
    argument, and NormalizedGame is a frozen dataclass with a `datetime`
    field -- not JSON-serializable without a conversion step the utility
    doesn't take a hook for; (2) UnrecognizedTeamError needs to fail fast
    *without* ever recording the item as processed (a bare exception from
    inside an `idempotent_function`-wrapped call already achieves this --
    powertools does not persist a completed record on an unhandled
    exception -- but reasoning about that interaction on top of (1)'s
    serialization workaround outweighed the benefit here); (3) the existing
    Template Method dedupe() step already reads once/writes once per game,
    which is what the utility would give this call site anyway. See
    wiki/CodeContext/Modules/0x02-events.md for this decision.
    """

    # Judgment call: 24h dedupe window. Postgres's own unique constraint on
    # Game.api_sports_game_id (app.events.models) is the real permanent
    # duplicate backstop -- this table only needs to survive the retry/DLQ
    # window (infra/lib/messaging-stack.ts's ingestion-retry queue keeps
    # messages up to 14 days, but Lambda's own destination retries exhaust
    # in minutes), not dedupe forever. A short TTL also keeps the table from
    # growing without bound as more seasons of games are ingested.
    IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60

    def __init__(
        self,
        source: SportsDataSource,
        session: Session,
        dynamodb_client: Any,
        *,
        idempotency_table_name: str,
    ) -> None:
        self._source = source
        self._session = session
        self._dynamodb_client = dynamodb_client
        self._idempotency_table_name = idempotency_table_name

    def fetch_raw_events(self) -> list[NormalizedGame]:
        return self._source.fetch_games()

    def normalize(self, raw_events: list[NormalizedGame]) -> list[NormalizedGame]:
        # The source already returns NormalizedGame objects, so this step is
        # a pass-through — kept present (not collapsed into
        # fetch_raw_events) to preserve the Template Method contract.
        return raw_events

    def dedupe(self, normalized_events: list[NormalizedGame]) -> list[Game]:
        """Skip games already recorded in the DynamoDB idempotency table;
        for the rest, fail fast on any unrecognized team_id (top-level or
        inside player_stats), then persist the new Game row. Persistence
        happens here (not in match_to_mentions/publish, which are no-ops
        until posts/ exists in Phase 2) since this is already the step
        touching each row for the dedupe/team-validation check."""
        persisted: list[Game] = []
        for game in normalized_events:
            event_id = str(game.api_sports_game_id)
            existing = self._dynamodb_client.get_item(
                TableName=self._idempotency_table_name,
                Key={"id": {"S": event_id}},
            )
            if "Item" in existing:
                continue

            home_team = self._resolve_team(game.home_team_id)
            away_team = self._resolve_team(game.away_team_id)
            resolved_player_stats = [
                {**stat, "team_id": self._resolve_team(stat["team_id"]).id}
                for stat in game.player_stats
            ]

            game_row = Game(
                api_sports_game_id=game.api_sports_game_id,
                home_team_id=home_team.id,
                away_team_id=away_team.id,
                date=game.date,
                season=game.season,
                home_score=game.home_score,
                away_score=game.away_score,
                venue=game.venue,
                player_stats=resolved_player_stats,
            )
            self._session.add(game_row)
            self._session.flush()

            expiration = int(datetime.now(UTC).timestamp()) + self.IDEMPOTENCY_TTL_SECONDS
            self._dynamodb_client.put_item(
                TableName=self._idempotency_table_name,
                Item={"id": {"S": event_id}, "expiration": {"N": str(expiration)}},
            )
            persisted.append(game_row)

        self._session.commit()
        return persisted

    def _resolve_team(self, api_sports_team_id: int) -> Team:
        team = self._session.execute(
            select(Team).where(Team.api_sports_team_id == api_sports_team_id)
        ).scalar_one_or_none()
        if team is None:
            raise UnrecognizedTeamError(
                f"No Team seeded for api_sports_team_id={api_sports_team_id!r} — "
                "Team must be seeded before Game import, see "
                "wiki/CodeContext/Modules/0x00-architecture.md 'Data seeding order'."
            )
        return team

    def match_to_mentions(self, deduped_events: Any) -> None:
        # Intentional no-op until Phase 2 wires posts/ (which owns
        # EventMention and resolves post mentions against events/) and
        # PostEventBus. See wiki/CodeContext/Modules/0x00-architecture.md
        # "Ingestion & processing pipelines". Implemented (not raised) so
        # fetch -> normalize -> dedupe can be exercised in isolation this
        # phase, per the Template Method contract requiring every concrete
        # subclass to implement every step.
        pass

    def publish(self, matched_events: Any) -> None:
        # Intentional no-op until Phase 2 wires PostEventBus (posts/ owns
        # publishing domain events onto it). See wiki/CodeContext/Modules/
        # 0x00-architecture.md "Ingestion & processing pipelines".
        pass
