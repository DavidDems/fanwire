"""POSTS-009: every PostView on every read -- GET /feed, GET
/feed/thread/{id}, GET /feed/history and GET /search/posts -- carries
`replied_post` and `replied_post_deleted`. Search gets them through
assemble_post_views with no search/ change. Written before the fields
exist.

GET /feed shows a reply only when it has a like (the other half of
POSTS-009, test_feed_liked_replies.py), so the feed tests here like the
replies they expect to see.
"""

from __future__ import annotations

import pytest

from app.db import Base, make_engine, make_session_factory
from tests.feed.replied_post_support import (
    ReadClient,
    deactivate,
    delete_posts,
    items_by_id,
    like,
    make_post,
    make_user,
    plain_repost,
    quote_repost,
    reply_to,
)


@pytest.fixture()
def factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def reads(factory):
    return ReadClient(factory)


def _assert_not_a_reply(item) -> None:
    assert item["replied_post"] is None
    assert item["replied_post_deleted"] is False


# --- GET /feed ---------------------------------------------------------------------


def test_feed_items_carry_the_fields_null_and_false_on_non_replies(reads, factory):
    with factory() as session:
        author = make_user(session)
        top = make_post(session, author, text="top")
        plain_repost(session, author, top)
        quote_repost(session, author, top, "quoted")

    items = reads.feed()["items"]

    assert len(items) == 3
    for item in items:
        assert "replied_post" in item
        assert "replied_post_deleted" in item
        _assert_not_a_reply(item)


def test_feed_reply_carries_its_parent_one_level_deep(reads, factory):
    with factory() as session:
        author = make_user(session)
        viewer = make_user(session)
        root = make_post(session, author, text="root")
        parent = reply_to(session, author, root, "parent")
        reply = reply_to(session, author, parent, "liked reply")
        like(session, viewer, reply)
        like(session, viewer, parent)

    for who in (None, viewer):
        items = items_by_id(reads.as_viewer(who).feed()["items"])
        item = items[reply.id]
        assert item["replied_post_deleted"] is False
        assert item["replied_post"]["id"] == parent.id
        assert item["replied_post"]["text"] == "parent"
        assert item["replied_post"]["like_count"] == 1
        assert item["replied_post"]["liked_by_viewer"] is (who is not None)
        assert item["replied_post"]["replied_post"] is None
        assert item["replied_post"]["reposted_post"] is None
        # The liked parent is itself on the page with its own one level.
        assert items[parent.id]["replied_post"]["id"] == root.id
        _assert_not_a_reply(items[root.id])


def test_feed_reply_to_a_plain_repost_carries_the_original(reads, factory):
    with factory() as session:
        author = make_user(session)
        original = make_post(session, author, text="the original")
        repost = plain_repost(session, author, original)
        reply = reply_to(session, author, repost)
        like(session, author, reply)

    item = items_by_id(reads.feed()["items"])[reply.id]

    assert item["parent_post_id"] == repost.id
    assert item["replied_post"]["id"] == original.id
    assert item["replied_post"]["text"] == "the original"
    assert item["replied_post"]["reposted_post"] is None


def test_feed_reply_to_a_quote_repost_carries_the_quote_with_reposted_post_null(reads, factory):
    with factory() as session:
        author = make_user(session)
        original = make_post(session, author, text="the original")
        quote = quote_repost(session, author, original, "my quote")
        reply = reply_to(session, author, quote)
        like(session, author, reply)

    items = items_by_id(reads.feed()["items"])

    assert items[reply.id]["replied_post"]["id"] == quote.id
    assert items[reply.id]["replied_post"]["reposted_post"] is None
    # The quote on the page still carries its own original.
    assert items[quote.id]["reposted_post"]["id"] == original.id


def test_feed_reply_to_deleted_and_hidden_parents(reads, factory):
    with factory() as session:
        author = make_user(session)
        hidden_author = make_user(session)
        deleted_parent = make_post(session, author, text="deleted parent")
        hidden_parent = make_post(session, hidden_author, text="hidden parent")
        to_deleted = reply_to(session, author, deleted_parent)
        to_hidden = reply_to(session, author, hidden_parent)
        like(session, author, to_deleted)
        like(session, author, to_hidden)
        delete_posts(session, deleted_parent)
        deactivate(session, hidden_author)

    items = items_by_id(reads.feed()["items"])

    # The replies' own visibility is unchanged: both are still in the feed.
    assert items[to_deleted.id]["replied_post"] is None
    assert items[to_deleted.id]["replied_post_deleted"] is True
    assert items[to_hidden.id]["replied_post"] is None
    assert items[to_hidden.id]["replied_post_deleted"] is False


