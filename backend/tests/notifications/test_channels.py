"""Tests for app.notifications.channels -- NotificationChannel (Factory
Method product interface), EmailNotificationChannel, InAppNotificationChannel,
and NotificationFactory, per AGENTS.md TDD workflow. Written before
app/notifications/channels.py exists.

See wiki/CodeContext/Standards/gof-patterns.md "Factory Method" and
wiki/CodeContext/Modules/0x05-notifications.md's GoF tie-in and naming
note: the abstract interface is named NotificationChannel here, not the
wiki's literal `Notification` (that name is already the ORM model class).
"""

from __future__ import annotations

from datetime import date

import pytest

from app.db import Base, make_engine, make_session_factory
from app.users.models import User


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


def _make_notification_and_recipient(session):
    from app.notifications.models import Notification, NotificationType

    recipient = User(
        cognito_sub="sub-chan-recipient", username="chan_recipient", date_of_birth=date(1990, 1, 1)
    )
    actor = User(
        cognito_sub="sub-chan-actor", username="chan_actor", date_of_birth=date(1990, 1, 1)
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
    return notification, recipient


def test_notification_factory_creates_in_app_channel(session_factory):
    from app.notifications.channels import (
        InAppNotificationChannel,
        NotificationChannel,
        NotificationFactory,
    )
    from app.notifications.email import RecordingEmailSender

    factory = NotificationFactory(RecordingEmailSender())
    channel = factory.create("in_app")

    assert isinstance(channel, InAppNotificationChannel)
    assert isinstance(channel, NotificationChannel)


def test_notification_factory_creates_email_channel(session_factory):
    from app.notifications.channels import (
        EmailNotificationChannel,
        NotificationChannel,
        NotificationFactory,
    )
    from app.notifications.email import RecordingEmailSender

    factory = NotificationFactory(RecordingEmailSender())
    channel = factory.create("email")

    assert isinstance(channel, EmailNotificationChannel)
    assert isinstance(channel, NotificationChannel)


def test_notification_factory_raises_on_unknown_channel():
    from app.notifications.channels import NotificationFactory, UnknownNotificationChannelError
    from app.notifications.email import RecordingEmailSender

    factory = NotificationFactory(RecordingEmailSender())

    with pytest.raises(UnknownNotificationChannelError):
        factory.create("push")


def test_in_app_channel_deliver_is_a_no_op(session_factory):
    from app.notifications.channels import NotificationFactory
    from app.notifications.email import RecordingEmailSender

    with session_factory() as session:
        notification, recipient = _make_notification_and_recipient(session)

        sender = RecordingEmailSender()
        factory = NotificationFactory(sender)
        result = factory.create("in_app").deliver(session, notification, recipient=recipient)

        assert result is None
        assert sender.sent == []


def test_email_channel_deliver_calls_sender_with_cognito_sub_not_email(session_factory):
    from app.notifications.channels import NotificationFactory
    from app.notifications.email import RecordingEmailSender

    with session_factory() as session:
        notification, recipient = _make_notification_and_recipient(session)

        sender = RecordingEmailSender()
        factory = NotificationFactory(sender)
        factory.create("email").deliver(session, notification, recipient=recipient)

        assert len(sender.sent) == 1
        assert sender.sent[0].recipient_cognito_sub == recipient.cognito_sub
        assert sender.sent[0].notification is notification
