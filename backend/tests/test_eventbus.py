"""Tests for app.eventbus — the app's one domain event bus (Observer, per
wiki/CodeContext/Standards/gof-patterns.md), per AGENTS.md TDD workflow.
Written before app/eventbus.py exists.

See wiki/CodeContext/Modules/0x00-architecture.md "Connection rule" /
"Cross-cutting conventions": PostEventBus is genuinely cross-cutting, not
posts/-exclusive despite the name — users/ publishes UserFollowed onto the
same bus.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from app.eventbus import DomainEvent, InMemoryEventPublisher, PostEventBus


def test_publish_forwards_source_detail_type_and_json_decodable_detail():
    publisher = InMemoryEventPublisher()
    bus = PostEventBus(publisher)

    bus.publish("PostCreated", {"post_id": 1})

    assert len(publisher.published) == 1
    event = publisher.published[0]
    assert event.name == "PostCreated"
    assert event.detail["post_id"] == 1


def test_publish_includes_published_at_timestamp_in_detail():
    publisher = InMemoryEventPublisher()
    bus = PostEventBus(publisher)

    before = datetime.now(UTC)
    bus.publish("PostCreated", {"post_id": 1})
    after = datetime.now(UTC)

    event = publisher.published[0]
    assert "published_at" in event.detail
    published_at = datetime.fromisoformat(event.detail["published_at"])
    assert before <= published_at <= after


def test_publish_uses_fanwire_source():
    calls = []

    class RecordingPublisher:
        def put_event(self, *, source, detail_type, detail):
            calls.append({"source": source, "detail_type": detail_type, "detail": detail})

    bus = PostEventBus(RecordingPublisher())
    bus.publish("UserFollowed", {"follower_id": 1, "followed_id": 2})

    assert len(calls) == 1
    call = calls[0]
    assert call["source"] == "fanwire" == PostEventBus.SOURCE
    assert call["detail_type"] == "UserFollowed"
    # detail is JSON-encoded text, per put_event's narrow interface contract
    decoded = json.loads(call["detail"])
    assert decoded["follower_id"] == 1
    assert decoded["followed_id"] == 2
    assert "published_at" in decoded


def test_in_memory_event_publisher_records_multiple_events_in_arrival_order():
    publisher = InMemoryEventPublisher()
    bus = PostEventBus(publisher)

    bus.publish("PostCreated", {"post_id": 1})
    bus.publish("PostMentionedEvent", {"post_id": 1, "game_id": 5})
    bus.publish("UserFollowed", {"follower_id": 2, "followed_id": 3})

    assert [event.name for event in publisher.published] == [
        "PostCreated",
        "PostMentionedEvent",
        "UserFollowed",
    ]
    assert isinstance(publisher.published[0], DomainEvent)
