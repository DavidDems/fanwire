"""NOTIFICATIONS-001: the in-process EventPublisher for the local stack, per
AGENTS.md TDD workflow. Written before app/notifications/local_dispatch.py
exists, which is why that module is imported inside the tests: a top-level
import would fail collection and hide what each test says about behaviour.

The route tests use the real app.dependencies wiring (ENVIRONMENT=development,
no POST_EVENT_BUS_NAME, real get_event_bus and open_session) against Postgres.
Only the signed-in user and the moderation chain are overridden, so a publish
that ran before its commit, or under a lock, would show up here as a missing
row. A consumer run in its own session can only see what is committed.
"""

from __future__ import annotations

import ast
import importlib
import io
import json
import os
import subprocess
import sys
from datetime import date
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import dependencies
from app.db import Base, make_engine, make_session_factory
from app.dependencies import _get_session_factory, get_event_bus, get_session, get_settings
from app.eventbus import PostEventBus
from app.notifications.consumer import handle_domain_event
from app.notifications.email import SesEmailSender
from app.notifications.models import Notification
from app.notifications.routes import router as notifications_router
from app.posts.dependencies import get_moderation_chain
from app.posts.models import Post
from app.posts.moderation import ModerationCheck, ModerationContext
from app.posts.routes import router as posts_router
from app.users.dependencies import get_current_user
from app.users.models import User
from app.users.routes import router as users_router

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_CONSUMER_SEAM = "app.notifications.local_dispatch.handle_domain_event"
# Ids an exception might carry. Neither may reach the log.
_USER_ID = 7654321
_POST_ID = 1234567


def _local_dispatch():
    return importlib.import_module("app.notifications.local_dispatch")


def _clear_caches() -> None:
    get_settings.cache_clear()
    get_event_bus.cache_clear()
    _get_session_factory.cache_clear()


class SpySession(Session):
    """A real, unbound Session that counts its closes. It never connects."""

    def __init__(self) -> None:
        super().__init__()
        self.close_count = 0

    def close(self) -> None:
        self.close_count += 1
        super().close()


def _spy_factory() -> tuple[list[SpySession], object]:
    opened: list[SpySession] = []

    def factory() -> SpySession:
        session = SpySession()
        opened.append(session)
        return session

    return opened, factory


@pytest.fixture()
def dispatch_log():
    """What the publisher's logger really emits. A powertools Logger binds its
    stream when it is built and does not propagate, so neither capsys nor caplog
    sees it (`tests/test_migrate.py` says the same of caplog)."""
    handler = _local_dispatch().logger.registered_handler
    buffer = io.StringIO()
    previous = handler.setStream(buffer)
    yield buffer
    handler.setStream(previous)


# --- The publisher, no database ---------------------------------------------------


def test_each_event_reaches_the_consumer_decoded_with_the_local_email_sender(monkeypatch):
    calls: list[dict] = []
    monkeypatch.setattr(
        _CONSUMER_SEAM,
        lambda session, **kwargs: calls.append({"session": session, **kwargs}),
    )
    opened, factory = _spy_factory()

    PostEventBus(_local_dispatch().LocalDispatchPublisher(factory)).publish(
        "UserFollowed", {"followed_user_id": 1, "follower_user_id": 2}
    )

    [call] = calls
    assert call["session"] is opened[0]
    assert call["event_name"] == "UserFollowed"
    assert call["detail"]["followed_user_id"] == 1
    assert call["detail"]["follower_user_id"] == 2
    assert "published_at" in call["detail"]
    assert not isinstance(call["email_sender"], SesEmailSender)


def test_the_publisher_opens_a_session_per_event_and_closes_each(monkeypatch):
    seen: list[Session] = []
    monkeypatch.setattr(_CONSUMER_SEAM, lambda session, **_: seen.append(session))
    opened, factory = _spy_factory()
    publisher = _local_dispatch().LocalDispatchPublisher(factory)

    publisher.put_event(source="fanwire", detail_type="PostCreated", detail="{}")
    publisher.put_event(source="fanwire", detail_type="PostCreated", detail="{}")

    assert len(opened) == 2
    assert opened[0] is not opened[1]
    assert seen == opened
    assert [s.close_count for s in opened] == [1, 1]


