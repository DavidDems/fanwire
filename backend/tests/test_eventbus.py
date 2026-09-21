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

import boto3
import pytest
from moto import mock_aws

from app.eventbus import (
    DomainEvent,
    EventBridgePublisher,
    EventBridgePublishError,
    InMemoryEventPublisher,
    PostEventBus,
)


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


# --- EventBridgePublisher (real EventBridge PutEvents adapter) ------------
# wiki/CodeContext/Modules/0x00-architecture.md "PostEventBus implementation":
# the real adapter behind app.dependencies.get_event_bus() once
# POST_EVENT_BUS_NAME is set. messaging-stack.ts's NotificationRule filters
# only on detailType (["PostCreated", "UserFollowed"]), never on source, so
# any Source string PostEventBus.publish() passes through (currently
# PostEventBus.SOURCE == "fanwire") already matches the rule -- confirmed
# here rather than changed.


@mock_aws
def test_event_bridge_publisher_calls_put_events_on_the_named_bus():
    client = boto3.client("events", region_name="us-east-1")
    client.create_event_bus(Name="PostEventBus")
    publisher = EventBridgePublisher(client, event_bus_name="PostEventBus")

    publisher.put_event(source="fanwire", detail_type="PostCreated", detail='{"post_id": 1}')

    # No real way to read PutEvents entries back out of moto's EventBridge
    # without a rule+queue attached — the absence of a raised exception plus
    # the FailedEntryCount fail-fast test below is the coverage available
    # through moto for this adapter; see that test's own comment.


@mock_aws
def test_event_bridge_publisher_targets_the_configured_event_bus_name_not_default():
    # Publishing to a bus that doesn't exist raises — proves EventBusName is
    # actually threaded through to put_events, not silently defaulted.
    client = boto3.client("events", region_name="us-east-1")
    publisher = EventBridgePublisher(client, event_bus_name="DoesNotExist")

    with pytest.raises(client.exceptions.ResourceNotFoundException):
        publisher.put_event(source="fanwire", detail_type="PostCreated", detail="{}")


def test_event_bridge_publisher_fails_fast_on_failed_entry_count():
    # moto's PutEvents doesn't model partial per-entry failure (a bad entry
    # raises a whole-call exception instead, see the test above) — real
    # EventBridge instead returns HTTP 200 with FailedEntryCount > 0 and a
    # per-entry error code/message, which put_events() must still fail fast
    # on. Exercised via an injected stub client, not moto, per the "test
    # through an injected stub client instead of skipping" allowance for
    # AWS response shapes moto can't produce.
    class _StubClient:
        def put_events(self, **kwargs):
            return {
                "FailedEntryCount": 1,
                "Entries": [{"ErrorCode": "InternalFailure", "ErrorMessage": "boom"}],
            }

    publisher = EventBridgePublisher(_StubClient(), event_bus_name="PostEventBus")

    with pytest.raises(EventBridgePublishError):
        publisher.put_event(source="fanwire", detail_type="PostCreated", detail="{}")
