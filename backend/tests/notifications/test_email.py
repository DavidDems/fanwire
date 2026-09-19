"""Tests for app.notifications.email -- EmailSender interface and its test
double, per AGENTS.md TDD workflow. Written before app/notifications/
email.py exists.

See wiki/CodeContext/Modules/0x05-notifications.md "Security & privacy" /
"No new PII surface": EmailSender.send takes recipient_cognito_sub, never a
plaintext email address.
"""

from __future__ import annotations

from datetime import date

import boto3
import pytest
from moto import mock_aws
from testcontainers.postgres import PostgresContainer

from app.db import Base, make_engine, make_session_factory
from app.users.models import User


@pytest.fixture(scope="module")
def postgres_url():
    with PostgresContainer("postgres:16-alpine") as pg:
        yield pg.get_connection_url().replace("psycopg2", "psycopg")


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_recording_email_sender_records_calls_in_order(session_factory):
    from app.notifications.email import RecordingEmailSender
    from app.notifications.models import Notification, NotificationType

    with session_factory() as session:
        recipient = User(
            cognito_sub="sub-email-recipient",
            username="email_recipient",
            date_of_birth=date(1990, 1, 1),
        )
        actor = User(
            cognito_sub="sub-email-actor", username="email_actor", date_of_birth=date(1990, 1, 1)
        )
        session.add_all([recipient, actor])
        session.commit()

        notification = Notification(
            recipient_user_id=recipient.id,
            type=NotificationType.FOLLOW,
            actor_user_id=actor.id,
            reference_id=actor.id,
        )
        session.add(notification)
        session.commit()

        sender = RecordingEmailSender()
        sender.send(recipient_cognito_sub=recipient.cognito_sub, notification=notification)

        assert len(sender.sent) == 1
        assert sender.sent[0].recipient_cognito_sub == recipient.cognito_sub
        assert sender.sent[0].notification is notification


def test_recording_email_sender_never_touches_a_plaintext_email_field():
    from app.notifications.email import RecordingEmailSender

    sender = RecordingEmailSender()
    # send() has no email-address parameter at all -- calling with one is a
    # TypeError, not silently accepted.
    with pytest.raises(TypeError):
        sender.send(email="someone@example.com")  # type: ignore[call-arg]


# --- SesEmailSender (real adapter) -----------------------------------------
# Resolves the recipient's real email via Cognito AdminGetUser by `sub` at
# send time (EmailSender.send is never given a plaintext address), then
# sends via SES. infra/lib/auth-stack.ts's UserPool has `signInAliases:
# {email: true}` with no `usernameAttributes` override -- CDK's default for
# that combination auto-generates each user's Cognito Username as a random
# UUID that IS their `sub` (email is only an alias). moto's admin_get_user
# only matches a literal Username, not the sub-as-alias behavior real
# Cognito gives that pool shape -- so these tests create the moto user with
# Username=<the sub value> directly, which is exactly what happens in
# production for this pool configuration, not a workaround.


def _notification(session) -> Notification:  # noqa: F821 -- imported locally below
    from app.notifications.models import Notification, NotificationType

    recipient = User(
        cognito_sub="11111111-1111-1111-1111-111111111111",
        username="ses_recipient",
        date_of_birth=date(1990, 1, 1),
    )
    actor = User(cognito_sub="sub-ses-actor", username="ses_actor", date_of_birth=date(1990, 1, 1))
    session.add_all([recipient, actor])
    session.commit()

    notification = Notification(
        recipient_user_id=recipient.id,
        type=NotificationType.FOLLOW,
        actor_user_id=actor.id,
        reference_id=actor.id,
    )
    session.add(notification)
    session.commit()
    return notification, recipient


@pytest.fixture()
def cognito_pool_with_verified_user():
    with mock_aws():
        cognito = boto3.client("cognito-idp", region_name="us-east-1")
        pool_id = cognito.create_user_pool(PoolName="fanwire-test")["UserPool"]["Id"]
        sub = "11111111-1111-1111-1111-111111111111"
        cognito.admin_create_user(
            UserPoolId=pool_id,
            Username=sub,  # see module comment above -- Username IS the sub for this pool shape
            UserAttributes=[{"Name": "email", "Value": "recipient@example.com"}],
        )
        yield cognito, pool_id


def _sent_ses_messages():
    from moto.ses.models import ses_backends

    account_id = boto3.client("sts", region_name="us-east-1").get_caller_identity()["Account"]
    return ses_backends[account_id]["us-east-1"].sent_messages


def test_ses_email_sender_resolves_recipient_email_via_cognito_and_sends(
    session_factory, cognito_pool_with_verified_user
):
    from app.notifications.email import SesEmailSender

    cognito_client, pool_id = cognito_pool_with_verified_user
    ses_client = boto3.client("ses", region_name="us-east-1")
    ses_client.verify_email_identity(EmailAddress="notifications@fanwire.example")

    with session_factory() as session:
        notification, recipient = _notification(session)

        sender = SesEmailSender(
            cognito_client,
            ses_client,
            user_pool_id=pool_id,
            from_address="notifications@fanwire.example",
        )
        sender.send(recipient_cognito_sub=recipient.cognito_sub, notification=notification)

    sent = _sent_ses_messages()
    assert len(sent) == 1
    assert sent[0].source == "notifications@fanwire.example"
    assert sent[0].destinations["ToAddresses"] == ["recipient@example.com"]


def test_ses_email_sender_skips_sending_when_no_from_address_configured(
    session_factory, cognito_pool_with_verified_user
):
    from app.notifications.email import SesEmailSender

    cognito_client, pool_id = cognito_pool_with_verified_user
    ses_client = boto3.client("ses", region_name="us-east-1")

    with session_factory() as session:
        notification, recipient = _notification(session)

        # No NOTIFICATION_FROM_ADDRESS (empty) -- no SES identity exists yet
        # either, matching infra/lib/app-stack.ts's "no domain configured"
        # branch. Must not raise and must not call SES/Cognito at all.
        sender = SesEmailSender(cognito_client, ses_client, user_pool_id=pool_id, from_address="")
        sender.send(recipient_cognito_sub=recipient.cognito_sub, notification=notification)

    assert _sent_ses_messages() == []