def test_a_consumer_exception_is_logged_without_ids_and_the_session_is_closed(
    monkeypatch, dispatch_log
):
    def boom(session, **_):
        raise RuntimeError(f"user {_USER_ID} and post {_POST_ID}")

    monkeypatch.setattr(_CONSUMER_SEAM, boom)
    opened, factory = _spy_factory()
    publisher = _local_dispatch().LocalDispatchPublisher(factory)

    publisher.put_event(
        source="fanwire",
        detail_type="PostCreated",
        detail=json.dumps({"post_id": _POST_ID, "author_id": _USER_ID}),
    )

    logged = dispatch_log.getvalue()
    assert "RuntimeError" in logged
    assert "PostCreated" in logged
    assert str(_USER_ID) not in logged
    assert str(_POST_ID) not in logged
    assert opened[0].close_count == 1


def test_a_session_that_cannot_open_does_not_reach_the_caller(dispatch_log):
    def no_database() -> Session:
        raise ConnectionError(f"could not connect for user {_USER_ID}")

    _local_dispatch().LocalDispatchPublisher(no_database).put_event(
        source="fanwire", detail_type="UserFollowed", detail="{}"
    )

    logged = dispatch_log.getvalue()
    assert "ConnectionError" in logged
    assert str(_USER_ID) not in logged


def test_the_local_email_sender_sends_nothing_and_touches_no_aws(monkeypatch):
    client_factory = MagicMock()
    monkeypatch.setattr("botocore.session.Session.create_client", client_factory)
    local_dispatch = _local_dispatch()

    sender = local_dispatch.LocalEmailSender()
    sender.send(recipient_cognito_sub="sub-a", notification=MagicMock())

    assert isinstance(sender, local_dispatch.EmailSender)
    assert not isinstance(sender, SesEmailSender)
    client_factory.assert_not_called()


# --- Module boundaries ------------------------------------------------------------


def _imported_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            modules.add(node.module)
            modules.update(f"{node.module}.{alias.name}" for alias in node.names)
        elif isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
    return modules


def _publisher_sources() -> list[Path]:
    app_dir = _BACKEND_DIR / "app"
    return [
        app_dir / "eventbus.py",
        *sorted((app_dir / "posts").rglob("*.py")),
        *sorted((app_dir / "users").rglob("*.py")),
    ]


def test_publishers_know_nothing_of_the_subscriber():
    sources = _publisher_sources()
    assert len(sources) > 2
    offenders = [
        str(path.relative_to(_BACKEND_DIR))
        for path in sources
        if any(m.startswith("app.notifications") for m in _imported_modules(path))
    ]
    assert offenders == []


def test_local_dispatch_does_not_import_the_composition_root():
    source = _BACKEND_DIR / "app" / "notifications" / "local_dispatch.py"

    imported = _imported_modules(source)

    assert "app.notifications.consumer" in imported
    assert not any(m.startswith("app.dependencies") for m in imported)
    assert "boto3" not in imported


