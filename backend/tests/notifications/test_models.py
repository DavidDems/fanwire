"""Round-trip tests for the notifications/ models against a real Postgres,
per AGENTS.md TDD workflow. Written before app/notifications/models.py
exists.

See wiki/CodeContext/Modules/0x05-notifications.md for the
Notification/NotificationPreference schema.
"""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
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


def _make_user(**overrides) -> User:
    defaults = {
        "cognito_sub": "sub-notif-1",
        "username": "notif_user_1",
        "date_of_birth": date(1990, 1, 1),
    }
    defaults.update(overrides)
    return User(**defaults)


def test_notification_round_trip_defaults_cleared_at_null(session_factory):
    from app.notifications.models import Notification, NotificationType

    with session_factory() as session:
        recipient = _make_user(cognito_sub="sub-recipient", username="recipient")
        actor = _make_user(cognito_sub="sub-actor", username="actor")
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

        fetched = session.scalar(
            select(Notification).where(Notification.id == notification.id)
        )
        assert fetched is not None
        assert fetched.recipient_user_id == recipient.id
        assert fetched.type == NotificationType.FOLLOW
        assert fetched.actor_user_id == actor.id
        assert fetched.reference_id == actor.id
        assert fetched.cleared_at is None
        assert fetched.created_at is not None


def test_notification_type_accepts_reply_and_repost(session_factory):
    from app.notifications.models import Notification, NotificationType

    with session_factory() as session:
        recipient = _make_user(cognito_sub="sub-recipient-2", username="recipient_two")
        actor = _make_user(cognito_sub="sub-actor-2", username="actor_two")
        session.add_all([recipient, actor])
        session.commit()

        reply = Notification(
            recipient_user_id=recipient.id,
            type=NotificationType.REPLY,
            actor_user_id=actor.id,
            reference_id=42,
        )
        repost = Notification(
            recipient_user_id=recipient.id,
            type=NotificationType.REPOST,
            actor_user_id=actor.id,
            reference_id=43,
        )
        session.add_all([reply, repost])
        session.commit()

        types = {
            n.reference_id: n.type
            for n in session.scalars(
                select(Notification).where(Notification.recipient_user_id == recipient.id)
            ).all()
        }
        assert types[42] == NotificationType.REPLY
        assert types[43] == NotificationType.REPOST


def test_notification_recipient_user_id_requires_existing_user(session_factory):
    from app.notifications.models import Notification, NotificationType

    with session_factory() as session:
        actor = _make_user(cognito_sub="sub-actor-3", username="actor_three")
        session.add(actor)
        session.commit()

        session.add(
            Notification(
                recipient_user_id=999_999,
                type=NotificationType.FOLLOW,
                actor_user_id=actor.id,
                reference_id=actor.id,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_notification_preference_round_trip_and_default(session_factory):
    from app.notifications.models import NotificationPreference

    with session_factory() as session:
        user = _make_user(cognito_sub="sub-pref", username="pref_user")
        session.add(user)
        session.commit()

        preference = NotificationPreference(user_id=user.id)
        session.add(preference)
        session.commit()
        session.refresh(preference)

        assert preference.email_notifications_enabled is True


def test_notification_preference_can_disable_email(session_factory):
    from app.notifications.models import NotificationPreference

    with session_factory() as session:
        user = _make_user(cognito_sub="sub-pref-2", username="pref_user_2")
        session.add(user)
        session.commit()

        preference = NotificationPreference(user_id=user.id, email_notifications_enabled=False)
        session.add(preference)
        session.commit()

        fetched = session.get(NotificationPreference, user.id)
        assert fetched.email_notifications_enabled is False
