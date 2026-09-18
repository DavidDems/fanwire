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


class EventBridgePublishError(RuntimeError):
    """Raised by EventBridgePublisher.put_event when EventBridge reports
    FailedEntryCount > 0 -- PutEvents returns HTTP 200 even when an entry
    fails, so this is the fail-fast check per
    wiki/CodeContext/Standards/design-principles.md "Fail fast": a
    partially-failed publish must not look like a success to the caller."""


class EventBridgePublisher(EventPublisher):
    """Real production adapter: boto3 `events.put_events` against a fixed
    EventBridge bus. Takes an already-constructed boto3 client (Dependency
    Inversion — same "inject the client, don't construct it here" shape as
    app.events.adapters.ApiSportsAdapter taking an HttpClient), so this
    class never imports boto3 or resolves credentials/region itself; that's
    app.dependencies.get_event_bus's job.

    `event_bus_name` is PostEventBus's real EventBridge bus name
    (infra/lib/messaging-stack.ts's `postEventBus.eventBusName`, wired in via
    Settings.post_event_bus_name / POST_EVENT_BUS_NAME) -- distinct from the
    default account bus GuardDuty publishes scan results to.

    Source/DetailType come from the caller (PostEventBus.publish() passes
    PostEventBus.SOURCE == "fanwire" as `source`) -- this class never picks
    its own Source. messaging-stack.ts's NotificationRule filters only on
    `detailType` (["PostCreated", "UserFollowed"]), never on `source`, so
    that "fanwire" source string is already compatible with the rule as-is;
    no infra change was needed to accommodate this adapter.
    """

    def __init__(self, client: Any, *, event_bus_name: str) -> None:
        self._client = client
        self._event_bus_name = event_bus_name

    def put_event(self, *, source: str, detail_type: str, detail: str) -> None:
        response = self._client.put_events(
            Entries=[
                {
                    "Source": source,
                    "DetailType": detail_type,
                    "Detail": detail,
                    "EventBusName": self._event_bus_name,
                }
            ]
        )
        if response.get("FailedEntryCount", 0) > 0:
            raise EventBridgePublishError(
                f"EventBridge PutEvents reported FailedEntryCount="
                f"{response['FailedEntryCount']}: {response.get('Entries')}"
            )


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
