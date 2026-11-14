"""POSTS-009: a reply's PostView carries the post it replies to, one level
deep, built by app.feed.views.assemble_post_views. Written before the
fields exist.

Mirrors POSTS-001's `reposted_post` and POSTS-004's `reposted_post_deleted`:
- `replied_post` is the parent's own view (its counts, its viewer flags) on
  a reply, null on every other post; `replied_post_deleted` is true only
  when the parent's owner deleted it.
- One level: the nested view's own `replied_post` is null, and so is its
  `reposted_post` -- except that a *plain* repost parent stands for its
  original (UI-009's card rule: a repost with no text and no media).
- A parent already on the page is built once, but the copy nested inside
  `replied_post` gets its own one-level cut; the page's copy keeps its own
  fields.

Route-level coverage (feed, thread, history, search) is
test_replied_post_routes.py; statement counts are
test_replied_post_queries.py.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from app.db import Base, make_engine, make_session_factory
from app.feed.views import PostView, assemble_post_views
from app.media.models import Media, MediaStatus
from tests.feed.replied_post_support import (
    deactivate,
    delete_posts,
    like,
    make_post,
    make_user,
    plain_repost,
    quote_repost,
    reply_to,
)

_CUT_FIELDS = {"replied_post", "replied_post_deleted", "reposted_post", "reposted_post_deleted"}


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


def _one(session, post, viewer_id=None) -> PostView:
    [view] = assemble_post_views(session, [post], viewer_id=viewer_id)
    return view


# --- the fields exist ---------------------------------------------------------


def test_post_view_declares_replied_post_and_replied_post_deleted():
    assert "replied_post" in PostView.model_fields
    assert "replied_post_deleted" in PostView.model_fields


def test_replied_post_is_nullable_and_replied_post_deleted_is_a_bool_in_the_schema():
    properties = PostView.model_json_schema()["$defs"]["PostView"]["properties"]
    replied = properties["replied_post"]
    assert {"type": "null"} in replied["anyOf"]
    assert properties["replied_post_deleted"]["type"] == "boolean"


# --- null and false on everything that is not a reply ------------------------


def test_non_replies_carry_null_replied_post_and_false_flag(session_factory):
    with session_factory() as session:
        author = make_user(session)
        top = make_post(session, author, text="top level")
        plain = plain_repost(session, author, top)
        quote = quote_repost(session, author, top, "quoted")

        views = assemble_post_views(session, [quote, plain, top], viewer_id=author.id)

        assert [v.id for v in views] == [quote.id, plain.id, top.id]
        for view in views:
            assert view.replied_post is None
            assert view.replied_post_deleted is False


def test_a_repost_of_a_reply_carries_no_replied_post_of_its_own(session_factory):
    """Only a reply row gets the field; a repost of a reply is not a reply."""
    with session_factory() as session:
        author = make_user(session)
        root = make_post(session, author, text="root")
        reply = reply_to(session, author, root)
        repost = quote_repost(session, author, reply, "quoting a reply")

        view = _one(session, repost)

        assert view.replied_post is None
        assert view.replied_post_deleted is False


# --- a reply carries its parent ------------------------------------------------


def test_reply_carries_the_parents_view_with_its_own_counts_and_viewer_flags(session_factory):
    with session_factory() as session:
        parent_author = make_user(session)
        viewer = make_user(session)
        other = make_user(session)
        parent = make_post(session, parent_author, text="the parent")
        reply = reply_to(session, other, parent, "the reply")
        reply_to(session, other, parent, "a second reply")
        like(session, viewer, parent)
        like(session, other, parent)
        plain_repost(session, viewer, parent)

        signed_in = _one(session, reply, viewer.id)
        guest = _one(session, reply)

        nested = signed_in.replied_post
        assert nested is not None
        assert nested.id == parent.id
        assert nested.text == "the parent"
        assert nested.author.id == parent_author.id
        assert nested.like_count == 2
        assert nested.liked_by_viewer is True
        assert nested.reply_count == 2
        assert nested.repost_count == 1
        assert nested.reposted_by_viewer is True
        assert signed_in.replied_post_deleted is False
        # The reply's own counts are the reply's, not the parent's.
        assert signed_in.like_count == 0
        assert signed_in.parent_post_id == parent.id

        assert guest.replied_post is not None
        assert guest.replied_post.like_count == 2
        assert guest.replied_post.liked_by_viewer is False
        assert guest.replied_post.reposted_by_viewer is False


def test_nested_parent_view_is_the_parents_own_standalone_view(session_factory):
    with session_factory() as session:
        author = make_user(session)
        viewer = make_user(session)
        parent = make_post(session, author, text="standalone")
        like(session, viewer, parent)
        reply = reply_to(session, viewer, parent)

        nested = _one(session, reply, viewer.id).replied_post
        standalone = _one(session, parent, viewer.id)

        assert nested == standalone


# --- one level deep ------------------------------------------------------------


def test_replied_post_of_a_reply_to_a_reply_is_cut_at_one_level(session_factory):
    with session_factory() as session:
        author = make_user(session)
        grandparent = make_post(session, author, text="grandparent")
        parent = reply_to(session, author, grandparent, "parent reply")
        reply = reply_to(session, author, parent, "grandchild reply")

        view = _one(session, reply)

        assert view.replied_post is not None
        assert view.replied_post.id == parent.id
        assert view.replied_post.is_reply is True
        assert view.replied_post.parent_post_id == grandparent.id
        assert view.replied_post.replied_post is None


def test_a_reply_to_a_quote_repost_carries_the_quote_with_reposted_post_cut(session_factory):
    with session_factory() as session:
        author = make_user(session)
        original = make_post(session, author, text="the original")
        quote = quote_repost(session, author, original, "my take")
        reply = reply_to(session, author, quote)

        view = _one(session, reply)

        assert view.replied_post is not None
        assert view.replied_post.id == quote.id
        assert view.replied_post.text == "my take"
        assert view.replied_post.is_repost is True
        assert view.replied_post.original_post_id == original.id
        assert view.replied_post.reposted_post is None
        assert view.replied_post.replied_post is None


def test_a_reply_to_a_plain_repost_carries_the_original_it_stands_for(session_factory):
    with session_factory() as session:
        original_author = make_user(session)
        reposter = make_user(session)
        viewer = make_user(session)
        original = make_post(session, original_author, text="the original")
        like(session, viewer, original)
        repost = plain_repost(session, reposter, original)
        reply = reply_to(session, viewer, repost)

        view = _one(session, reply, viewer.id)

        assert view.parent_post_id == repost.id  # the row is unchanged
        assert view.replied_post_deleted is False
        nested = view.replied_post
        assert nested is not None
        assert nested.id == original.id
        assert nested.text == "the original"
        assert nested.author.id == original_author.id
        assert nested.is_repost is False
        assert nested.liked_by_viewer is True
        assert nested.like_count == 1
        assert nested.repost_count == 1
        assert nested.reposted_post is None
        assert nested.replied_post is None


def test_a_plain_repost_parent_whose_original_is_a_reply_is_still_cut(session_factory):
    with session_factory() as session:
        author = make_user(session)
        root = make_post(session, author, text="root")
        original_reply = reply_to(session, author, root, "a reply worth reposting")
        repost = plain_repost(session, author, original_reply)
        reply = reply_to(session, author, repost)

        nested = _one(session, reply).replied_post

        assert nested is not None
        assert nested.id == original_reply.id
        assert nested.replied_post is None
        assert nested.reposted_post is None


def test_a_textless_repost_with_media_as_parent_is_a_quote_not_a_plain_repost(session_factory):
    """The card's rule (isPlainRepost): a repost with media has content of its
    own, so as a parent it is itself, with its reposted_post cut."""
    with session_factory() as session:
        author = make_user(session)
        original = make_post(session, author, text="the original")
        repost = plain_repost(session, author, original)
        session.add(
            Media(
                uploader_id=author.id,
                post_id=repost.id,
                status=MediaStatus.PROCESSED,
                s3_key_public="pub.jpg",
                s3_key_thumbnail="thumb.jpg",
            )
        )
        session.commit()
        reply = reply_to(session, author, repost)

        nested = _one(session, reply).replied_post

        assert nested is not None
        assert nested.id == repost.id
        assert [m.s3_key_public for m in nested.media] == ["pub.jpg"]
        assert nested.reposted_post is None


# --- deleted and hidden parents ----------------------------------------------


def test_a_reply_to_a_deleted_parent_carries_null_and_deleted_true(session_factory):
    with session_factory() as session:
        author = make_user(session)
        parent = make_post(session, author, text="gone")
        reply = reply_to(session, author, parent, "still here")
        delete_posts(session, parent)

        views = assemble_post_views(session, [reply], viewer_id=None)

        # The reply's own visibility is unchanged: it is still built.
        assert [v.id for v in views] == [reply.id]
        assert views[0].replied_post is None
        assert views[0].replied_post_deleted is True


def test_a_reply_to_a_parent_hidden_by_a_deactivated_author_carries_null_and_false(
    session_factory,
):
    with session_factory() as session:
        hidden_author = make_user(session)
        replier = make_user(session)
        parent = make_post(session, hidden_author, text="hidden")
        reply = reply_to(session, replier, parent)
        deactivate(session, hidden_author)

        views = assemble_post_views(session, [reply], viewer_id=None)

        assert [v.id for v in views] == [reply.id]
        assert views[0].replied_post is None
        assert views[0].replied_post_deleted is False


def test_a_reply_to_a_plain_repost_that_was_deleted_carries_null_and_deleted_true(
    session_factory,
):
    with session_factory() as session:
        author = make_user(session)
        original = make_post(session, author, text="the original")
        repost = plain_repost(session, author, original)
        reply = reply_to(session, author, repost)
        delete_posts(session, repost)

        view = _one(session, reply)

        assert view.replied_post is None
        assert view.replied_post_deleted is True


# --- a parent on the same page -----------------------------------------------


def test_a_parent_on_the_same_page_is_reused_but_the_nested_copy_has_its_own_cut(
    session_factory,
):
    """Page: [child, parent, quote]. `parent` replies to `quote`, which quotes
    `original`. The page's own `parent` view keeps its `replied_post` (the
    quote); the copy inside `child.replied_post` is cut. The page's `quote`
    view keeps its `reposted_post`; the copy inside `parent.replied_post` is
    cut."""
    with session_factory() as session:
        author = make_user(session)
        viewer = make_user(session)
        original = make_post(session, author, text="original")
        quote = quote_repost(session, author, original, "quote")
        parent = reply_to(session, author, quote, "parent reply")
        child = reply_to(session, author, parent, "child reply")
        like(session, viewer, parent)

        views = assemble_post_views(session, [child, parent, quote], viewer_id=viewer.id)
        by_id = {v.id: v for v in views}

        page_parent = by_id[parent.id]
        page_quote = by_id[quote.id]
        nested_parent = by_id[child.id].replied_post

        # The page's own views keep their one level.
        assert page_quote.reposted_post is not None
        assert page_quote.reposted_post.id == original.id
        assert page_parent.replied_post is not None
        assert page_parent.replied_post.id == quote.id
        assert page_parent.replied_post.reposted_post is None  # nested quote is cut

        # The nested copy of the page's parent is cut.
        assert nested_parent is not None
        assert nested_parent.id == parent.id
        assert nested_parent.replied_post is None
        assert nested_parent.liked_by_viewer is True
        assert nested_parent.like_count == 1
        assert nested_parent.model_dump(exclude=_CUT_FIELDS) == page_parent.model_dump(
            exclude=_CUT_FIELDS
        )


def test_page_order_does_not_change_the_cut(session_factory):
    """The parent before or after its child on the page gives the same views."""
    with session_factory() as session:
        author = make_user(session)
        root = make_post(session, author, text="root")
        parent = reply_to(session, author, root, "parent")
        child = reply_to(session, author, parent, "child")

        forward = assemble_post_views(session, [parent, child], viewer_id=None)
        backward = assemble_post_views(session, [child, parent], viewer_id=None)

        assert {v.id: v for v in forward} == {v.id: v for v in backward}
        page_parent = {v.id: v for v in forward}[parent.id]
        assert page_parent.replied_post is not None
        assert page_parent.replied_post.id == root.id


# --- Connection rule -------------------------------------------------------------

_SESSION_READS = {"execute", "scalars", "scalar", "query", "get"}
_POSTS_TABLE_MODELS = {"PostLike", "EventMention", "Report"}


@pytest.mark.parametrize(
    "source",
    sorted(
        path
        for path in (Path(__file__).resolve().parents[2] / "app" / "feed").glob("*.py")
        # routes.py's thread read predates this unit (session.get(Post, id) for
        # the root); this test pins that view assembly adds no direct read.
        if path.name != "routes.py"
    ),
    ids=lambda path: path.name,
)
def test_feed_view_assembly_reads_posts_only_through_posts_service(source):
    """0x00-architecture Connection rule: assemble_post_views gets parents
    through app.posts.service's public reads, never a query of posts'
    tables. No statement is built or run in feed/'s view code itself."""
    tree = ast.parse(source.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            assert not node.module.startswith("sqlalchemy") or {
                alias.name for alias in node.names
            } <= {"Session"}, f"{source.name}:{node.lineno} imports {node.module}"
            if node.module == "app.posts.models":
                assert not {alias.name for alias in node.names} & _POSTS_TABLE_MODELS
        if isinstance(node, ast.Import):
            assert not any(alias.name.startswith("sqlalchemy") for alias in node.names)
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "session"
        ):
            assert node.func.attr not in _SESSION_READS, f"{source.name}:{node.lineno}"
