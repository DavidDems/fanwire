"""FEED-003: a viewer whose every follow is a deactivated account gets the
guest selection, as FEED-001 gives a viewer who follows nobody.

Root cause (traced from code): FollowsAndPreferredTeamStrategy decides
"follows nobody" from app.users.service.followed_user_ids, which returns
every Follow row, a deactivated followee's included. query_feed_posts then
hides that author's posts, so the viewer got only their own posts and their
team's: the thin feed FEED-001 was meant to remove.

Active means not soft-deleted (User.deleted_at IS NULL). Deactivation goes
through app.users.service.soft_delete_user, never a row delete: a deleted
row takes its Follow with it, and the test would pass for the wrong reason.

Same throwaway-app pattern as tests/feed/test_feed_new_account.py: only the
feed router, get_session and get_optional_current_user overridden.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_session
from app.events.models import Game, Team
from app.feed.routes import router
from app.feed.strategies import FollowsAndPreferredTeamStrategy, GuestRecentStrategy
from app.posts.models import EventMention, Post
from app.users.dependencies import get_optional_current_user
from app.users.models import Follow, User
from app.users.service import followed_user_ids, recover_user, soft_delete_user


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def app(session_factory):
    app = FastAPI()
    app.include_router(router)

    def _get_session_override():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = _get_session_override
    app.dependency_overrides[get_optional_current_user] = lambda: None
    return app


@pytest.fixture()
def client(app):
    return TestClient(app)


def _make_user(session, **overrides) -> User:
    defaults = {
        "cognito_sub": f"sub-{overrides.get('username', 'u')}",
        "username": "deactivated_follows_user",
        "date_of_birth": date(1990, 1, 1),
    }
    defaults.update(overrides)
    user = User(**defaults)
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


def _follow(session, follower: User, followed: User) -> None:
    session.add(Follow(follower_user_id=follower.id, followed_user_id=followed.id))
    session.commit()


def _make_team_game(session) -> tuple[Team, Game]:
    home = Team(
        nba_team_id=1610612901,
        name="Home",
        abbreviation="HOM",
        conference="Eastern",
        division="Atlantic",
    )
    away = Team(
        nba_team_id=1610612902,
        name="Away",
        abbreviation="AWY",
        conference="Western",
        division="Pacific",
    )
    session.add_all([home, away])
    session.commit()
    game = Game(
        nba_game_id=22500901,
        home_team_id=home.id,
        away_team_id=away.id,
        date=datetime(2026, 1, 1, tzinfo=UTC),
        season="2025-26",
        home_score=100,
        away_score=98,
    )
    session.add(game)
    session.commit()
    return home, game


def _feed_ids(client, app, viewer: User | None, **params) -> list[int]:
    app.dependency_overrides[get_optional_current_user] = lambda: viewer
    response = client.get("/feed", params=params)
    assert response.status_code == 200
    return [item["id"] for item in response.json()["items"]]


def _ids(posts: list[Post]) -> list[int]:
    return [p.id for p in posts]


def _deactivated_only_world(session, prefix: str, *, preferred_team_id: int | None = None):
    """A viewer who follows two users, both then deactivated (soft delete,
    the Follow rows kept); two unfollowed active users with posts; and the
    viewer's own post. Returns (viewer, unfollowed posts, viewer's post)."""
    viewer = _make_user(session, username=f"{prefix}_viewer", preferred_team_id=preferred_team_id)
    gone_a = _make_user(session, username=f"{prefix}_gone_a")
    gone_b = _make_user(session, username=f"{prefix}_gone_b")
    stranger_a = _make_user(session, username=f"{prefix}_stranger_a")
    stranger_b = _make_user(session, username=f"{prefix}_stranger_b")
    _follow(session, viewer, gone_a)
    _follow(session, viewer, gone_b)

    _make_post(session, gone_a, text="gone a's post")
    unfollowed = [_make_post(session, stranger_a, text="stranger a one")]
    _make_post(session, gone_b, text="gone b's post")
    unfollowed.append(_make_post(session, stranger_b, text="stranger b one"))
    own = _make_post(session, viewer, text="viewer's own post")
    unfollowed.append(_make_post(session, stranger_a, text="stranger a two"))

    soft_delete_user(session, gone_a.id)
    soft_delete_user(session, gone_b.id)
    # The trap: the follows still exist, so the viewer is not "follows nobody".
    assert sorted(followed_user_ids(session, viewer.id)) == sorted([gone_a.id, gone_b.id])
    return viewer, unfollowed, own


# --- 1: strategy level, deactivated-only follows -> guest selection ----------


@pytest.mark.parametrize(("before_id_from", "limit"), [(None, 20), (None, 2), ("top", 2)])
def test_deactivated_only_follows_select_what_the_guest_strategy_selects(
    session_factory, before_id_from, limit
):
    with session_factory() as session:
        viewer, unfollowed, own = _deactivated_only_world(session, f"do1_{limit}_{before_id_from}")
        guest_all = GuestRecentStrategy().select_posts(session, before_id=None, limit=50)
        before_id = guest_all[0].id if before_id_from == "top" else None

        selected = FollowsAndPreferredTeamStrategy(viewer.id, None).select_posts(
            session, before_id=before_id, limit=limit
        )
        guest = GuestRecentStrategy().select_posts(session, before_id=before_id, limit=limit)

        # The guest selection holds the unfollowed authors' posts; the
        # deactivated followees' posts are hidden from everyone.
        assert set(_ids(guest_all)) == {own.id, *_ids(unfollowed)}
        assert _ids(selected) == _ids(guest)
        assert guest  # the comparison is not between two empty pages


def test_deactivated_only_follows_include_unfollowed_authors_posts(session_factory):
    with session_factory() as session:
        viewer, unfollowed, own = _deactivated_only_world(session, "do1b")

        selected = FollowsAndPreferredTeamStrategy(viewer.id, None).select_posts(
            session, before_id=None, limit=20
        )

        assert _ids(selected) == sorted([own.id, *_ids(unfollowed)], reverse=True)


def test_deactivated_only_follows_with_a_preferred_team_still_get_the_guest_selection(
    session_factory,
):
    with session_factory() as session:
        home, game = _make_team_game(session)
        viewer, unfollowed, own = _deactivated_only_world(
            session, "do1t", preferred_team_id=home.id
        )
        team_fan = _make_user(session, username="do1t_team_fan")
        team_post = _make_post(session, team_fan, text="about the preferred team's game")
        session.add(EventMention(post_id=team_post.id, game_id=game.id, raw_token="#GameId"))
        session.commit()

        selected = FollowsAndPreferredTeamStrategy(viewer.id, home.id).select_posts(
            session, before_id=None, limit=20
        )
        guest = GuestRecentStrategy().select_posts(session, before_id=None, limit=20)

        assert _ids(guest) == sorted([own.id, team_post.id, *_ids(unfollowed)], reverse=True)
        assert _ids(selected) == _ids(guest)


# --- 2: GET /feed, deactivated-only follows -> guest feed ---------------------


def test_get_feed_for_deactivated_only_follows_equals_the_guest_feed(app, client, session_factory):
    with session_factory() as session:
        viewer, unfollowed, own = _deactivated_only_world(session, "do2")

    guest_ids = _feed_ids(client, app, None)
    viewer_ids = _feed_ids(client, app, viewer)

    assert guest_ids == sorted([own.id, *_ids(unfollowed)], reverse=True)
    assert viewer_ids == guest_ids


def test_get_feed_for_deactivated_only_follows_pages_like_the_guest_feed(
    app, client, session_factory
):
    with session_factory() as session:
        viewer, _unfollowed, _own = _deactivated_only_world(session, "do2p")

    guest_first = _feed_ids(client, app, None, limit=2)
    viewer_first = _feed_ids(client, app, viewer, limit=2)
    assert viewer_first == guest_first

    cursor = guest_first[-1]
    assert _feed_ids(client, app, viewer, limit=2, before_id=cursor) == _feed_ids(
        client, app, None, limit=2, before_id=cursor
    )


# --- 3: control, one active followee keeps the follows feed -------------------


def test_one_active_followee_beside_a_deactivated_one_keeps_the_follows_feed(
    app, client, session_factory
):
    with session_factory() as session:
        viewer = _make_user(session, username="do3_viewer")
        active = _make_user(session, username="do3_active")
        gone = _make_user(session, username="do3_gone")
        stranger = _make_user(session, username="do3_stranger")
        _follow(session, viewer, active)
        _follow(session, viewer, gone)

        active_post = _make_post(session, active, text="active followee's post")
        gone_post = _make_post(session, gone, text="deactivated followee's post")
        stranger_post = _make_post(session, stranger, text="unrelated author's post")
        own_post = _make_post(session, viewer, text="viewer's own post")
        soft_delete_user(session, gone.id)

        selected = FollowsAndPreferredTeamStrategy(viewer.id, None).select_posts(
            session, before_id=None, limit=20
        )

    expected = [own_post.id, active_post.id]
    assert _ids(selected) == expected
    assert stranger_post.id not in _ids(selected)
    assert gone_post.id not in _ids(selected)

    feed_ids = _feed_ids(client, app, viewer)
    assert feed_ids == expected
    assert stranger_post.id not in feed_ids


# --- 4: recovery, nothing cached ----------------------------------------------


def test_recovered_followee_brings_back_the_follows_feed(session_factory):
    with session_factory() as session:
        viewer = _make_user(session, username="do4_viewer")
        followee = _make_user(session, username="do4_followee")
        stranger = _make_user(session, username="do4_stranger")
        _follow(session, viewer, followee)

        followee_post = _make_post(session, followee, text="followee's post")
        stranger_post = _make_post(session, stranger, text="unrelated author's post")
        own_post = _make_post(session, viewer, text="viewer's own post")
        soft_delete_user(session, followee.id)

        strategy = FollowsAndPreferredTeamStrategy(viewer.id, None)
        while_deactivated = strategy.select_posts(session, before_id=None, limit=20)
        guest = GuestRecentStrategy().select_posts(session, before_id=None, limit=20)
        assert _ids(while_deactivated) == _ids(guest) == [own_post.id, stranger_post.id]

        recover_user(session, followee.id)

        after_recovery = strategy.select_posts(session, before_id=None, limit=20)

        assert _ids(after_recovery) == [own_post.id, followee_post.id]
        assert stranger_post.id not in _ids(after_recovery)


# --- 5: the users/ read the strategy decides on ---------------------------------


def test_active_followed_user_ids_returns_only_active_followees(session_factory):
    from app.users.service import active_followed_user_ids

    with session_factory() as session:
        viewer = _make_user(session, username="do5_viewer")
        active = _make_user(session, username="do5_active")
        gone = _make_user(session, username="do5_gone")
        not_followed = _make_user(session, username="do5_not_followed")
        _follow(session, viewer, active)
        _follow(session, viewer, gone)
        _follow(session, not_followed, viewer)  # the reverse direction is not a follow
        soft_delete_user(session, gone.id)

        assert sorted(active_followed_user_ids(session, viewer.id)) == [active.id]
        # followed_user_ids is unchanged: it still names the deactivated followee.
        assert sorted(followed_user_ids(session, viewer.id)) == sorted([active.id, gone.id])


def test_active_followed_user_ids_is_empty_when_every_followee_is_deactivated(
    session_factory,
):
    from app.users.service import active_followed_user_ids

    with session_factory() as session:
        viewer = _make_user(session, username="do5e_viewer")
        gone_a = _make_user(session, username="do5e_gone_a")
        gone_b = _make_user(session, username="do5e_gone_b")
        _follow(session, viewer, gone_a)
        _follow(session, viewer, gone_b)
        soft_delete_user(session, gone_a.id)
        soft_delete_user(session, gone_b.id)

        assert list(active_followed_user_ids(session, viewer.id)) == []
        assert sorted(followed_user_ids(session, viewer.id)) == sorted([gone_a.id, gone_b.id])
