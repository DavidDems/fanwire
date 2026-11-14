"""POSTS-007: an undone repost must not reach the DLQ, and its notification
leaves GET /notifications (decided by the human, 2026-10-30). Written before
either change.

One throwaway FastAPI() with the posts and notifications routers, the harness
of tests/feed/test_repost_roundtrip.py. A repost goes through the real route
and the consumer is handed the detail of the PostCreated event that route
really published, taken from a recording bus, so the payload here cannot drift
from the facade's.
"""

from __future__ import annotations

import ast
from datetime import date
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event, select

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_event_bus, get_session
from app.eventbus import InMemoryEventPublisher, PostEventBus
from app.notifications.consumer import handle_domain_event
from app.notifications.email import RecordingEmailSender
from app.notifications.models import Notification, NotificationType
from app.notifications.routes import router as notifications_router
from app.posts.dependencies import get_moderation_chain
from app.posts.facade import POST_CREATED
from app.posts.models import Post
from app.posts.moderation import ModerationCheck, ModerationContext
from app.posts.routes import router as posts_router
from app.users.dependencies import get_current_user
from app.users.models import User

NO_SUCH_POST = 999_000_000


class NeverRejects(ModerationCheck):
    def check(self, context: ModerationContext) -> None:
        pass


@pytest.fixture()
def engine(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def session_factory(engine):
    return make_session_factory(engine)


@pytest.fixture()
def publisher():
    return InMemoryEventPublisher()


@pytest.fixture()
def app(session_factory, publisher):
    app = FastAPI()
    app.include_router(posts_router)
    app.include_router(notifications_router)

    def _get_session_override():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = _get_session_override
    app.dependency_overrides[get_event_bus] = lambda: PostEventBus(publisher)
    app.dependency_overrides[get_moderation_chain] = lambda: NeverRejects()
    return app


@pytest.fixture()
def client(app):
    return TestClient(app)


def _make_user(session, username: str) -> User:
    user = User(cognito_sub=f"sub-{username}", username=username, date_of_birth=date(1990, 1, 1))
    session.add(user)
    session.commit()
    return user


@pytest.fixture()
def people(session_factory):
    with session_factory() as session:
        author = _make_user(session, "undo_author")
        reposter = _make_user(session, "undo_reposter")
        second = _make_user(session, "undo_second")
        original = Post(author_id=author.id, text="worth sharing")
        session.add(original)
        session.commit()
    return {"author": author, "reposter": reposter, "second": second, "original": original}


def _as(app, user: User) -> None:
    app.dependency_overrides[get_current_user] = lambda: user


def _repost(app, client, publisher, user: User, post_id: int) -> dict:
    """Reposts through the route; returns the detail of the event it published."""
    _as(app, user)
    response = client.post(f"/posts/{post_id}/repost")
    assert response.status_code == 201
    published = publisher.published[-1]
    assert published.name == POST_CREATED
    assert published.detail["post_id"] == response.json()["id"]
    return published.detail


def _undo(app, client, user: User, post_id: int) -> int:
    _as(app, user)
    return client.delete(f"/posts/{post_id}/repost").status_code


def _consume(session_factory, detail: dict) -> tuple[Notification | None, RecordingEmailSender]:
    sender = RecordingEmailSender()
    with session_factory() as session:
        result = handle_domain_event(
            session, event_name=POST_CREATED, detail=detail, email_sender=sender
        )
    return result, sender


def _listed(app, client, user: User) -> list[dict]:
    _as(app, user)
    response = client.get("/notifications")
    assert response.status_code == 200
    return response.json()


def _rows_for(session_factory, user: User) -> list[Notification]:
    with session_factory() as session:
        return list(
            session.scalars(
                select(Notification).where(Notification.recipient_user_id == user.id)
            ).all()
        )


# --- The race: undone before the consumer runs -----------------------------------


def test_a_repost_undone_before_the_consumer_runs_is_a_no_op(
    app, client, publisher, session_factory, people
):
    original_id = people["original"].id
    detail = _repost(app, client, publisher, people["reposter"], original_id)
    assert _undo(app, client, people["reposter"], original_id) == 204

    result, sender = _consume(session_factory, detail)

    assert result is None
    assert sender.sent == []
    assert _rows_for(session_factory, people["author"]) == []


# --- Undone after the consumer ran: hidden, row kept ------------------------------


def test_a_notification_committed_before_the_undo_is_hidden_and_its_row_kept(
    app, client, publisher, session_factory, people
):
    author, reposter = people["author"], people["reposter"]
    original_id = people["original"].id
    detail = _repost(app, client, publisher, reposter, original_id)
    created, _ = _consume(session_factory, detail)
    assert created is not None
    assert [n["id"] for n in _listed(app, client, author)] == [created.id]

    assert _undo(app, client, reposter, original_id) == 204

    assert _listed(app, client, author) == []
    [row] = _rows_for(session_factory, author)
    assert row.id == created.id
    assert row.cleared_at is None


def test_one_of_two_reposters_undoing_leaves_the_others_notification_listed(
    app, client, publisher, session_factory, people
):
    author = people["author"]
    original_id = people["original"].id
    undone, _ = _consume(
        session_factory, _repost(app, client, publisher, people["reposter"], original_id)
    )
    kept, _ = _consume(
        session_factory, _repost(app, client, publisher, people["second"], original_id)
    )
    assert undone is not None and kept is not None

    assert _undo(app, client, people["reposter"], original_id) == 204

    assert [n["id"] for n in _listed(app, client, author)] == [kept.id]


def test_reposting_again_after_an_undo_lists_only_the_new_reposts_notification(
    app, client, publisher, session_factory, people
):
    author, reposter = people["author"], people["reposter"]
    original_id = people["original"].id
    first, _ = _consume(session_factory, _repost(app, client, publisher, reposter, original_id))
    assert _undo(app, client, reposter, original_id) == 204

    second, _ = _consume(session_factory, _repost(app, client, publisher, reposter, original_id))

    assert first is not None and second is not None
    assert second.reference_id != first.reference_id
    assert [n["id"] for n in _listed(app, client, author)] == [second.id]


def test_an_undo_answered_409_changes_nothing_and_the_notification_stays_listed(
    app, client, publisher, session_factory, people
):
    author, reposter = people["author"], people["reposter"]
    original_id = people["original"].id
    detail = _repost(app, client, publisher, reposter, original_id)
    created, _ = _consume(session_factory, detail)
    assert created is not None
    _as(app, people["second"])
    reply = client.post(
        "/posts",
        json={
            "text": "replying to a repost",
            "is_reply": True,
            "parent_post_id": detail["post_id"],
        },
    )
    assert reply.status_code == 201

    assert _undo(app, client, reposter, original_id) == 409

    assert [n["id"] for n in _listed(app, client, author)] == [created.id]
    with session_factory() as session:
        assert session.get(Post, detail["post_id"]) is not None


# --- The hiding is REPOST only ----------------------------------------------------


def test_only_a_repost_notification_is_hidden_for_a_post_with_no_row(
    app, client, session_factory, people
):
    author, actor = people["author"], people["reposter"]
    with session_factory() as session:
        live = Post(author_id=actor.id, is_repost=True, original_post_id=people["original"].id)
        session.add(live)
        session.commit()

        def notify(kind: NotificationType, reference_id: int) -> int:
            row = Notification(
                recipient_user_id=author.id,
                type=kind,
                actor_user_id=actor.id,
                reference_id=reference_id,
            )
            session.add(row)
            session.commit()
            return row.id

        hidden = notify(NotificationType.REPOST, NO_SUCH_POST)
        kept = {
            notify(NotificationType.REPOST, live.id),
            notify(NotificationType.REPLY, NO_SUCH_POST),
            notify(NotificationType.FOLLOW, actor.id),
            # A follow's reference_id is a user id: no post row is implied.
            notify(NotificationType.FOLLOW, NO_SUCH_POST),
        }

    ids = {n["id"] for n in _listed(app, client, author)}

    assert ids == kept
    assert hidden not in ids


# --- The cost of the list ---------------------------------------------------------


def test_the_list_costs_the_same_statements_for_2_and_for_20_repost_notifications(
    app, client, engine, session_factory, people
):
    def _count_for(username: str, total: int) -> int:
        with session_factory() as session:
            recipient = _make_user(session, username)
            actor = people["reposter"]
            reposts = [
                Post(author_id=actor.id, is_repost=True, original_post_id=people["original"].id)
                for _ in range(total - 1)
            ]
            session.add_all(reposts)
            session.commit()
            session.add_all(
                Notification(
                    recipient_user_id=recipient.id,
                    type=NotificationType.REPOST,
                    actor_user_id=actor.id,
                    reference_id=reference_id,
                )
                for reference_id in [*(r.id for r in reposts), NO_SUCH_POST]
            )
            session.commit()

        statements: list[str] = []

        def _record(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement)

        event.listen(engine, "before_cursor_execute", _record)
        try:
            listed = _listed(app, client, recipient)
        finally:
            event.remove(engine, "before_cursor_execute", _record)
        # An equal count must not come from the filter being absent.
        assert len(listed) == total - 1
        return len(statements)

    assert _count_for("cost_two", 2) == _count_for("cost_twenty", 20)


def test_routes_learn_which_posts_exist_through_posts_read_function():
    """0x00-architecture Connection rule: routes.py imports the read function
    and never the Post model, so it cannot select from the posts table."""
    source = Path(__file__).resolve().parents[2] / "app" / "notifications" / "routes.py"
    tree = ast.parse(source.read_text(encoding="utf-8"))

    imported = {
        (node.module, alias.name)
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom)
        for alias in node.names
    }

    assert ("app.posts.service", "existing_post_ids") in imported
    assert not any(module == "app.posts.models" for module, _ in imported)
    assert not any(isinstance(node, ast.Name) and node.id == "Post" for node in ast.walk(tree))
