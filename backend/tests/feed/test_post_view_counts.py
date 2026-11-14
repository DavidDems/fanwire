"""POSTS-001: the counters, the viewer's repost flag and the reposted post on
every PostView, tested at app.feed.views.assemble_post_views -- the one
shared view builder GET /feed, GET /feed/thread/{id} and GET /search/posts
all go through. Written before any of it exists.

- reply_count: direct replies whose author is not soft-deleted.
- repost_count: reposts, plain and quote, whose author is not soft-deleted.
- reposted_by_viewer: the viewer has a *plain* repost of the post; false for
  an anonymous viewer.
- reposted_post: on a repost, the PostView of the post it reposts (with its
  own counts and viewer flags), one level deep; null everywhere else, and
  null when the original's author is soft-deleted.

The statement-count check (2 posts vs 20) is in test_post_view_queries.py.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest

from app.db import Base, make_engine, make_session_factory
from app.feed.views import PostView, assemble_post_views
from app.posts.models import Post
from app.posts.service import like_post
from app.users.models import User


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


def _make_user(session, username: str) -> User:
    user = User(
        cognito_sub=f"sub-{username}",
        username=username,
        date_of_birth=date(1990, 1, 1),
    )
    session.add(user)
    session.commit()
    return user


def _make_post(session, author, **overrides) -> Post:
    defaults = {"author_id": author.id, "text": "a post"}
    defaults.update(overrides)
    post = Post(**defaults)
    session.add(post)
    session.commit()
    return post


def _reply(session, author, parent, text="a reply") -> Post:
    return _make_post(session, author, text=text, is_reply=True, parent_post_id=parent.id)


def _plain_repost(session, author, original) -> Post:
    return _make_post(session, author, text=None, is_repost=True, original_post_id=original.id)


def _quote_repost(session, author, original, text="quoting") -> Post:
    return _make_post(session, author, text=text, is_repost=True, original_post_id=original.id)


def _soft_delete(session, user) -> None:
    user.deleted_at = datetime.now(UTC)
    session.commit()


def _view(session, post, viewer_id=None) -> PostView:
    [view] = assemble_post_views(session, [post], viewer_id=viewer_id)
    return view


# --------------------------------------------------------------- reply_count


def test_a_post_with_no_replies_or_reposts_has_zero_counts(session_factory):
    with session_factory() as session:
        author = _make_user(session, "zero_author")
        post = _make_post(session, author)

        view = _view(session, post)

        assert view.reply_count == 0
        assert view.repost_count == 0
        assert view.reposted_by_viewer is False
        assert view.reposted_post is None


def test_reply_count_counts_direct_replies_only(session_factory):
    with session_factory() as session:
        author = _make_user(session, "rc_author")
        replier = _make_user(session, "rc_replier")
        root = _make_post(session, author, text="root")
        first = _reply(session, replier, root, "first")
        _reply(session, author, root, "second")
        _reply(session, replier, first, "a grandchild, not a direct reply")

        root_view, first_view = assemble_post_views(session, [root, first], viewer_id=None)

        assert root_view.reply_count == 2
        assert first_view.reply_count == 1


def test_reply_count_excludes_replies_by_soft_deleted_authors(session_factory):
    with session_factory() as session:
        author = _make_user(session, "rcd_author")
        live = _make_user(session, "rcd_live")
        gone = _make_user(session, "rcd_gone")
        root = _make_post(session, author, text="root")
        _reply(session, live, root, "stays")
        _reply(session, gone, root, "author goes")
        _soft_delete(session, gone)

        assert _view(session, root).reply_count == 1


def test_reposts_are_not_counted_as_replies_and_replies_not_as_reposts(session_factory):
    with session_factory() as session:
        author = _make_user(session, "mix_author")
        other = _make_user(session, "mix_other")
        root = _make_post(session, author, text="root")
        _reply(session, other, root)
        _plain_repost(session, other, root)

        view = _view(session, root)

        assert view.reply_count == 1
        assert view.repost_count == 1


# -------------------------------------------------------------- repost_count


def test_repost_count_counts_plain_and_quote_reposts(session_factory):
    with session_factory() as session:
        author = _make_user(session, "rp_author")
        a = _make_user(session, "rp_a")
        b = _make_user(session, "rp_b")
        original = _make_post(session, author, text="original")
        _plain_repost(session, a, original)
        _plain_repost(session, b, original)
        _quote_repost(session, a, original, "a quote")

        assert _view(session, original).repost_count == 3


def test_repost_count_excludes_reposts_by_soft_deleted_authors(session_factory):
    with session_factory() as session:
        author = _make_user(session, "rpd_author")
        live = _make_user(session, "rpd_live")
        gone = _make_user(session, "rpd_gone")
        original = _make_post(session, author, text="original")
        _plain_repost(session, live, original)
        _plain_repost(session, gone, original)
        _quote_repost(session, gone, original, "gone quote")
        _soft_delete(session, gone)

        assert _view(session, original).repost_count == 1


def test_counts_are_per_post_across_a_page(session_factory):
    with session_factory() as session:
        author = _make_user(session, "page_author")
        other = _make_user(session, "page_other")
        busy = _make_post(session, author, text="busy")
        quiet = _make_post(session, author, text="quiet")
        _reply(session, other, busy)
        _reply(session, other, busy, "again")
        _plain_repost(session, other, busy)

        busy_view, quiet_view = assemble_post_views(session, [busy, quiet], viewer_id=None)

        assert (busy_view.reply_count, busy_view.repost_count) == (2, 1)
        assert (quiet_view.reply_count, quiet_view.repost_count) == (0, 0)


# -------------------------------------------------------- reposted_by_viewer


def test_reposted_by_viewer_is_true_when_the_viewer_has_a_plain_repost(session_factory):
    with session_factory() as session:
        author = _make_user(session, "rbv_author")
        viewer = _make_user(session, "rbv_viewer")
        original = _make_post(session, author, text="original")
        _plain_repost(session, viewer, original)

        assert _view(session, original, viewer.id).reposted_by_viewer is True


def test_reposted_by_viewer_is_false_for_a_quote_repost_only(session_factory):
    with session_factory() as session:
        author = _make_user(session, "rbq_author")
        viewer = _make_user(session, "rbq_viewer")
        original = _make_post(session, author, text="original")
        _quote_repost(session, viewer, original, "my take")

        view = _view(session, original, viewer.id)

        assert view.reposted_by_viewer is False
        assert view.repost_count == 1


def test_reposted_by_viewer_is_false_when_only_someone_else_reposted(session_factory):
    with session_factory() as session:
        author = _make_user(session, "rbo_author")
        viewer = _make_user(session, "rbo_viewer")
        other = _make_user(session, "rbo_other")
        original = _make_post(session, author, text="original")
        _plain_repost(session, other, original)

        assert _view(session, original, viewer.id).reposted_by_viewer is False


def test_reposted_by_viewer_is_false_for_an_anonymous_viewer(session_factory):
    with session_factory() as session:
        author = _make_user(session, "rba_author")
        reposter = _make_user(session, "rba_reposter")
        original = _make_post(session, author, text="original")
        _plain_repost(session, reposter, original)

        view = _view(session, original, None)

        assert view.reposted_by_viewer is False
        assert view.repost_count == 1


# ------------------------------------------------------------- reposted_post


def test_a_plain_repost_carries_the_original_as_reposted_post(session_factory):
    with session_factory() as session:
        author = _make_user(session, "orig_author")
        viewer = _make_user(session, "orig_viewer")
        other = _make_user(session, "orig_other")
        original = _make_post(session, author, text="the original")
        _reply(session, other, original)
        like_post(session, user_id=viewer.id, post_id=original.id)
        repost = _plain_repost(session, viewer, original)
        _plain_repost(session, other, original)

        view = _view(session, repost, viewer.id)

        inner = view.reposted_post
        assert isinstance(inner, PostView)
        assert inner.id == original.id
        assert inner.text == "the original"
        assert inner.author.id == author.id
        assert inner.author.username == "orig_author"
        assert inner.reply_count == 1
        assert inner.repost_count == 2
        assert inner.like_count == 1
        assert inner.liked_by_viewer is True
        assert inner.reposted_by_viewer is True
        assert inner.reposted_post is None


def test_a_quote_repost_carries_the_original_as_reposted_post(session_factory):
    with session_factory() as session:
        author = _make_user(session, "qorig_author")
        quoter = _make_user(session, "qorig_quoter")
        original = _make_post(session, author, text="quoted original")
        quote = _quote_repost(session, quoter, original, "hot take")

        view = _view(session, quote)

        assert view.text == "hot take"
        assert view.reposted_post is not None
        assert view.reposted_post.id == original.id
        assert view.reposted_post.text == "quoted original"


def test_reposted_post_is_one_level_deep(session_factory):
    """A plain repost of a quote repost: the outer view carries the quote,
    and the quote's own reposted_post is null even though the quote itself
    reposts something."""
    with session_factory() as session:
        author = _make_user(session, "deep_author")
        quoter = _make_user(session, "deep_quoter")
        reposter = _make_user(session, "deep_reposter")
        original = _make_post(session, author, text="bottom")
        quote = _quote_repost(session, quoter, original, "middle")
        repost = _plain_repost(session, reposter, quote)

        view = _view(session, repost)

        assert view.reposted_post is not None
        assert view.reposted_post.id == quote.id
        assert view.reposted_post.is_repost is True
        assert view.reposted_post.original_post_id == original.id
        assert view.reposted_post.reposted_post is None


def test_a_non_repost_has_null_reposted_post(session_factory):
    with session_factory() as session:
        author = _make_user(session, "nr_author")
        post = _make_post(session, author, text="plain")
        reply = _reply(session, author, post)

        post_view, reply_view = assemble_post_views(session, [post, reply], viewer_id=None)

        assert post_view.reposted_post is None
        assert reply_view.reposted_post is None


def test_reposted_post_is_null_when_the_originals_author_is_soft_deleted(session_factory):
    with session_factory() as session:
        author = _make_user(session, "sd_author")
        reposter = _make_user(session, "sd_reposter")
        original = _make_post(session, author, text="soon orphaned")
        repost = _plain_repost(session, reposter, original)
        _soft_delete(session, author)

        views = assemble_post_views(session, [repost], viewer_id=None)

        assert [v.id for v in views] == [repost.id]
        assert views[0].reposted_post is None


def test_reposted_post_in_a_page_with_its_original_also_present(session_factory):
    with session_factory() as session:
        author = _make_user(session, "both_author")
        reposter = _make_user(session, "both_reposter")
        original = _make_post(session, author, text="in the page too")
        repost = _plain_repost(session, reposter, original)

        repost_view, original_view = assemble_post_views(
            session, [repost, original], viewer_id=reposter.id
        )

        assert repost_view.reposted_post is not None
        assert repost_view.reposted_post.id == original.id
        assert repost_view.reposted_post.repost_count == 1
        assert repost_view.reposted_post.reposted_by_viewer is True
        assert original_view.repost_count == 1
        assert original_view.reposted_by_viewer is True
        assert original_view.reposted_post is None
