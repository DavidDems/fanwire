"""Tests for app.notifications.email -- EmailSender interface and its test
double, per AGENTS.md TDD workflow. Written before app/notifications/
email.py exists.

See wiki/CodeContext/Modules/0x05-notifications.md "Security & privacy" /
"No new PII surface": EmailSender.send takes recipient_cognito_sub, never a
plaintext email address.
"""

from __future__ import annotations

from datetime import date

import pytest
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
