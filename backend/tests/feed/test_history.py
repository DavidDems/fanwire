"""POSTS-008: history is an authenticated, stable, batched read of own activity."""

from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateIndex

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_session
from app.feed.routes import router
from app.feed.views import assemble_post_views
from app.posts.models import Post, PostLike
from app.users.auth import FakeTokenVerifier, VerifiedIdentity
from app.users.dependencies import get_token_verifier
from app.users.models import User


@pytest.fixture()
def engine(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def factory(engine):
    return make_session_factory(engine)


def user(session, name, **values):
    row = User(
        cognito_sub=f"history-{name}", username=name, date_of_birth=date(1990, 1, 1), **values
    )
    session.add(row)
    session.commit()
    return row


def post(session, author, **values):
    row = Post(author_id=author.id, **{"text": "history post", **values})
    session.add(row)
    session.commit()
    return row


def client_for(factory, viewer):
    app = FastAPI()
    app.include_router(router)

    def session_override():
        with factory() as session:
            yield session

    app.dependency_overrides[get_session] = session_override
    app.dependency_overrides[get_token_verifier] = lambda: FakeTokenVerifier(
        VerifiedIdentity(sub=viewer.cognito_sub)
    )
    return TestClient(app, headers={"Authorization": "Bearer history-test-token"})


def page(client, tab="posts", **params):
    response = client.get("/feed/history", params={"tab": tab, **params})
    assert response.status_code == 200, response.text
    return response.json()


def ids(body):
    return [item["id"] for item in body["items"]]


def test_history_requires_token_without_touching_database():
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_session] = lambda: None
    app.dependency_overrides[get_token_verifier] = lambda: FakeTokenVerifier(None)
    assert TestClient(app).get("/feed/history").status_code == 401


def test_history_refuses_deactivated_account(factory):
    with factory() as session:
        viewer = user(session, "inactive", deleted_at=datetime.now(UTC))
    response = client_for(factory, viewer).get("/feed/history")
    assert response.status_code == 403
    assert response.json()["detail"] == "account_deactivated"


@pytest.mark.parametrize(
    "params",
    [
        {"tab": "unknown"},
        {"cursor": "not-a-cursor"},
        {"cursor": "123"},
        {"cursor": "bm90IGpzb24="},
        {"cursor": "W10="},
        {"limit": 0},
        {"limit": 51},
        {"limit": "no"},
    ],
)
def test_history_validates_query_at_boundary(factory, params):
    with factory() as session:
        viewer = user(session, "validate")
    assert client_for(factory, viewer).get("/feed/history", params=params).status_code == 422


def test_tabs_are_own_activity_and_return_the_feed_post_view(factory):
    with factory() as session:
        viewer = user(session, "owner")
        other = user(session, "other")
        original = post(session, viewer, text="own original")
        root = post(session, other, text="other original")
        reply = post(session, viewer, text="own reply", is_reply=True, parent_post_id=root.id)
        plain = post(session, viewer, text=None, is_repost=True, original_post_id=root.id)
        quote = post(session, viewer, text="own quote", is_repost=True, original_post_id=root.id)
        post(session, other, text="other reply", is_reply=True, parent_post_id=original.id)
        session.add(PostLike(user_id=viewer.id, post_id=root.id))
        session.commit()
        expected_like = assemble_post_views(session, [root], viewer_id=viewer.id)[0].model_dump(
            mode="json"
        )
    client = client_for(factory, viewer)
    assert ids(page(client, "posts", user_id=other.id)) == [original.id]
    assert ids(page(client, "replies")) == [reply.id]
    assert ids(page(client, "reposts")) == [quote.id, plain.id]
    likes = page(client, "likes")
    assert ids(likes) == [root.id]
    assert likes["items"] == [expected_like]
    assert likes["items"][0]["liked_by_viewer"] is True
    assert likes["items"][0]["reposted_by_viewer"] is True


