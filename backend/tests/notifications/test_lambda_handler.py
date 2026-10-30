"""Tests for app.notifications.lambda_handler.handler -- the notifications
Lambda, per AGENTS.md TDD workflow. Written before app/notifications/
lambda_handler.py exists.

Triggered by the notification SQS queue (batch size 10,
reportBatchItemFailures: true, infra/lib/app-stack.ts's
`NotificationTrigger`), fed by messaging-stack.ts's `NotificationRule`
(`detailType: ["PostCreated", "UserFollowed"]` on PostEventBus). Each
record's `body` is that EventBridge event JSON-encoded (fixtures:
tests/fixtures/notification_{post_created,user_followed}_sqs_event.json).
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import boto3
import pytest
from moto import mock_aws

import app.dependencies as app_dependencies
from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_settings
from app.notifications.models import Notification
from app.users.models import User

FIXTURES = Path(__file__).parent.parent / "fixtures"


def _load_fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture(autouse=True)
def _wire_env_and_caches(monkeypatch, postgres_url):
    monkeypatch.setenv("DATABASE_URL", postgres_url)
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("COGNITO_REGION", "us-east-1")
    monkeypatch.delenv("NOTIFICATION_FROM_ADDRESS", raising=False)
    monkeypatch.delenv("AWS_ENDPOINT_URL_DYNAMODB", raising=False)
    monkeypatch.delenv("AWS_ENDPOINT_URL", raising=False)
    get_settings.cache_clear()
    app_dependencies._get_session_factory.cache_clear()
    yield
    get_settings.cache_clear()
    app_dependencies._get_session_factory.cache_clear()


def _make_user(session, **overrides) -> User:
    defaults = {"username": "handler_user", "date_of_birth": date(1990, 1, 1)}
    defaults.update(overrides)
    defaults.setdefault("cognito_sub", f"sub-{defaults['username']}")
    user = User(**defaults)
    session.add(user)
    session.commit()
    return user


def test_user_followed_record_creates_a_notification_with_email_disabled(session_factory):
    # No NOTIFICATION_FROM_ADDRESS -- matches infra's current "no domain
    # configured" state. Must not raise even though no SES/Cognito mock is
    # set up at all; in-app notification creation must still happen.
    from app.notifications.lambda_handler import handler

    with session_factory() as session:
        follower = _make_user(session, username="handler_follower")
        followed = _make_user(session, username="handler_followed")

    event = _load_fixture("notification_user_followed_sqs_event.json")
    body = json.loads(event["Records"][0]["body"])
    body["detail"]["follower_user_id"] = follower.id
    body["detail"]["followed_user_id"] = followed.id
    event["Records"][0]["body"] = json.dumps(body)

    result = handler(event, None)

    assert result == {"batchItemFailures": []}
    with session_factory() as session:
        notification = session.query(Notification).filter_by(recipient_user_id=followed.id).one()
        assert notification.actor_user_id == follower.id


@mock_aws
def test_user_followed_record_sends_email_when_from_address_configured(
    session_factory, monkeypatch
):
    monkeypatch.setenv("NOTIFICATION_FROM_ADDRESS", "notifications@fanwire.example")
    get_settings.cache_clear()

    cognito = boto3.client("cognito-idp", region_name="us-east-1")
    pool_id = cognito.create_user_pool(PoolName="fanwire-test")["UserPool"]["Id"]
    monkeypatch.setenv("COGNITO_USER_POOL_ID", pool_id)
    get_settings.cache_clear()

    ses = boto3.client("ses", region_name="us-east-1")
    ses.verify_email_identity(EmailAddress="notifications@fanwire.example")

    with session_factory() as session:
        follower = _make_user(session, username="email_follower")
        followed = _make_user(session, username="email_followed")

    followed_sub = "22222222-2222-2222-2222-222222222222"
    with session_factory() as session:
        followed_row = session.get(User, followed.id)
        followed_row.cognito_sub = followed_sub
        session.commit()

    cognito.admin_create_user(
        UserPoolId=pool_id,
        Username=followed_sub,
        UserAttributes=[{"Name": "email", "Value": "followed@example.com"}],
    )

    from app.notifications.lambda_handler import handler

    event = _load_fixture("notification_user_followed_sqs_event.json")
    body = json.loads(event["Records"][0]["body"])
    body["detail"]["follower_user_id"] = follower.id
    body["detail"]["followed_user_id"] = followed.id
    event["Records"][0]["body"] = json.dumps(body)

    result = handler(event, None)

    assert result == {"batchItemFailures": []}
    from moto.ses.models import ses_backends

    account_id = boto3.client("sts", region_name="us-east-1").get_caller_identity()["Account"]
    sent = ses_backends[account_id]["us-east-1"].sent_messages
    assert len(sent) == 1
    assert sent[0].destinations["ToAddresses"] == ["followed@example.com"]


def test_post_created_plain_post_is_a_no_op(session_factory):
    # A plain post (neither reply nor repost) isn't notification-worthy --
    # handle_domain_event returns None, and the handler must not treat that
    # as a failure.
    from app.notifications.lambda_handler import handler
    from app.posts.models import Post

    with session_factory() as session:
        author = _make_user(session, username="plain_post_author")
        post = Post(author_id=author.id, text="just a post")
        session.add(post)
        session.commit()
        post_id = post.id

    event = _load_fixture("notification_post_created_sqs_event.json")
    body = json.loads(event["Records"][0]["body"])
    body["detail"]["post_id"] = post_id
    body["detail"]["author_id"] = author.id
    event["Records"][0]["body"] = json.dumps(body)

    result = handler(event, None)

    assert result == {"batchItemFailures": []}


def test_a_record_that_raises_is_reported_as_a_batch_item_failure(session_factory):
    # A PostCreated with no post_id key -- consumer._resolve_post_created
    # raises KeyError for it, before any row is committed -- must be caught
    # and reported per-record, not propagated and not silently swallowed for
    # the rest of the batch. (A post_id with no row is a no-op since POSTS-007,
    # see the tests below.)
    from app.notifications.lambda_handler import handler

    event = _load_fixture("notification_post_created_sqs_event.json")
    body = json.loads(event["Records"][0]["body"])
    del body["detail"]["post_id"]
    body["detail"]["author_id"] = 1
    event["Records"][0]["body"] = json.dumps(body)

    result = handler(event, None)

    assert result == {"batchItemFailures": [{"itemIdentifier": event["Records"][0]["messageId"]}]}


def _post_created_record(message_id: str, *, post_id: int, author_id: int) -> dict:
    record = _load_fixture("notification_post_created_sqs_event.json")["Records"][0]
    body = json.loads(record["body"])
    body["detail"]["post_id"] = post_id
    body["detail"]["author_id"] = author_id
    record["body"] = json.dumps(body)
    record["messageId"] = message_id
    return record


def _undone_and_valid_reposts(session_factory) -> dict:
    """A repost already undone (its row gone, the event still on its way) and
    another user's repost of the same post, still there."""
    from app.posts.models import Post
    from app.posts.service import unrepost_post

    with session_factory() as session:
        author = _make_user(session, username="undone_author")
        undoer = _make_user(session, username="undone_undoer")
        keeper = _make_user(session, username="undone_keeper")
        original = Post(author_id=author.id, text="worth sharing")
        session.add(original)
        session.commit()
        undone = Post(author_id=undoer.id, is_repost=True, original_post_id=original.id)
        kept = Post(author_id=keeper.id, is_repost=True, original_post_id=original.id)
        session.add_all([undone, kept])
        session.commit()
        undone_id = undone.id
        unrepost_post(session, user_id=undoer.id, post_id=original.id)
        assert session.get(Post, undone_id) is None
    return {
        "author_id": author.id,
        "undone": _post_created_record("undone", post_id=undone_id, author_id=undoer.id),
        "valid": _post_created_record("valid", post_id=kept.id, author_id=keeper.id),
        "kept_id": kept.id,
    }


