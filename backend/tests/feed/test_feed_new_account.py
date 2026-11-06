"""FEED-001: a signed-in viewer who follows nobody sees the public guest feed.

Root cause (traced from code): strategy_for(viewer) gives every signed-in
viewer FollowsAndPreferredTeamStrategy, whose authors are only the viewer's
followed ids plus the viewer. A new account follows nobody, so its feed held
only its own posts, while a guest got GuestRecentStrategy (every eligible
top-level post). Account creation time was never involved.

Intended contract pinned here: a viewer with no follows gets exactly the
guest selection -- the same eligible posts, newest first, the same
visibility/deactivation rules and the same before_id pagination. A viewer who
follows at least one account keeps the follows + self + preferred-team feed;
that non-regression is already pinned by
tests/feed/test_routes.py::test_get_feed_authenticated_returns_personalized_feed
and tests/feed/test_strategies.py::
test_follows_and_preferred_team_strategy_includes_followed_authors_and_self,
so it is not duplicated here.

Same throwaway-app pattern as tests/feed/test_routes.py: only the feed router,
get_session and get_optional_current_user overridden.
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
from app.feed.strategies import GuestRecentStrategy, strategy_for
from app.posts.models import EventMention, Post
from app.users.dependencies import get_optional_current_user
from app.users.models import User

_LONG_AGO = datetime(2020, 1, 1, tzinfo=UTC)


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
        "username": "new_account_user",
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


def _feed_ids(client, app, viewer: User | None, **params) -> list[int]:
    app.dependency_overrides[get_optional_current_user] = lambda: viewer
    response = client.get("/feed", params=params)
    assert response.status_code == 200
    return [item["id"] for item in response.json()["items"]]


def _feed_page(client, app, viewer: User | None, **params) -> dict:
    app.dependency_overrides[get_optional_current_user] = lambda: viewer
    response = client.get("/feed", params=params)
    assert response.status_code == 200
    return response.json()


def _walk(client, app, viewer: User | None, limit: int) -> list[int]:
    ids: list[int] = []
    before_id = None
    for _ in range(50):  # bound: never loop forever on a broken cursor
        params = {"limit": limit}
        if before_id is not None:
            params["before_id"] = before_id
        page = _feed_page(client, app, viewer, **params)
        ids.extend(item["id"] for item in page["items"])
        before_id = page["next_before_id"]
        if before_id is None:
            return ids
    raise AssertionError("pagination did not terminate")


def _old_posts_by_others(session) -> list[Post]:
    """Two existing accounts with public posts dated long before any new account."""
    alice = _make_user(session, username="old_alice", created_at=_LONG_AGO)
    bob = _make_user(session, username="old_bob", created_at=_LONG_AGO)
    return [
        _make_post(session, alice, text="alice old", created_at=_LONG_AGO),
        _make_post(session, bob, text="bob old", created_at=_LONG_AGO),
        _make_post(session, alice, text="alice later", created_at=_LONG_AGO.replace(month=6)),
    ]


# --- 1 + 2: a brand-new account with no follows sees the guest feed -----


def test_new_account_with_no_follows_sees_the_same_posts_as_a_guest(app, client, session_factory):
    with session_factory() as session:
        old_posts = _old_posts_by_others(session)
        new_user = _make_user(session, username="brand_new", created_at=datetime.now(UTC))

    guest_ids = _feed_ids(client, app, None)
    new_user_ids = _feed_ids(client, app, new_user)

    assert guest_ids == [p.id for p in reversed(old_posts)]
    assert new_user_ids == guest_ids


def test_posts_older_than_the_new_account_are_not_excluded_by_account_age(
    app, client, session_factory
):
    with session_factory() as session:
        old_posts = _old_posts_by_others(session)
        new_user = _make_user(session, username="brand_new_age", created_at=datetime.now(UTC))
        assert all(p.created_at < new_user.created_at for p in old_posts)

    new_user_ids = _feed_ids(client, app, new_user)

    assert {p.id for p in old_posts} <= set(new_user_ids)


# --- 3: the new account's own post ---------------------------------------


def test_new_accounts_own_post_appears_in_its_feed_and_the_guest_feed(app, client, session_factory):
    with session_factory() as session:
        old_posts = _old_posts_by_others(session)
        new_user = _make_user(session, username="brand_new_author", created_at=datetime.now(UTC))
        own_post = _make_post(session, new_user, text="my first post")

    new_user_ids = _feed_ids(client, app, new_user)
    guest_ids = _feed_ids(client, app, None)

    assert own_post.id in new_user_ids
    assert own_post.id in guest_ids
    # Its own post sits on top of the guest selection, not instead of it.
    assert new_user_ids == [own_post.id, *[p.id for p in reversed(old_posts)]]
    assert new_user_ids == guest_ids


# --- 5: visibility and deactivation rules are not weakened ---------------


def test_no_follows_viewer_excludes_deactivated_authors_and_deleted_posts_like_a_guest(
    app, client, session_factory
):
    with session_factory() as session:
        live = _make_user(session, username="vis_live")
        deactivated = _make_user(session, username="vis_deactivated", deleted_at=datetime.now(UTC))
        visible = _make_post(session, live, text="visible")
        hidden_by_author = _make_post(session, deactivated, text="deactivated author's post")
        owner_deleted = _make_post(session, live, text="deleted", deleted_at=datetime.now(UTC))
        reply = _make_post(session, live, text="a reply", is_reply=True, parent_post_id=visible.id)
        new_user = _make_user(session, username="vis_new_viewer")

    guest_ids = _feed_ids(client, app, None)
    new_user_ids = _feed_ids(client, app, new_user)

    assert new_user_ids == guest_ids == [visible.id]
    for excluded in (hidden_by_author, owner_deleted, reply):
        assert excluded.id not in new_user_ids


# --- 6: stable pagination ---------------------------------------------------


def test_no_follows_viewer_pagination_matches_the_guest_walk(app, client, session_factory):
    with session_factory() as session:
        author = _make_user(session, username="page_author_nf", created_at=_LONG_AGO)
        posts = [
            _make_post(session, author, text=f"post {i}", created_at=_LONG_AGO) for i in range(7)
        ]
        new_user = _make_user(session, username="page_new_viewer")

    guest_walk = _walk(client, app, None, limit=3)
    new_user_walk = _walk(client, app, new_user, limit=3)

    expected = sorted((p.id for p in posts), reverse=True)
    assert guest_walk == expected
    assert new_user_walk == expected  # strictly descending, no repeats, no skips
    assert new_user_walk == guest_walk


def test_no_follows_viewer_first_page_sets_the_same_cursor_as_the_guest(
    app, client, session_factory
):
    with session_factory() as session:
        author = _make_user(session, username="cursor_author_nf")
        for i in range(5):
            _make_post(session, author, text=f"post {i}")
        new_user = _make_user(session, username="cursor_new_viewer")

    guest_page = _feed_page(client, app, None, limit=2)
    new_user_page = _feed_page(client, app, new_user, limit=2)

    assert guest_page["next_before_id"] is not None
    assert new_user_page["next_before_id"] == guest_page["next_before_id"]
    assert [i["id"] for i in new_user_page["items"]] == [i["id"] for i in guest_page["items"]]


# --- 7: an empty dataset stays empty ---------------------------------------


def test_no_follows_viewer_on_an_empty_dataset_gets_an_empty_page(app, client, session_factory):
    with session_factory() as session:
        new_user = _make_user(session, username="empty_new_viewer")

    page = _feed_page(client, app, new_user)

    assert page["items"] == []
    assert page["next_before_id"] is None


# --- 8: strategy level ------------------------------------------------------


def test_strategy_for_a_no_follows_viewer_selects_what_the_guest_strategy_selects(
    session_factory,
):
    with session_factory() as session:
        old_posts = _old_posts_by_others(session)
        new_user = _make_user(session, username="strategy_new_viewer")

        selected = strategy_for(new_user).select_posts(session, before_id=None, limit=20)
        guest = GuestRecentStrategy().select_posts(session, before_id=None, limit=20)

        assert [p.id for p in guest] == [p.id for p in reversed(old_posts)]
        assert [p.id for p in selected] == [p.id for p in guest]


# --- preferred team set, still no follows -----------------------------------


def test_no_follows_viewer_with_a_preferred_team_still_gets_the_guest_selection(
    app, client, session_factory
):
    with session_factory() as session:
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
            nba_game_id=22500801,
            home_team_id=home.id,
            away_team_id=away.id,
            date=datetime(2026, 1, 1, tzinfo=UTC),
            season="2025-26",
            home_score=100,
            away_score=98,
        )
        session.add(game)
        session.commit()

        stranger_a = _make_user(session, username="pt_stranger_a")
        stranger_b = _make_user(session, username="pt_stranger_b")
        unrelated_first = _make_post(session, stranger_a, text="unrelated one")
        team_post = _make_post(session, stranger_b, text="about the preferred team's game")
        session.add(EventMention(post_id=team_post.id, game_id=game.id, raw_token="#GameId"))
        session.commit()
        unrelated_last = _make_post(session, stranger_a, text="unrelated two")

        new_user = _make_user(session, username="pt_new_viewer", preferred_team_id=home.id)

    guest_ids = _feed_ids(client, app, None)
    new_user_ids = _feed_ids(client, app, new_user)

    assert guest_ids == [unrelated_last.id, team_post.id, unrelated_first.id]
    assert new_user_ids == guest_ids