@pytest.mark.parametrize(
    "first_import",
    ["app.dependencies", "app.notifications.local_dispatch", "app.notifications.consumer"],
)
def test_no_import_cycle_from_any_entry_point(first_import):
    """A fresh interpreter, since this process has every module imported."""
    env = dict(os.environ)
    env.setdefault("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5432/db")
    result = subprocess.run(
        [sys.executable, "-c", f"import {first_import}; import app.dependencies"],
        check=False,
        cwd=_BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr


def test_the_consumers_imports_do_not_reach_the_composition_root():
    env = dict(os.environ)
    env.setdefault("DATABASE_URL", "postgresql+psycopg://u:p@localhost:5432/db")
    script = (
        "import sys\n"
        "import app.notifications.local_dispatch\n"
        "assert 'app.dependencies' not in sys.modules\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        check=False,
        cwd=_BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr


# --- The real wiring, through the real routes, against Postgres --------------------


class NeverRejects(ModerationCheck):
    def check(self, context: ModerationContext) -> None:
        pass


@pytest.fixture()
def engine(postgres_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", postgres_url)
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.delenv("POST_EVENT_BUS_NAME", raising=False)
    monkeypatch.delenv("AWS_LAMBDA_FUNCTION_NAME", raising=False)
    monkeypatch.delenv("NOTIFICATION_FROM_ADDRESS", raising=False)
    _clear_caches()
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield engine
    # Close the app's own pool first: drop_all must not wait on its connections.
    _get_session_factory().kw["bind"].dispose()
    _clear_caches()
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def session_factory(engine):
    return make_session_factory(engine)


@pytest.fixture()
def test_app(engine):
    application = FastAPI()
    application.include_router(users_router)
    application.include_router(posts_router)
    application.include_router(notifications_router)
    application.dependency_overrides[get_moderation_chain] = lambda: NeverRejects()
    return application


@pytest.fixture()
def client(test_app):
    return TestClient(test_app)


@pytest.fixture()
def people(session_factory):
    with session_factory() as session:
        users = {
            name: User(cognito_sub=f"sub-{name}", username=name, date_of_birth=date(1990, 1, 1))
            for name in ("alice", "bob")
        }
        session.add_all(users.values())
        session.commit()
        alices_post = Post(author_id=users["alice"].id, text="the original")
        session.add(alices_post)
        session.commit()
    return {**users, "alices_post": alices_post}


def _as(test_app, user: User) -> None:
    test_app.dependency_overrides[get_current_user] = lambda: user


def _listed(test_app, client, user: User) -> list[dict]:
    _as(test_app, user)
    response = client.get("/notifications")
    assert response.status_code == 200
    return response.json()


def _rows(session_factory) -> list[Notification]:
    with session_factory() as session:
        return list(session.scalars(select(Notification)).all())


def _reply(test_app, client, user: User, parent_id: int):
    _as(test_app, user)
    return client.post(
        "/posts", json={"text": "a reply", "is_reply": True, "parent_post_id": parent_id}
    )


def _repost(test_app, client, user: User, post_id: int):
    _as(test_app, user)
    return client.post(f"/posts/{post_id}/repost")


def _follow(test_app, client, user: User, followed_id: int):
    _as(test_app, user)
    return client.post(f"/users/{followed_id}/follow")


def test_a_follow_notifies_the_followed_user(test_app, client, people):
    alice, bob = people["alice"], people["bob"]

    response = _follow(test_app, client, bob, alice.id)

    assert response.status_code == 204
    [notification] = _listed(test_app, client, alice)
    assert notification["type"] == "follow"
    assert notification["actor_user_id"] == bob.id
    assert _listed(test_app, client, bob) == []


def test_a_reply_notifies_the_parents_author(test_app, client, people):
    alice, bob = people["alice"], people["bob"]

    response = _reply(test_app, client, bob, people["alices_post"].id)

    assert response.status_code == 201
    [notification] = _listed(test_app, client, alice)
    assert notification["type"] == "reply"
    assert notification["actor_user_id"] == bob.id
    assert notification["reference_id"] == response.json()["id"]
    assert _listed(test_app, client, bob) == []


def test_a_repost_notifies_the_originals_author(test_app, client, people):
    alice, bob = people["alice"], people["bob"]

    response = _repost(test_app, client, bob, people["alices_post"].id)

    assert response.status_code == 201
    [notification] = _listed(test_app, client, alice)
    assert notification["type"] == "repost"
    assert notification["actor_user_id"] == bob.id
    assert notification["reference_id"] == response.json()["id"]
    assert _listed(test_app, client, bob) == []


def test_a_plain_post_notifies_nobody(test_app, client, session_factory, people):
    _as(test_app, people["bob"])

    response = client.post("/posts", json={"text": "just a post"})

    assert response.status_code == 201
    assert _rows(session_factory) == []


def test_a_self_reply_notifies_nobody(test_app, client, session_factory, people):
    response = _reply(test_app, client, people["alice"], people["alices_post"].id)

    assert response.status_code == 201
    assert _rows(session_factory) == []


def test_a_report_notifies_nobody(test_app, client, session_factory, people):
    _as(test_app, people["bob"])

    response = client.post(f"/posts/{people['alices_post'].id}/report")

    assert response.status_code == 204
    assert _rows(session_factory) == []


def test_the_consumer_never_gets_the_requests_session(test_app, client, monkeypatch, people):
    request_sessions: list[Session] = []

    def _recording_get_session():
        for session in get_session():
            request_sessions.append(session)
            yield session

    test_app.dependency_overrides[get_session] = _recording_get_session

    consumer_sessions: list[Session] = []

    def _recording_consumer(session, **kwargs):
        consumer_sessions.append(session)
        return handle_domain_event(session, **kwargs)

    monkeypatch.setattr(_CONSUMER_SEAM, _recording_consumer)

    response = _follow(test_app, client, people["bob"], people["alice"].id)

    assert response.status_code == 204
    assert len(consumer_sessions) == 1
    assert request_sessions
    assert all(consumer_sessions[0] is not s for s in request_sessions)
    assert len(_listed(test_app, client, people["alice"])) == 1


@pytest.mark.parametrize(
    ("action", "expected_status"),
    [("follow", 204), ("reply", 201), ("repost", 201)],
)
def test_a_consumer_failure_leaves_the_request_its_usual_status(
    test_app, client, monkeypatch, session_factory, people, dispatch_log, action, expected_status
):
    opened: list[Session] = []
    closes: list[Session] = []
    real_open_session = dependencies.open_session

    def _spying_open_session() -> Session:
        session = real_open_session()
        real_close = session.close

        def _close() -> None:
            closes.append(session)
            real_close()

        session.close = _close  # type: ignore[method-assign]
        opened.append(session)
        return session

    def boom(session, **_):
        raise RuntimeError(f"user {_USER_ID} and post {_POST_ID}")

    monkeypatch.setattr(dependencies, "open_session", _spying_open_session)
    monkeypatch.setattr(_CONSUMER_SEAM, boom)
    alice, bob = people["alice"], people["bob"]

    if action == "follow":
        response = _follow(test_app, client, bob, alice.id)
    elif action == "reply":
        response = _reply(test_app, client, bob, people["alices_post"].id)
    else:
        response = _repost(test_app, client, bob, people["alices_post"].id)

    assert response.status_code == expected_status
    assert _rows(session_factory) == []
    assert len(opened) == 1
    assert closes == opened
    logged = dispatch_log.getvalue()
    assert "RuntimeError" in logged
    assert str(_USER_ID) not in logged
    assert str(_POST_ID) not in logged


def test_a_real_consumer_failure_does_not_reach_the_caller(session_factory, people, dispatch_log):
    """No mock: the real consumer raises MissingReferenceError for an event
    naming no such user."""
    bus = get_event_bus()

    bus.publish(
        "UserFollowed", {"followed_user_id": _USER_ID, "follower_user_id": people["bob"].id}
    )

    assert _rows(session_factory) == []
    assert "MissingReferenceError" in dispatch_log.getvalue()
    assert str(_USER_ID) not in dispatch_log.getvalue()


def test_no_aws_client_and_no_email_even_with_a_from_address(
    test_app, client, monkeypatch, session_factory, people
):
    monkeypatch.setenv("NOTIFICATION_FROM_ADDRESS", "notifications@example.invalid")
    get_settings.cache_clear()
    get_event_bus.cache_clear()
    created_clients = MagicMock()
    monkeypatch.setattr("botocore.session.Session.create_client", created_clients)

    response = _follow(test_app, client, people["bob"], people["alice"].id)

    assert response.status_code == 204
    created_clients.assert_not_called()
    [row] = _rows(session_factory)
    assert row.recipient_user_id == people["alice"].id
