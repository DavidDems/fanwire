"""POSTS-009: building `replied_post` stays batched. The statement count for
a page of 2 posts equals that for a page of 20, with replies, their
parents and reposts mixed in -- counted with SQLAlchemy's
`before_cursor_execute`, as tests/feed/test_post_view_queries.py does for
POSTS-001's `reposted_post`.

The page of 2 is chosen so every conditional read fires in it as in the
page of 20: a plain repost by the viewer (reposted originals, the viewer's
plain-repost lookup and its media check) and a reply to someone's plain
repost (parents, and the plain repost's original behind them). The page of
20 adds replies to top-level posts, to quotes, to replies, to deleted and
to hidden parents, quotes, and a reply whose parent is on the page. Each
check also asserts the fields are filled, so an equal count cannot come
from `replied_post` being absent.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.db import Base, make_engine, make_session_factory
from app.feed.views import assemble_post_views
from app.posts.models import Post
from tests.feed.replied_post_support import (
    ReadClient,
    deactivate,
    delete_posts,
    like,
    make_post,
    make_user,
    plain_repost,
    quote_repost,
    reply_to,
)


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


def _record_statements(engine):
    statements: list[str] = []

    def _record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", _record)
    return statements, lambda: event.remove(engine, "before_cursor_execute", _record)


def _seed(session):
    """Returns (viewer, page ids newest first, expectations). Everything is
    liked by `liker` so a guest feed includes every reply, and the viewer
    follows nobody, so a signed-in feed is the same global selection
    (FEED-001). The two newest posts are the page of 2.

    `expectations` maps a reply's id to the replied_post id it must carry
    (None for a deleted or hidden parent) and replied_post_deleted."""
    viewer = make_user(session, "qviewer")
    liker = make_user(session, "qliker")
    others = [make_user(session, f"qauthor{n}") for n in range(4)]
    hidden_author = make_user(session, "qhidden")
    expectations: dict[int, tuple[int | None, bool]] = {}
    page: list[Post] = []

    def keep(post: Post) -> Post:
        like(session, liker, post)
        page.append(post)
        return post

    # The older 15: replies to every kind of parent, quotes and plain reposts.
    # Every top-level post and repost created here is in the feed, so the
    # page is exactly what the feed shows.
    extra = keep(make_post(session, others[3], text="top-level, not replied to"))
    for n in range(2):
        author = others[n % len(others)]
        top = keep(make_post(session, author, text=f"top {n}"))
        reply = keep(reply_to(session, others[(n + 1) % 4], top, f"reply to top {n}"))
        expectations[reply.id] = (top.id, False)

        quote = keep(quote_repost(session, author, top, f"quote {n}"))
        to_quote = keep(reply_to(session, author, quote, f"reply to quote {n}"))
        expectations[to_quote.id] = (quote.id, False)

        # A reply to a reply that is on the page (the reuse case).
        to_reply = keep(reply_to(session, author, reply, f"reply to reply {n}"))
        expectations[to_reply.id] = (reply.id, False)

        gone = make_post(session, author, text=f"deleted parent {n}")
        to_gone = keep(reply_to(session, author, gone, f"reply to deleted {n}"))
        expectations[to_gone.id] = (None, True)
        delete_posts(session, gone)

    to_extra = keep(reply_to(session, others[0], extra, "reply to the extra top"))
    expectations[to_extra.id] = (extra.id, False)
    keep(quote_repost(session, others[1], extra, "a quote nobody replied to"))

    hidden = make_post(session, hidden_author, text="hidden parent")
    to_hidden = keep(reply_to(session, others[0], hidden, "reply to hidden"))
    expectations[to_hidden.id] = (None, False)
    deactivate(session, hidden_author)

    original = keep(make_post(session, others[1], text="original behind a repost"))
    like(session, viewer, original)
    repost = keep(plain_repost(session, others[2], original))

    # The newest 2: the viewer's plain repost, and a reply to someone's plain repost.
    newest_repost = keep(plain_repost(session, viewer, original))
    newest_reply = keep(reply_to(session, others[3], repost, "reply to a plain repost"))
    expectations[newest_reply.id] = (original.id, False)

    ids = sorted((post.id for post in page), reverse=True)
    assert len(ids) == 20, len(ids)
    assert ids[:2] == [newest_reply.id, newest_repost.id]
    return viewer, ids, expectations


def _check(views_or_items, expectations) -> None:
    def get(v, key):
        return v[key] if isinstance(v, dict) else getattr(v, key)

    for view in views_or_items:
        expected = expectations.get(get(view, "id"))
        if expected is None:
            assert get(view, "replied_post") is None
            assert get(view, "replied_post_deleted") is False
            continue
        parent_id, deleted = expected
        nested = get(view, "replied_post")
        assert (None if nested is None else get(nested, "id")) == parent_id
        assert get(view, "replied_post_deleted") is deleted
        if nested is not None:
            assert get(nested, "replied_post") is None


def _count_assemble(engine, factory, viewer_id, post_ids, expectations) -> int:
    with factory() as session:
        posts = [session.get(Post, post_id) for post_id in post_ids]
        statements, stop = _record_statements(engine)
        try:
            views = assemble_post_views(session, posts, viewer_id=viewer_id)
        finally:
            stop()
    assert [v.id for v in views] == list(post_ids)
    _check(views, expectations)
    assert any(v.replied_post is not None for v in views)
    return len(statements)


def test_assemble_post_views_statement_count_is_the_same_for_2_and_20_with_replies(engine, factory):
    with factory() as session:
        viewer, ids, expectations = _seed(session)
        viewer_id = viewer.id

    small = _count_assemble(engine, factory, viewer_id, ids[:2], expectations)
    large = _count_assemble(engine, factory, viewer_id, ids, expectations)

    assert large == small


def _count_feed(engine, client: TestClient, limit, expectations, expected_ids) -> int:
    statements, stop = _record_statements(engine)
    try:
        response = client.get("/feed", params={"limit": limit})
    finally:
        stop()
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert [item["id"] for item in items] == expected_ids[:limit]
    _check(items, expectations)
    return len(statements)


@pytest.mark.parametrize("signed_in", [False, True], ids=["guest", "signed_in"])
def test_get_feed_statement_count_is_the_same_for_a_page_of_2_and_of_20_with_replies(
    engine, factory, signed_in
):
    with factory() as session:
        viewer, ids, expectations = _seed(session)
    reads = ReadClient(factory).as_viewer(viewer if signed_in else None)

    small = _count_feed(engine, reads.http, 2, expectations, ids)
    large = _count_feed(engine, reads.http, 20, expectations, ids)

    assert large == small