# --- GET /feed/thread/{id} -------------------------------------------------------


def test_thread_replies_carry_the_root_and_the_root_carries_none(reads, factory):
    with factory() as session:
        author = make_user(session)
        viewer = make_user(session)
        root = make_post(session, author, text="root")
        first = reply_to(session, author, root, "first")
        second = reply_to(session, author, root, "second")
        like(session, viewer, root)

    body = reads.as_viewer(viewer).get(f"/feed/thread/{root.id}")

    _assert_not_a_reply(body["root"])
    assert [r["id"] for r in body["replies"]] == [first.id, second.id]
    for reply in body["replies"]:
        assert reply["replied_post_deleted"] is False
        nested = reply["replied_post"]
        assert nested["id"] == root.id
        assert nested["like_count"] == 1
        assert nested["liked_by_viewer"] is True
        assert nested["reply_count"] == 2
        assert nested["replied_post"] is None


def test_thread_of_a_reply_root_carries_its_parent_and_the_replies_carry_the_root(reads, factory):
    with factory() as session:
        author = make_user(session)
        grandparent = make_post(session, author, text="grandparent")
        root = reply_to(session, author, grandparent, "a reply as root")
        child = reply_to(session, author, root, "child")

    body = reads.get(f"/feed/thread/{root.id}")

    assert body["root"]["replied_post"]["id"] == grandparent.id
    [reply] = body["replies"]
    assert reply["id"] == child.id
    assert reply["replied_post"]["id"] == root.id
    # The root's copy inside the reply is cut; the root itself is not.
    assert reply["replied_post"]["replied_post"] is None


def test_thread_with_a_deleted_root_gives_its_replies_null_and_deleted_true(reads, factory):
    with factory() as session:
        author = make_user(session)
        root = make_post(session, author, text="root")
        reply = reply_to(session, author, root, "survivor")
        delete_posts(session, root)

    body = reads.get(f"/feed/thread/{root.id}")

    assert body["root"] is None
    assert body["root_deleted"] is True
    [item] = body["replies"]
    assert item["id"] == reply.id
    assert item["replied_post"] is None
    assert item["replied_post_deleted"] is True


# --- GET /feed/history -----------------------------------------------------------


def test_history_items_carry_the_fields(reads, factory):
    with factory() as session:
        viewer = make_user(session)
        other = make_user(session)
        own_post = make_post(session, viewer, text="own")
        root = make_post(session, other, text="their root")
        own_reply = reply_to(session, viewer, root, "own reply")
        like(session, viewer, root)

    reads.as_viewer(viewer)
    posts_tab = reads.get("/feed/history", tab="posts")["items"]
    replies_tab = reads.get("/feed/history", tab="replies")["items"]
    likes_tab = reads.get("/feed/history", tab="likes")["items"]

    assert own_post.id in [i["id"] for i in posts_tab]
    for item in posts_tab + likes_tab:
        _assert_not_a_reply(item)
    [reply_item] = replies_tab
    assert reply_item["id"] == own_reply.id
    assert reply_item["replied_post"]["id"] == root.id
    assert reply_item["replied_post"]["liked_by_viewer"] is True
    assert reply_item["replied_post_deleted"] is False


# --- GET /search/posts -------------------------------------------------------------


def test_search_posts_items_carry_the_fields(reads, factory):
    with factory() as session:
        author = make_user(session)
        root = make_post(session, author, text="the root about zebras")
        reply = reply_to(session, author, root, "a reply about zebras")
        gone = make_post(session, author, text="deleted parent")
        orphan = reply_to(session, author, gone, "another reply about zebras")
        delete_posts(session, gone)

    items = items_by_id(reads.get("/search/posts", q="zebras")["items"])

    assert set(items) == {root.id, reply.id, orphan.id}
    _assert_not_a_reply(items[root.id])
    assert items[reply.id]["replied_post"]["id"] == root.id
    assert items[reply.id]["replied_post"]["replied_post"] is None
    assert items[reply.id]["replied_post_deleted"] is False
    assert items[orphan.id]["replied_post"] is None
    assert items[orphan.id]["replied_post_deleted"] is True
