"""Tests for notifications/ HTTP routes, per AGENTS.md TDD workflow.
Written before app/notifications/routes.py and app/notifications/schemas.py
exist.

Router isn't wired into app.main yet in this test -- a throwaway local
FastAPI() app includes just the notifications router, same pattern as
backend/tests/posts/test_routes.py. Overrides get_current_user/get_session.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from testcontainers.postgres import PostgresContainer

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_session
from app.notifications.models import Notification, NotificationPreference, NotificationType
from app.notifications.routes import router
from app.users.dependencies import get_current_user
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


@pytest.fixture()
def app(session_factory):
    app = FastAPI()
    app.include_router(router)

    def _get_session_override():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = _get_session_override
    return app


@pytest.fixture()
def client(app):
    return TestClient(app)


def _make_user(session, **overrides) -> User:
    defaults = {
        "cognito_sub": f"sub-notifroutes-{overrides.get('username', 'u')}",
        "username": "notifroutes_user",
        "date_of_birth": date(1990, 1, 1),
    }
    defaults.update(overrides)
    user = User(**defaults)
    session.add(user)
    session.commit()
    return user


def _as_user(app, user: User) -> None:
    app.dependency_overrides[get_current_user] = lambda: user


# --- GET /notifications -------------------------------------------------------


def test_list_notifications_returns_only_own_active_notifications_most_recent_first(
    app, client, session_factory
):
    with session_factory() as session:
        me = _make_user(session, cognito_sub="sub-list-me", username="list_me")
        other_recipient = _make_user(
            session, cognito_sub="sub-list-other", username="list_other"
        )
        actor = _make_user(session, cognito_sub="sub-list-actor", username="list_actor")

        base = datetime(2026, 1, 1, tzinfo=UTC)
        older = Notification(
            recipient_user_id=me.id,
            type=NotificationType.FOLLOW,
            actor_user_id=actor.id,
            reference_id=actor.id,
            created_at=base,
        )
        newer = Notification(
            recipient_user_id=me.id,
            type=NotificationType.REPLY,
            actor_user_id=actor.id,
            reference_id=999,
            created_at=base + timedelta(minutes=5),
        )
        cleared = Notification(
            recipient_user_id=me.id,
            type=NotificationType.REPOST,
            actor_user_id=actor.id,
            reference_id=998,
            created_at=base + timedelta(minutes=10),
            cleared_at=base + timedelta(minutes=11),
        )
        someone_elses = Notification(
            recipient_user_id=other_recipient.id,
            type=NotificationType.FOLLOW,
            actor_user_id=actor.id,
            reference_id=actor.id,
        )
        session.add_all([older, newer, cleared, someone_elses])
        session.commit()
        me_id = me.id
    _as_user(app, me)

    response = client.get("/notifications")

    assert response.status_code == 200
    body = response.json()
    reference_ids = [n["reference_id"] for n in body]
    assert reference_ids[0] == 999  # newer reply first
    assert len(body) == 2
    assert all(n["recipient_user_id"] == me_id for n in body)


def test_list_notifications_returns_empty_for_user_with_none(app, client, session_factory):
    with session_factory() as session:
        me = _make_user(session, cognito_sub="sub-list-empty", username="list_empty")
    _as_user(app, me)

    response = client.get("/notifications")

    assert response.status_code == 200
    assert response.json() == []


# --- POST /notifications/{id}/clear -------------------------------------------


def test_clear_notification_sets_cleared_at(app, client, session_factory):
    with session_factory() as session:
        me = _make_user(session, cognito_sub="sub-clear-me", username="clear_me")
        actor = _make_user(session, cognito_sub="sub-clear-actor", username="clear_actor")
        notification = Notification(
            recipient_user_id=me.id,
            type=NotificationType.FOLLOW,
            actor_user_id=actor.id,
            reference_id=actor.id,
        )
        session.add(notification)
        session.commit()
        notification_id = notification.id
    _as_user(app, me)

    response = client.post(f"/notifications/{notification_id}/clear")

    assert response.status_code == 204
    with session_factory() as session:
        fetched = session.get(Notification, notification_id)
        assert fetched.cleared_at is not None


def test_clear_notification_is_idempotent(app, client, session_factory):
    with session_factory() as session:
        me = _make_user(session, cognito_sub="sub-clear-idem", username="clear_idem")
        actor = _make_user(session, cognito_sub="sub-clear-idem-actor", username="clear_idem_actor")
        notification = Notification(
            recipient_user_id=me.id,
            type=NotificationType.FOLLOW,
            actor_user_id=actor.id,
            reference_id=actor.id,
        )
        session.add(notification)
        session.commit()
        notification_id = notification.id
    _as_user(app, me)

    first = client.post(f"/notifications/{notification_id}/clear")
    second = client.post(f"/notifications/{notification_id}/clear")

    assert first.status_code == 204
    assert second.status_code == 204


def test_clear_nonexistent_notification_returns_404(app, client, session_factory):
    with session_factory() as session:
        me = _make_user(session, cognito_sub="sub-clear-404", username="clear_404")
    _as_user(app, me)

    response = client.post("/notifications/999999/clear")

    assert response.status_code == 404


def test_clear_someone_elses_notification_returns_404(app, client, session_factory):
    with session_factory() as session:
        me = _make_user(session, cognito_sub="sub-clear-other-me", username="clear_other_me")
        owner = _make_user(session, cognito_sub="sub-clear-owner", username="clear_owner")
        actor = _make_user(session, cognito_sub="sub-clear-other-actor", username="clear_other_actor")
        notification = Notification(
            recipient_user_id=owner.id,
            type=NotificationType.FOLLOW,
            actor_user_id=actor.id,
            reference_id=actor.id,
        )
        session.add(notification)
        session.commit()
        notification_id = notification.id
    _as_user(app, me)

    response = client.post(f"/notifications/{notification_id}/clear")

    assert response.status_code == 404
    with session_factory() as session:
        fetched = session.get(Notification, notification_id)
        assert fetched.cleared_at is None


# --- GET/PUT /notifications/preference ------------------------------------------


def test_get_preference_defaults_to_enabled_when_no_row_exists(app, client, session_factory):
    with session_factory() as session:
        me = _make_user(session, cognito_sub="sub-pref-default", username="pref_default")
    _as_user(app, me)

    response = client.get("/notifications/preference")

    assert response.status_code == 200
    assert response.json() == {"email_notifications_enabled": True}


def test_put_preference_creates_row_when_none_exists(app, client, session_factory):
    with session_factory() as session:
        me = _make_user(session, cognito_sub="sub-pref-create", username="pref_create")
        me_id = me.id
    _as_user(app, me)

    response = client.put("/notifications/preference", json={"email_notifications_enabled": False})

    assert response.status_code == 200
    assert response.json() == {"email_notifications_enabled": False}
    with session_factory() as session:
        fetched = session.get(NotificationPreference, me_id)
        assert fetched.email_notifications_enabled is False


def test_put_preference_updates_existing_row(app, client, session_factory):
    with session_factory() as session:
        me = _make_user(session, cognito_sub="sub-pref-update", username="pref_update")
        session.add(NotificationPreference(user_id=me.id, email_notifications_enabled=True))
        session.commit()
        me_id = me.id
    _as_user(app, me)

    response = client.put("/notifications/preference", json={"email_notifications_enabled": False})

    assert response.status_code == 200
    assert response.json() == {"email_notifications_enabled": False}
    with session_factory() as session:
        fetched = session.get(NotificationPreference, me_id)
        assert fetched.email_notifications_enabled is False


def test_get_preference_reflects_existing_row(app, client, session_factory):
    with session_factory() as session:
        me = _make_user(session, cognito_sub="sub-pref-get", username="pref_get")
        session.add(NotificationPreference(user_id=me.id, email_notifications_enabled=False))
        session.commit()
    _as_user(app, me)

    response = client.get("/notifications/preference")

    assert response.status_code == 200
    assert response.json() == {"email_notifications_enabled": False}
