"""POSTS-009: GET /feed includes a reply exactly when it has at least one
like -- for guests and signed-in viewers alike, under the same author,
mention and visibility rules as a top-level post, at its own id in the
newest-first order. Written before the rule exists.

The human's decision (2026-11-05, brief): any like counts, the author's
own included, because that is what `like_count` shows; a like moves
nothing, since the cursor is the post id. Top-level posts and reposts are
unchanged, liked or not. GET /feed/history, /feed/thread and search select
the same posts as before.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.db import Base, make_engine, make_session_factory
from app.events.models import Game, Team
from app.posts.models import EventMention
from tests.feed.replied_post_support import (
    ReadClient,
    deactivate,
    delete_posts,
    follow,
    items_by_id,
    like,
    make_post,
    make_user,
    plain_repost,
    quote_repost,
    reply_to,
    unlike,
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


def _viewers(session):
    """A guest, a signed-in viewer who follows nobody (gets the guest
    selection, FEED-001), as (label, user) pairs."""
    return [("guest", None), ("no_follows", make_user(session, "nofollow"))]


# --- in exactly when liked ---------------------------------------------------------


def test_a_liked_reply_is_in_the_feed_and_an_unliked_one_is_not(reads, factory):
    with factory() as session:
        author = make_user(session)
        liker = make_user(session)
        root = make_post(session, author, text="root")
        liked = reply_to(session, author, root, "liked reply")
        unliked = reply_to(session, author, root, "unliked reply")
        like(session, liker, liked)
        viewers = _viewers(session)

    for label, viewer in viewers:
        ids = reads.as_viewer(viewer).feed_ids()
        assert ids == [liked.id, root.id], label
        assert unliked.id not in ids, label


def test_a_liked_reply_sits_at_its_own_id_and_a_like_moves_nothing(reads, factory):
    with factory() as session:
        author = make_user(session)
        liker = make_user(session)
        older = make_post(session, author, text="older top")
        reply = reply_to(session, author, older, "reply")
        newer = make_post(session, author, text="newer top")
        # Liked after the newer post exists: it still sits below it.
        like(session, liker, reply)
        viewers = _viewers(session)

    for label, viewer in viewers:
        assert reads.as_viewer(viewer).feed_ids() == [newer.id, reply.id, older.id], label


def test_the_reply_item_reports_the_like_count_that_put_it_there(reads, factory):
    with factory() as session:
        author = make_user(session)
        root = make_post(session, author, text="root")
        reply = reply_to(session, author, root)
        likers = [make_user(session) for _ in range(3)]
        for liker in likers:
            like(session, liker, reply)

    items = reads.feed()["items"]

    # Three likes, one item: no row per like.
    assert [item["id"] for item in items].count(reply.id) == 1
    assert items_by_id(items)[reply.id]["like_count"] == 3
    for item in items:
        if item["is_reply"]:
            assert item["like_count"] >= 1


def test_the_authors_own_like_counts(reads, factory):
    with factory() as session:
        author = make_user(session)
        root = make_post(session, author, text="root")
        reply = reply_to(session, author, root, "self-liked")
        like(session, author, reply)

    assert reply.id in reads.feed_ids()
    assert reply.id in reads.as_viewer(author).feed_ids()


def test_a_reply_whose_last_like_is_removed_drops_out_on_the_next_read(reads, factory):
    with factory() as session:
        author = make_user(session)
        first = make_user(session)
        second = make_user(session)
        root = make_post(session, author, text="root")
        reply = reply_to(session, author, root)
        like(session, first, reply)
        like(session, second, reply)

    assert reply.id in reads.feed_ids()

    with factory() as session:
        unlike(session, first, reply)
    assert reply.id in reads.feed_ids()  # one like left

    with factory() as session:
        unlike(session, second, reply)
    assert reply.id not in reads.feed_ids()


def test_a_reply_liked_only_once_more_reappears(reads, factory):
    with factory() as session:
        author = make_user(session)
        liker = make_user(session)
        root = make_post(session, author, text="root")
        reply = reply_to(session, author, root)
        like(session, liker, reply)
        unlike(session, liker, reply)

    assert reply.id not in reads.feed_ids()

    with factory() as session:
        like(session, liker, reply)
    assert reply.id in reads.feed_ids()


# --- same visibility rules as a top-level post ------------------------------------


def test_liked_replies_follow_the_visibility_rules(reads, factory):
    with factory() as session:
        author = make_user(session)
        hidden_author = make_user(session)
        liker = make_user(session)
        root = make_post(session, author, text="root")
        deleted_reply = reply_to(session, author, root, "deleted")
        hidden_reply = reply_to(session, hidden_author, root, "hidden author")
        to_deleted_parent_root = make_post(session, author, text="soon deleted root")
        to_deleted_parent = reply_to(session, author, to_deleted_parent_root, "orphan")
        for reply in (deleted_reply, hidden_reply, to_deleted_parent):
            like(session, liker, reply)
        delete_posts(session, deleted_reply, to_deleted_parent_root)
        deactivate(session, hidden_author)
        viewers = _viewers(session)

    for label, viewer in viewers:
        ids = reads.as_viewer(viewer).feed_ids()
        assert deleted_reply.id not in ids, label
        assert hidden_reply.id not in ids, label
        # A reply's own visibility does not depend on its parent's.
        assert to_deleted_parent.id in ids, label
        assert to_deleted_parent_root.id not in ids, label


# --- signed-in viewer with follows: same author and mention rules ----------------


def _team_with_game(session) -> tuple[Team, Game]:
    home = Team(
        nba_team_id=1610612801,
        name="Home",
        abbreviation="HOM",
        conference="Eastern",
        division="Atlantic",
    )
    away = Team(
        nba_team_id=1610612802,
        name="Away",
        abbreviation="AWY",
        conference="Western",
        division="Pacific",
    )
    session.add_all([home, away])
    session.commit()
    game = Game(
        nba_game_id=8801,
        home_team_id=home.id,
        away_team_id=away.id,
        date=datetime(2026, 1, 1, tzinfo=UTC),
        season="2025-26",
        home_score=101,
        away_score=99,
    )
    session.add(game)
    session.commit()
    return home, game


def test_signed_in_viewer_with_follows_gets_liked_replies_under_the_author_rule(reads, factory):
    with factory() as session:
        followed = make_user(session, "followed")
        stranger = make_user(session, "stranger")
        viewer = make_user(session, "viewer")
        liker = make_user(session, "liker")
        follow(session, viewer, followed)

        root = make_post(session, stranger, text="stranger's root")
        followed_liked = reply_to(session, followed, root, "followed, liked")
        followed_unliked = reply_to(session, followed, root, "followed, unliked")
        stranger_liked = reply_to(session, stranger, root, "stranger, liked")
        own_liked = reply_to(session, viewer, root, "own, liked")
        own_unliked = reply_to(session, viewer, root, "own, unliked")
        for reply in (followed_liked, stranger_liked, own_liked):
            like(session, liker, reply)

    ids = reads.as_viewer(viewer).feed_ids()

    assert ids == [own_liked.id, followed_liked.id]
    for excluded in (followed_unliked, stranger_liked, own_unliked, root):
        assert excluded.id not in ids


def test_signed_in_viewer_gets_liked_replies_under_the_preferred_team_mention_rule(reads, factory):
    with factory() as session:
        team, game = _team_with_game(session)
        followed = make_user(session, "followed")
        stranger = make_user(session, "stranger")
        viewer = make_user(session, "viewer", preferred_team_id=team.id)
        liker = make_user(session, "liker")
        follow(session, viewer, followed)

        root = make_post(session, stranger, text="root")
        mentioning_liked = reply_to(session, stranger, root, "mentions the game, liked")
        mentioning_unliked = reply_to(session, stranger, root, "mentions the game, unliked")
        plain_liked = reply_to(session, stranger, root, "no mention, liked")
        for reply in (mentioning_liked, mentioning_unliked):
            session.add(EventMention(post_id=reply.id, game_id=game.id, raw_token="#GameId"))
        session.commit()
        for reply in (mentioning_liked, plain_liked):
            like(session, liker, reply)

    ids = reads.as_viewer(viewer).feed_ids()

    assert mentioning_liked.id in ids
    assert ids.count(mentioning_liked.id) == 1
    assert mentioning_unliked.id not in ids
    assert plain_liked.id not in ids


# --- top-level posts and reposts unchanged --------------------------------------


def test_top_level_posts_and_reposts_are_unchanged_liked_or_not(reads, factory):
    with factory() as session:
        author = make_user(session)
        likers = [make_user(session) for _ in range(2)]
        unliked_top = make_post(session, author, text="unliked top")
        liked_top = make_post(session, author, text="liked top")
        plain = plain_repost(session, author, unliked_top)
        quote = quote_repost(session, author, unliked_top, "quote")
        liked_quote = quote_repost(session, author, liked_top, "liked quote")
        for liker in likers:
            like(session, liker, liked_top)
            like(session, liker, liked_quote)
        viewers = [*_viewers(session), ("author", author)]

    expected = [liked_quote.id, quote.id, plain.id, liked_top.id, unliked_top.id]
    for label, viewer in viewers:
        assert reads.as_viewer(viewer).feed_ids() == expected, label


# --- pagination with liked replies mixed in --------------------------------------


def _mixed_timeline(session, *, eligible: int):
    """Interleaves top-level posts, liked replies (some liked twice, one by
    its own author), unliked replies and reposts until `eligible` posts
    would be in the feed. Returns the expected feed ids, newest first."""
    author = make_user(session, "mix")
    likers = [make_user(session, "mixliker") for _ in range(2)]
    expected: list[int] = []
    anchor = make_post(session, author, text="anchor")
    expected.append(anchor.id)
    step = 0
    while len(expected) < eligible:
        kind = step % 5
        if kind == 0:
            post = make_post(session, author, text=f"top {step}")
        elif kind == 1:
            post = reply_to(session, author, anchor, f"liked twice {step}")
            for liker in likers:
                like(session, liker, post)
        elif kind == 2:
            reply_to(session, author, anchor, f"unliked {step}")
            post = None
        elif kind == 3:
            post = plain_repost(session, author, anchor)
        else:
            post = reply_to(session, author, anchor, f"self-liked {step}")
            like(session, author, post)
        if post is not None:
            expected.append(post.id)
        step += 1
    return sorted(expected, reverse=True)


@pytest.mark.parametrize("eligible", [8, 9], ids=["short_last_page", "exact_multiple"])
def test_before_id_walk_neither_repeats_nor_skips_with_liked_replies(reads, factory, eligible):
    with factory() as session:
        expected = _mixed_timeline(session, eligible=eligible)
        viewers = _viewers(session)

    for label, viewer in viewers:
        ids, pages = reads.as_viewer(viewer).walk_feed(limit=3)

        assert ids == expected, label
        assert len(ids) == len(set(ids)), label
        for page in pages:
            items = page["items"]
            if len(items) == 3:
                # The full-page rule: the cursor is the last queried post's id.
                assert page["next_before_id"] == items[-1]["id"], label
            else:
                assert page["next_before_id"] is None, label
        if eligible % 3 == 0:
            assert pages[-1]["items"] == [], label


def test_liking_a_reply_on_a_later_page_between_reads_keeps_the_walk_ordered(reads, factory):
    """A like added mid-walk puts that reply at its own id: a later page
    picks it up if it is older than the cursor; nothing is repeated."""
    with factory() as session:
        author = make_user(session)
        liker = make_user(session)
        tops = [make_post(session, author, text=f"top {n}") for n in range(2)]
        old_reply = reply_to(session, author, tops[0], "old reply")
        more = [make_post(session, author, text=f"newer {n}") for n in range(3)]

    first = reads.feed(limit=2)
    assert [i["id"] for i in first["items"]] == [more[2].id, more[1].id]

    with factory() as session:
        like(session, liker, old_reply)

    rest_ids, _ = _walk_from(reads, first["next_before_id"], limit=2)
    walked = [i["id"] for i in first["items"]] + rest_ids
    assert walked == [more[2].id, more[1].id, more[0].id, old_reply.id, tops[1].id, tops[0].id]


def _walk_from(reads, before_id, *, limit):
    ids: list[int] = []
    pages = []
    params = {"limit": limit, "before_id": before_id}
    while True:
        body = reads.feed(**params)
        pages.append(body)
        ids.extend(item["id"] for item in body["items"])
        if body["next_before_id"] is None:
            return ids, pages
        params = {"limit": limit, "before_id": body["next_before_id"]}


def test_signed_in_walk_with_follows_neither_repeats_nor_skips(reads, factory):
    with factory() as session:
        followed = make_user(session, "followed")
        stranger = make_user(session, "stranger")
        viewer = make_user(session, "viewer")
        liker = make_user(session, "liker")
        follow(session, viewer, followed)
        expected = []
        root = make_post(session, followed, text="root")
        expected.append(root.id)
        for n in range(4):
            liked = reply_to(session, followed, root, f"liked {n}")
            like(session, liker, liked)
            expected.append(liked.id)
            reply_to(session, followed, root, f"unliked {n}")
            stranger_liked = reply_to(session, stranger, root, f"stranger {n}")
            like(session, liker, stranger_liked)
            top = make_post(session, followed, text=f"top {n}")
            expected.append(top.id)

    ids, pages = reads.as_viewer(viewer).walk_feed(limit=4)

    assert ids == sorted(expected, reverse=True)
    for page in pages[:-1]:
        assert len(page["items"]) == 4
        assert page["next_before_id"] == page["items"][-1]["id"]


# --- history, thread and search select the same posts ----------------------------


def test_history_thread_and_search_select_the_same_posts_liked_or_not(reads, factory):
    with factory() as session:
        viewer = make_user(session)
        other = make_user(session)
        root = make_post(session, other, text="root about giraffes")
        own_reply = reply_to(session, viewer, root, "own reply about giraffes")
        other_reply = reply_to(session, other, root, "other reply about giraffes")
        own_post = make_post(session, viewer, text="own post about giraffes")

    def selections():
        reads.as_viewer(viewer)
        return {
            "history": {
                tab: [i["id"] for i in reads.get("/feed/history", tab=tab)["items"]]
                for tab in ("posts", "replies", "likes", "reposts")
            },
            "thread": [r["id"] for r in reads.get(f"/feed/thread/{root.id}")["replies"]],
            "search": sorted(i["id"] for i in reads.get("/search/posts", q="giraffes")["items"]),
        }

    before = selections()
    assert before["thread"] == [own_reply.id, other_reply.id]
    assert before["history"]["replies"] == [own_reply.id]
    assert own_reply.id not in before["history"]["posts"]
    assert own_post.id in before["history"]["posts"]
    assert before["search"] == sorted([root.id, own_reply.id, other_reply.id, own_post.id])

    with factory() as session:
        like(session, other, own_reply)
        like(session, viewer, other_reply)
    after = selections()

    # Only the likes tab changes, because the viewer liked something.
    assert after["history"]["likes"] == [other_reply.id]
    after["history"]["likes"] = before["history"]["likes"]
    assert after == before
