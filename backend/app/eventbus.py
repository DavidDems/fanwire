"""PostEventBus — the app's one domain event bus (Observer, per
wiki/CodeContext/Standards/gof-patterns.md "Observer").

Lives at the top level (not inside app/posts/), because it's genuinely
cross-cutting despite the name: per wiki/CodeContext/Modules/
0x00-architecture.md "Connection rule" / "Cross-cutting conventions",
users/ publishes UserFollowed onto the same bus that posts/ publishes
PostCreated/PostMentionedEvent/PostReported onto. Living inside app/posts/
would force users/ to reach into posts/'s package to use it, which the
connection rule doesn't sanction — same reasoning as Phase 2a's
app.dependencies (see that architecture doc's "Cross-cutting FastAPI DI").

This module imports nothing from app.events/app.users/app.media/app.posts —
pure infrastructure.

PostEventBus itself does not own a fixed list of valid event names —
callers (posts/'s facade, users/'s service) each define their own
event-name string constant near their own publish() call site (e.g.
POST_CREATED = "PostCreated" lives in app.posts.facade, not here):
single-owner-per-event-name, not a shared enum this module would have to
know about every module's events to maintain.
"""

from __future__ import annotations

import abc
import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, ClassVar


@dataclass(frozen=True)
class DomainEvent:
    """One published event, as recorded by a test double. `detail` is the
    already-JSON-decoded dict (including the `published_at` key
    PostEventBus.publish() adds)."""

    name: str
    detail: dict[str, Any] = field(default_factory=dict)


class EventPublisher(abc.ABC):
    """Narrow injected interface (Dependency Inversion, same shape as
    app.media.pipeline.MalwareScanner / app.users.auth.TokenVerifier) —
    PostEventBus depends on this, never a concrete boto3 EventBridge
    client.

    No real EventBridgePublisher adapter exists yet (no live AWS this
    phase, same precedent as MalwareScanner/GuardDutyMalwareScanner —
    future work)."""

    @abc.abstractmethod
    def put_event(self, *, source: str, detail_type: str, detail: str) -> None:
        """`detail` is already-JSON-encoded text, matching EventBridge's
        PutEvents API shape."""


class InMemoryEventPublisher(EventPublisher):
    """Test double: records every published event in arrival order as a
    DomainEvent, never touches AWS."""

    def __init__(self) -> None:
        self.published: list[DomainEvent] = []

    def put_event(self, *, source: str, detail_type: str, detail: str) -> None:
        self.published.append(DomainEvent(name=detail_type, detail=json.loads(detail)))


class PostEventBus:
    """The app's one domain event bus. Wraps the given detail dict with a
    `published_at` ISO-8601 UTC timestamp, JSON-encodes it, and forwards to
    the injected EventPublisher.put_event()."""

    SOURCE: ClassVar[str] = "fanwire"

    def __init__(self, publisher: EventPublisher) -> None:
        self._publisher = publisher

    def publish(self, event_name: str, detail: dict[str, Any]) -> None:
        enriched = {**detail, "published_at": datetime.now(UTC).isoformat()}
        self._publisher.put_event(
            source=self.SOURCE,
            detail_type=event_name,
            detail=json.dumps(enriched),
        )
