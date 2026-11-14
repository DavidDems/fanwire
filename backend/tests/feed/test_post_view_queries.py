"""POSTS-001: building the views for a page stays batched. The number of
database statements for a page of 2 posts equals the number for a page of
20, reposts and their originals included -- counted with SQLAlchemy's
`before_cursor_execute`, the same way EVENTS-005's game-detail test does
(tests/events/test_game_detail.py).

Checked twice: once on assemble_post_views directly (the builder all three
read routes share) and once end to end through GET /feed for a signed-in
viewer. Both also assert that the reposts' `reposted_post` is actually
filled in, so an equal count cannot come from the field being absent.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_session
from app.feed.routes import router
from app.feed.views import assemble_post_views
from app.posts.models import Post
from app.posts.service import like_post
from app.users.dependencies import get_optional_current_user
from app.users.models import User


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


def _make_user(session, username: str) -> User:
    user = User(cognito_sub=f"sub-{username}", username=username, date_of_birth=date(1990, 1, 1))
    session.add(user)
    session.commit()
    return user


def _seed(session, *, reposts: int) -> tuple[User, list[int]]:
    """`reposts` originals by other authors, each liked, replied to and
    reposted by someone else, then a mix of plain and quote reposts of them
    by the viewer (the newest posts, so a feed page of the viewer's own
    posts is all reposts). Returns the viewer and the reposts' ids, newest
    first."""
    viewer = _make_user(session, f"q_viewer_{reposts}")
    other = _make_user(session, f"q_other_{reposts}")
    originals = []
    for n in range(reposts):
        author = _make_user(session, f"q_author_{reposts}_{n}")
        original = Post(author_id=author.id, text=f"original {n}")
        session.add(original)
        session.commit()
        session.add_all(
            [
                Post(author_id=other.id, text="reply", is_reply=True, parent_post_id=original.id),
                Post(author_id=other.id, is_repost=True, original_post_id=original.id),
            ]
        )
        session.commit()
        like_post(session, user_id=viewer.id, post_id=original.id)
        originals.append(original)

    repost_ids = []
    for n, original in enumerate(originals):
        repost = Post(
            author_id=viewer.id,
            text=f"quote {n}" if n % 2 else None,
            is_repost=True,
            original_post_id=original.id,
        )
        session.add(repost)
        session.commit()
        repost_ids.append(repost.id)
    return viewer, list(reversed(repost_ids))


def _record_statements(engine):
    statements: list[str] = []

    def _record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", _record)
    return statements, lambda: event.remove(engine, "before_cursor_execute", _record)


def _count_assemble(engine, session_factory, viewer_id, post_ids) -> int:
    with session_factory() as session:
        posts = [session.get(Post, post_id) for post_id in post_ids]
        statements, stop = _record_statements(engine)
        try:
            views = assemble_post_views(session, posts, viewer_id=viewer_id)
        finally:
            stop()
        assert [v.id for v in views] == list(post_ids)
        for view in views:
            assert view.reposted_post is not None
            assert view.reposted_post.reply_count == 1
            assert view.reposted_post.repost_count == 2
            assert view.reposted_post.liked_by_viewer is True
            assert view.reposted_post.reposted_by_viewer in (True, False)
    return len(statements)


def test_assemble_post_views_query_count_is_the_same_for_2_and_20_reposts(engine, session_factory):
    with session_factory() as session:
        viewer, repost_ids = _seed(session, reposts=20)
        viewer_id = viewer.id

    small = _count_assemble(engine, session_factory, viewer_id, repost_ids[:2])
    large = _count_assemble(engine, session_factory, viewer_id, repost_ids)

    assert large == small


def _feed_app(session_factory, viewer: User) -> FastAPI:
    app = FastAPI()
    app.include_router(router)

    def _get_session_override():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = _get_session_override
    app.dependency_overrides[get_optional_current_user] = lambda: viewer
    return app


def _count_feed(engine, client, limit) -> int:
    statements, stop = _record_statements(engine)
    try:
        response = client.get("/feed", params={"limit": limit})
    finally:
        stop()
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == limit
    for item in items:
        assert item["is_repost"] is True
        assert item["reposted_post"] is not None
        assert item["reposted_post"]["id"] == item["original_post_id"]
        assert item["reposted_post"]["reposted_post"] is None
    return len(statements)


def test_get_feed_query_count_is_the_same_for_a_page_of_2_and_of_20(engine, session_factory):
    with session_factory() as session:
        viewer, _ = _seed(session, reposts=20)
    client = TestClient(_feed_app(session_factory, viewer))

    small = _count_feed(engine, client, 2)
    large = _count_feed(engine, client, 20)

    assert large == small


# ------------------------------------------------ POSTS-004: with deletions
#
# The visibility predicate and the `reposted_post_deleted` flag must not add a
# statement per post. Posts are marked deleted with a bulk UPDATE of the
# column, so before POSTS-004's column exists this fails loudly instead of
# silently writing nothing.


def _soft_delete(session, post_ids) -> None:
    from sqlalchemy import update

    session.execute(update(Post).where(Post.id.in_(post_ids)).values(deleted_at=datetime.now(UTC)))
    session.commit()


def _seed_with_deletions(session) -> tuple[User, set[int]]:
    """_seed's 20 reposts by the viewer, every third original deleted, then
    five deleted posts of the viewer's own, each followed by a plain repost
    of one of the five newest originals (so a page of 20 is still full of
    live posts). Returns the viewer and the ids of
    the deleted originals."""
    viewer, repost_ids = _seed(session, reposts=20)
    originals = [session.get(Post, repost_id).original_post_id for repost_id in repost_ids]
    deleted_originals = set(originals[::3])
    own_deleted = []
    for n in range(5):
        post = Post(author_id=viewer.id, text=f"deleted own {n}")
        session.add(post)
        session.commit()
        own_deleted.append(post.id)
        # Plain, so the page of 2 holds a plain repost of a live original as
        # the page of 20 does: reposted_post_ids skips its media lookup when it
        # finds no candidates, which would make the two counts differ for a
        # reason that has nothing to do with deletion.
        repost = Post(author_id=viewer.id, is_repost=True, original_post_id=originals[n])
        session.add(repost)
        session.commit()
    _soft_delete(session, [*deleted_originals, *own_deleted])
    return viewer, deleted_originals


def _count_feed_with_deletions(engine, client, limit, deleted_originals) -> int:
    statements, stop = _record_statements(engine)
    try:
        response = client.get("/feed", params={"limit": limit})
    finally:
        stop()
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == limit
    assert any(item["original_post_id"] in deleted_originals for item in items)
    for item in items:
        assert item["is_repost"] is True
        if item["original_post_id"] in deleted_originals:
            assert item["reposted_post"] is None
            assert item["reposted_post_deleted"] is True
        else:
            assert item["reposted_post"]["id"] == item["original_post_id"]
            assert item["reposted_post_deleted"] is False
    return len(statements)


def test_get_feed_query_count_is_the_same_for_2_and_20_with_deleted_posts_and_originals(
    engine, session_factory
):
    with session_factory() as session:
        viewer, deleted_originals = _seed_with_deletions(session)
    client = TestClient(_feed_app(session_factory, viewer))

    small = _count_feed_with_deletions(engine, client, 2, deleted_originals)
    large = _count_feed_with_deletions(engine, client, 20, deleted_originals)

    assert large == small


def _seed_thread(session, *, replies: int, root_deleted: bool) -> int:
    """A root with `replies` live replies plus as many deleted ones again,
    each live reply liked; the root itself deleted when asked."""
    author = _make_user(session, f"t_author_{replies}_{root_deleted}")
    other = _make_user(session, f"t_other_{replies}_{root_deleted}")
    root = Post(author_id=author.id, text="root")
    session.add(root)
    session.commit()
    deleted = []
    for n in range(replies):
        live = Post(author_id=other.id, text=f"r{n}", is_reply=True, parent_post_id=root.id)
        gone = Post(author_id=other.id, text=f"g{n}", is_reply=True, parent_post_id=root.id)
        session.add_all([live, gone])
        session.commit()
        like_post(session, user_id=author.id, post_id=live.id)
        deleted.append(gone.id)
    if root_deleted:
        deleted.append(root.id)
    _soft_delete(session, deleted)
    return root.id


def _count_thread(engine, client, root_id, *, replies: int, root_deleted: bool) -> int:
    statements, stop = _record_statements(engine)
    try:
        response = client.get(f"/feed/thread/{root_id}")
    finally:
        stop()
    assert response.status_code == 200
    body = response.json()
    assert body["root_deleted"] is root_deleted
    assert (body["root"] is None) is root_deleted
    assert len(body["replies"]) == replies
    for reply in body["replies"]:
        assert reply["like_count"] == 1
    return len(statements)


@pytest.mark.parametrize("root_deleted", [False, True], ids=["live_root", "deleted_root"])
def test_get_thread_query_count_is_the_same_for_2_and_20_replies_with_deletions(
    engine, session_factory, root_deleted
):
    with session_factory() as session:
        viewer = _make_user(session, f"t_viewer_{root_deleted}")
        small_root = _seed_thread(session, replies=2, root_deleted=root_deleted)
        large_root = _seed_thread(session, replies=20, root_deleted=root_deleted)
    client = TestClient(_feed_app(session_factory, viewer))

    small = _count_thread(engine, client, small_root, replies=2, root_deleted=root_deleted)
    large = _count_thread(engine, client, large_root, replies=20, root_deleted=root_deleted)

    assert large == small