def test_a_record_for_an_undone_repost_is_not_a_batch_item_failure(session_factory):
    from app.notifications.lambda_handler import handler

    world = _undone_and_valid_reposts(session_factory)

    result = handler({"Records": [world["undone"]]}, None)

    assert result == {"batchItemFailures": []}
    with session_factory() as session:
        assert session.query(Notification).count() == 0


@pytest.mark.parametrize("order", [("undone", "valid"), ("valid", "undone")])
def test_a_valid_record_beside_an_undone_repost_still_creates_its_notification(
    session_factory, order
):
    from app.notifications.lambda_handler import handler

    world = _undone_and_valid_reposts(session_factory)

    result = handler({"Records": [world[name] for name in order]}, None)

    assert result == {"batchItemFailures": []}
    with session_factory() as session:
        notification = session.query(Notification).one()
        assert notification.recipient_user_id == world["author_id"]
        assert notification.reference_id == world["kept_id"]


@mock_aws
def test_user_followed_record_is_not_a_batch_failure_when_ses_rejects_the_email(
    session_factory, monkeypatch
):
    # Production incident 2026-09-30: the SES identity was unverified, so
    # send_email raised MessageRejected, the record was reported in
    # batchItemFailures, SQS redelivered it, and each redelivery committed
    # another Notification row (duplicate follow notifications 2m56s apart).
    # Identical to the test above except the from-address is never verified,
    # so moto's SES rejects the send exactly as production did.
    monkeypatch.setenv("NOTIFICATION_FROM_ADDRESS", "notifications@fanwire.example")
    get_settings.cache_clear()

    cognito = boto3.client("cognito-idp", region_name="us-east-1")
    pool_id = cognito.create_user_pool(PoolName="fanwire-test")["UserPool"]["Id"]
    monkeypatch.setenv("COGNITO_USER_POOL_ID", pool_id)
    get_settings.cache_clear()

    with session_factory() as session:
        follower = _make_user(session, username="unverified_follower")
        followed = _make_user(session, username="unverified_followed")

    followed_sub = "33333333-3333-3333-3333-333333333333"
    with session_factory() as session:
        followed_row = session.get(User, followed.id)
        followed_row.cognito_sub = followed_sub
        session.commit()

    cognito.admin_create_user(
        UserPoolId=pool_id,
        Username=followed_sub,
        UserAttributes=[{"Name": "email", "Value": "followed@example.com"}],
    )

    from app.notifications.lambda_handler import handler

    event = _load_fixture("notification_user_followed_sqs_event.json")
    body = json.loads(event["Records"][0]["body"])
    body["detail"]["follower_user_id"] = follower.id
    body["detail"]["followed_user_id"] = followed.id
    event["Records"][0]["body"] = json.dumps(body)

    result = handler(event, None)

    assert result == {"batchItemFailures": []}
    with session_factory() as session:
        rows = session.query(Notification).filter_by(recipient_user_id=followed.id).all()
        assert len(rows) == 1
    from moto.ses.models import ses_backends

    account_id = boto3.client("sts", region_name="us-east-1").get_caller_identity()["Account"]
    assert ses_backends[account_id]["us-east-1"].sent_messages == []
