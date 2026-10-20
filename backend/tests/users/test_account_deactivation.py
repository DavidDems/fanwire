"""USERS-003: account status and the three dependency paths, end to end on
app.main's app.

A deactivated account (User.deleted_at set) is refused on the active-account
path (get_current_user) with 403 {"detail": "account_deactivated"}, treated
as a guest on the public-read path (get_optional_current_user), and reaches
the own-account path (get_own_account): POST /users/me/recover and
DELETE /users/me.

Runs against the real app.main app so the routes' real dependency chains are
exercised: only get_token_verifier (FakeTokenVerifier, one fixed identity per
test), get_session, get_event_bus and get_moderation_chain are overridden.
The moderation chain is replaced with a pass-through so this file tests
account status, not the spam scorer or the post rate limit.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_event_bus, get_session
from app.eventbus import InMemoryEventPublisher, PostEventBus
from app.main import app as main_app
from app.notifications.models import Notification, NotificationType
from app.posts.dependencies import get_moderation_chain
from app.posts.models import Post, PostLike
from app.posts.moderation import ModerationCheck, ModerationContext
from app.users.auth import FakeTokenVerifier, VerifiedIdentity
from app.users.dependencies import get_token_verifier
from app.users.models import Follow, User
from app.users.service import create_user, soft_delete_user

# The one bearer token string used throughout each test. FakeTokenVerifier
# ignores its value; what matters is that it never changes.
TOKEN = {"Authorization": "Bearer unchanged-token"}

DEACTIVATED = {"detail": "account_deactivated"}


class _PassThrough(ModerationCheck):
    def check(self, context: ModerationContext) -> None:
        pass


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def app(session_factory):
    saved = dict(main_app.dependency_overrides)

    def _get_session_override():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    main_app.dependency_overrides[get_session] = _get_session_override
    main_app.dependency_overrides[get_event_bus] = lambda: PostEventBus(InMemoryEventPublisher())
    main_app.dependency_overrides[get_moderation_chain] = lambda: _PassThrough()
    yield main_app
    main_app.dependency_overrides.clear()
    main_app.dependency_overrides.update(saved)


@pytest.fixture()
def client(app):
    return TestClient(app)


def _sign_in(app, sub: str) -> None:
    app.dependency_overrides[get_token_verifier] = lambda: FakeTokenVerifier(
        VerifiedIdentity(sub=sub)
    )


def _create(session, sub: str, username: str) -> User:
    return create_user(session, cognito_sub=sub, username=username, date_of_birth=date(1990, 1, 1))


def _deleted_at(session_factory, user_id: int):
    with session_factory() as session:
        return session.scalar(select(User.deleted_at).where(User.id == user_id))


def _user_row(session_factory, user_id: int) -> dict:
    table = User.__table__
    with session_factory() as session:
        row = session.execute(select(table).where(table.c.id == user_id)).one()
    return dict(row._mapping)


def _assert_me_out(body: dict, *, user_id: int, username: str) -> None:
    assert body["id"] == user_id
    assert body["username"] == username
    assert body["date_of_birth"] == "1990-01-01"
    assert "cognito_sub" not in body


# --- GET /users/me -------------------------------------------------------


def test_get_me_403s_account_deactivated_for_a_deactivated_caller(app, client, session_factory):
    with session_factory() as session:
        user = _create(session, "sub-me-deactivated", "me_deactivated")
        soft_delete_user(session, user.id)
    _sign_in(app, "sub-me-deactivated")

    response = client.get("/users/me", headers=TOKEN)

    assert response.status_code == 403
    assert response.json() == DEACTIVATED


def test_get_me_answers_me_out_for_an_active_caller(app, client, session_factory):
    with session_factory() as session:
        user = _create(session, "sub-me-active", "me_active")
        user_id = user.id
    _sign_in(app, "sub-me-active")

    response = client.get("/users/me", headers=TOKEN)

    assert response.status_code == 200
    _assert_me_out(response.json(), user_id=user_id, username="me_active")


def test_get_me_404s_for_a_token_with_no_user_row(app, client):
    _sign_in(app, "sub-me-no-row")

    response = client.get("/users/me", headers=TOKEN)

    assert response.status_code == 404
    assert response.json() == {"detail": "User profile not found"}


def test_get_me_declares_the_403_in_its_openapi_responses():
    responses = main_app.openapi()["paths"]["/users/me"]["get"]["responses"]

    assert "403" in responses


# --- POST /users/me/recover ----------------------------------------------


def test_recover_reactivates_a_deactivated_caller_and_answers_me_out(app, client, session_factory):
    with session_factory() as session:
        user = _create(session, "sub-recover-me", "recover_me")
        soft_delete_user(session, user.id)
        user_id = user.id
    _sign_in(app, "sub-recover-me")

    response = client.post("/users/me/recover", headers=TOKEN)

    assert response.status_code == 200
    _assert_me_out(response.json(), user_id=user_id, username="recover_me")
    assert _deleted_at(session_factory, user_id) is None


def test_recover_by_an_active_caller_changes_nothing_and_answers_me_out(
    app, client, session_factory
):
    with session_factory() as session:
        user = _create(session, "sub-recover-active", "recover_active")
        user_id = user.id
    before = _user_row(session_factory, user_id)
    _sign_in(app, "sub-recover-active")

    response = client.post("/users/me/recover", headers=TOKEN)

    assert response.status_code == 200
    _assert_me_out(response.json(), user_id=user_id, username="recover_active")
    assert _user_row(session_factory, user_id) == before


def test_recover_404s_for_a_token_with_no_user_row(app, client):
    _sign_in(app, "sub-recover-no-row")

    response = client.post("/users/me/recover", headers=TOKEN)

    assert response.status_code == 404


def test_recover_401s_without_a_token(client):
    response = client.post("/users/me/recover")

    assert response.status_code == 401


def test_recover_takes_no_user_id_from_path_query_or_body():
    operation = main_app.openapi()["paths"]["/users/me/recover"]["post"]

    assert operation.get("parameters", []) == []
    assert "requestBody" not in operation


def test_recover_ignores_a_supplied_user_id_and_never_recovers_another_account(
    app, client, session_factory
):
    with session_factory() as session:
        caller = _create(session, "sub-recover-caller", "recover_caller")
        other = _create(session, "sub-recover-other", "recover_other")
        soft_delete_user(session, other.id)
        caller_id, other_id = caller.id, other.id
    other_deleted_at = _deleted_at(session_factory, other_id)
    _sign_in(app, "sub-recover-caller")

    response = client.post(
        "/users/me/recover",
        params={"user_id": other_id, "id": other_id},
        json={"user_id": other_id, "id": other_id},
        headers=TOKEN,
    )

    assert response.status_code == 200
    assert response.json()["id"] == caller_id
    assert _deleted_at(session_factory, other_id) == other_deleted_at


def _table_rows(session, model) -> list[tuple]:
    table = model.__table__
    stmt = select(table).order_by(*table.primary_key.columns)
    return [tuple(row) for row in session.execute(stmt).all()]


def _snapshot(session_factory) -> dict[str, list[tuple]]:
    with session_factory() as session:
        return {
            model.__tablename__: _table_rows(session, model)
            for model in (Post, Follow, PostLike, Notification)
        }


def test_recover_writes_deleted_at_and_nothing_else(app, client, session_factory):
    with session_factory() as session:
        caller = _create(session, "sub-recover-rows", "recover_rows")
        other = _create(session, "sub-recover-rows-other", "recover_rows_other")
        own_post = Post(author_id=caller.id, text="caller post")
        other_post = Post(author_id=other.id, text="other post")
        session.add_all([own_post, other_post])
        session.commit()
        reply = Post(author_id=other.id, text="a reply", is_reply=True, parent_post_id=own_post.id)
        session.add_all(
            [
                reply,
                Follow(follower_user_id=caller.id, followed_user_id=other.id),
                Follow(follower_user_id=other.id, followed_user_id=caller.id),
                PostLike(user_id=caller.id, post_id=other_post.id),
                PostLike(user_id=other.id, post_id=own_post.id),
                Notification(
                    recipient_user_id=caller.id,
                    type=NotificationType.FOLLOW,
                    actor_user_id=other.id,
                    reference_id=other.id,
                ),
                Notification(
                    recipient_user_id=other.id,
                    type=NotificationType.FOLLOW,
                    actor_user_id=caller.id,
                    reference_id=caller.id,
                    cleared_at=datetime(2026, 1, 1, tzinfo=UTC),
                ),
            ]
        )
        session.commit()
        soft_delete_user(session, caller.id)
        caller_id, other_id = caller.id, other.id

    rows_before = _snapshot(session_factory)
    caller_before = _user_row(session_factory, caller_id)
    other_before = _user_row(session_factory, other_id)
    _sign_in(app, "sub-recover-rows")

    response = client.post("/users/me/recover", headers=TOKEN)

    assert response.status_code == 200
    assert _snapshot(session_factory) == rows_before
    assert _user_row(session_factory, other_id) == other_before
    caller_after = _user_row(session_factory, caller_id)
    assert caller_after["deleted_at"] is None
    # updated_at is the column's own onupdate bookkeeping, not a write by
    # the recovery itself.
    ignored = {"deleted_at", "updated_at"}
    assert {k: v for k, v in caller_after.items() if k not in ignored} == {
        k: v for k, v in caller_before.items() if k not in ignored
    }


# --- DELETE /users/me ----------------------------------------------------


def test_delete_me_twice_answers_204_both_times_and_keeps_the_first_deleted_at(
    app, client, session_factory
):
    with session_factory() as session:
        user = _create(session, "sub-delete-twice", "delete_twice")
        user_id = user.id
    _sign_in(app, "sub-delete-twice")

    first = client.delete("/users/me", headers=TOKEN)
    assert first.status_code == 204
    first_deleted_at = _deleted_at(session_factory, user_id)
    assert first_deleted_at is not None

    second = client.delete("/users/me", headers=TOKEN)

    assert second.status_code == 204
    assert _deleted_at(session_factory, user_id) == first_deleted_at


# --- one unchanged token across deactivate and recover -------------------


def test_one_unchanged_token_is_refused_while_deactivated_and_works_after_recovery(
    app, client, session_factory
):
    with session_factory() as session:
        _create(session, "sub-sequence", "sequence_caller")
        first_target = _create(session, "sub-sequence-b", "sequence_target_b")
        second_target = _create(session, "sub-sequence-c", "sequence_target_c")
        session.add(Post(author_id=first_target.id, text="someone else posted"))
        session.commit()
        first_id, second_id = first_target.id, second_target.id
    _sign_in(app, "sub-sequence")

    # Active: both writes succeed.
    assert client.post("/posts", json={"text": "first take"}, headers=TOKEN).status_code == 201
    assert client.post(f"/users/{first_id}/follow", headers=TOKEN).status_code == 204

    assert client.delete("/users/me", headers=TOKEN).status_code == 204

    # Deactivated: the same token is refused on the active-account path...
    post = client.post("/posts", json={"text": "while deactivated"}, headers=TOKEN)
    assert post.status_code == 403
    assert post.json() == DEACTIVATED
    follow = client.post(f"/users/{second_id}/follow", headers=TOKEN)
    assert follow.status_code == 403
    assert follow.json() == DEACTIVATED

    # ...and treated as a guest on the public-read path.
    feed = client.get("/feed", headers=TOKEN)
    assert feed.status_code == 200
    assert feed.json() == client.get("/feed").json()
    profile = client.get(f"/users/{first_id}", headers=TOKEN)
    assert profile.status_code == 200
    assert profile.json() == client.get(f"/users/{first_id}").json()

    assert client.post("/users/me/recover", headers=TOKEN).status_code == 200

    # Recovered: the same token succeeds on both writes again.
    assert client.post("/posts", json={"text": "second take"}, headers=TOKEN).status_code == 201
    assert client.post(f"/users/{second_id}/follow", headers=TOKEN).status_code == 204


# --- visibility while deactivated ----------------------------------------


def _feed_post_ids(client) -> set[int]:
    return {item["id"] for item in client.get("/feed").json()["items"]}


def _search_post_ids(client, q: str) -> set[int]:
    response = client.get("/search/posts", params={"q": q})
    assert response.status_code == 200
    return {item["id"] for item in response.json()["items"]}


def test_a_deactivated_accounts_profile_and_posts_are_hidden_until_recovery(
    app, client, session_factory
):
    with session_factory() as session:
        caller = _create(session, "sub-visibility", "visibility_caller")
        post = Post(author_id=caller.id, text="zephyrdunk highlight")
        session.add(post)
        session.commit()
        caller_id, post_id = caller.id, post.id
    _sign_in(app, "sub-visibility")

    assert post_id in _feed_post_ids(client)
    assert post_id in _search_post_ids(client, "zephyrdunk")

    assert client.delete("/users/me", headers=TOKEN).status_code == 204

    assert client.get(f"/users/{caller_id}").status_code == 404
    assert post_id not in _feed_post_ids(client)
    assert post_id not in _search_post_ids(client, "zephyrdunk")

    assert client.post("/users/me/recover", headers=TOKEN).status_code == 200

    assert client.get(f"/users/{caller_id}").status_code == 200
    assert post_id in _feed_post_ids(client)
    assert post_id in _search_post_ids(client, "zephyrdunk")


# --- POST /users ---------------------------------------------------------


def test_create_profile_409s_for_a_sub_with_a_deactivated_row_and_adds_no_row(
    app, client, session_factory
):
    with session_factory() as session:
        user = _create(session, "sub-create-deactivated", "create_deactivated")
        soft_delete_user(session, user.id)
    _sign_in(app, "sub-create-deactivated")

    response = client.post(
        "/users",
        json={"username": "fresh_username", "date_of_birth": "1990-01-01"},
        headers=TOKEN,
    )

    assert response.status_code == 409
    with session_factory() as session:
        count = session.scalar(
            select(func.count())
            .select_from(User)
            .where(User.cognito_sub == "sub-create-deactivated")
        )
    assert count == 1