def test_deleted_rows_are_filtered_before_limit_but_deleted_original_keeps_repost(factory):
    now = datetime.now(UTC)
    with factory() as session:
        viewer = user(session, "filter")
        other = user(session, "active")
        inactive = user(session, "hidden", deleted_at=now)
        visible = [post(session, other, text=f"visible {n}") for n in range(3)]
        deleted = post(session, other, text="deleted", deleted_at=now)
        hidden = post(session, inactive, text="hidden")
        post(session, viewer, text="own deleted", deleted_at=now)
        repost = post(session, viewer, text=None, is_repost=True, original_post_id=deleted.id)
        for n, row in enumerate([*visible, deleted, hidden]):
            session.add(
                PostLike(user_id=viewer.id, post_id=row.id, created_at=now + timedelta(seconds=n))
            )
        session.commit()
    client = client_for(factory, viewer)
    first = page(client, "likes", limit=2)
    assert ids(first) == [visible[2].id, visible[1].id]
    assert first["next_cursor"] is not None
    last = page(client, "likes", limit=2, cursor=first["next_cursor"])
    assert ids(last) == [visible[0].id]
    assert last["next_cursor"] is None
    assert ids(page(client, "posts")) == []
    [item] = page(client, "reposts")["items"]
    assert item["id"] == repost.id
    assert item["reposted_post"] is None
    assert item["reposted_post_deleted"] is True


@pytest.mark.parametrize("tab", ["posts", "replies", "reposts", "likes"])
def test_keyset_pages_survive_new_activity_and_exact_last_page(factory, tab):
    now = datetime(2026, 1, 1, tzinfo=UTC)
    with factory() as session:
        viewer = user(session, "paging")
        other = user(session, "pagingother")
        root = post(session, other)

        def activity(n):
            values = {"text": f"activity {n}"}
            if tab == "replies":
                values.update(is_reply=True, parent_post_id=root.id)
            if tab == "reposts":
                values.update(is_repost=True, original_post_id=root.id)
            row = post(session, other if tab == "likes" else viewer, **values)
            if tab == "likes":
                session.add(PostLike(user_id=viewer.id, post_id=row.id, created_at=now))
                session.commit()
            return row.id

        expected = [activity(n) for n in range(4)][::-1]
        client = client_for(factory, viewer)
        first = page(client, tab, limit=2)
        assert ids(first) == expected[:2]
        cursor = first["next_cursor"]
        assert isinstance(cursor, str)
        assert cursor and not cursor.isdecimal()
        activity(99)
    last = page(client, tab, limit=2, cursor=cursor)
    assert ids(last) == expected[2:]
    assert last["next_cursor"] is None


def test_likes_sort_by_like_time_rather_than_post_id(factory):
    now = datetime.now(UTC)
    with factory() as session:
        viewer = user(session, "likesorder")
        old = post(session, viewer)
        new = post(session, viewer)
        session.add_all(
            [
                PostLike(user_id=viewer.id, post_id=new.id, created_at=now),
                PostLike(user_id=viewer.id, post_id=old.id, created_at=now + timedelta(seconds=1)),
            ]
        )
        session.commit()
    assert ids(page(client_for(factory, viewer), "likes")) == [old.id, new.id]


@pytest.mark.parametrize("tab", ["posts", "replies", "reposts", "likes"])
def test_default_limit_and_page_query_count_are_constant(engine, factory, tab):
    with factory() as session:
        viewer = user(session, "batched")
        root = post(session, user(session, "batchother"))
        for n in range(25):
            values = {"text": f"batch {n}"}
            if tab == "replies":
                values.update(is_reply=True, parent_post_id=root.id)
            if tab == "reposts":
                values.update(is_repost=True, original_post_id=root.id)
            row = post(session, viewer, **values)
            session.add(PostLike(user_id=viewer.id, post_id=row.id))
        session.commit()
    client = client_for(factory, viewer)

    def count(limit):
        statements = []

        def record(*args):
            statements.append(args[2])

        event.listen(engine, "before_cursor_execute", record)
        try:
            result = page(client, tab, **({} if limit is None else {"limit": limit}))
        finally:
            event.remove(engine, "before_cursor_execute", record)
        assert len(result["items"]) == (20 if limit is None else limit)
        assert result["next_cursor"] is not None
        return len(statements)

    assert count(2) == count(None)


def test_history_likes_has_ordered_composite_index():
    definitions = [
        str(CreateIndex(index).compile(dialect=postgresql.dialect())).lower()
        for index in PostLike.__table__.indexes
    ]
    assert any("(user_id, created_at desc, post_id desc)" in sql for sql in definitions)
