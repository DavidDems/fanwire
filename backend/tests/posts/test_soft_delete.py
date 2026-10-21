"""POSTS-004: an owner soft-deletes their own post (Post.deleted_at,
DELETE /posts/{id}), and a deleted post disappears from every read and
count, refuses every new interaction, and leaves a placeholder where a
surviving repost or thread references it. Written before the route, the
column or the new view fields exist.

Runs end to end on app.main's app, the harness of
tests/users/test_account_deactivation.py: only get_token_verifier
(FakeTokenVerifier, one identity at a time), get_session, get_event_bus and
get_moderation_chain are overridden, the chain with a pass-through so this
file tests deletion, not the spam scorer or the post rate limit. The event
publisher is kept so a test can tell nothing was published.

A post is deleted through DELETE /posts/{id} everywhere below, never by
writing the column: setting an attribute the model doesn't have yet would
be silently ignored, and a read test would then pass or fail for the wrong
reason. `Post.deleted_at` is only ever *read* here, inside test functions.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_event_bus, get_session
from app.eventbus import InMemoryEventPublisher, PostEventBus
from app.events.models import Game, Team
from app.main import app as main_app
from app.media.models import Media, MediaStatus
from app.notifications.models import Notification, NotificationType
from app.posts.dependencies import get_moderation_chain
from app.posts.models import EventMention, Post, PostLike, Report
from app.posts.moderation import ModerationCheck, ModerationContext
from app.users.auth import FakeTokenVerifier, VerifiedIdentity
from app.users.dependencies import get_token_verifier
from app.users.models import Follow, User
from app.users.service import create_user, soft_delete_user

TOKEN = {"Authorization": "Bearer unchanged-token"}
NOT_FOUND = {"detail": "Post not found"}
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
def publisher():
    return InMemoryEventPublisher()


@pytest.fixture()
def app(session_factory, publisher):
    saved = dict(main_app.dependency_overrides)

    def _get_session_override():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    main_app.dependency_overrides[get_session] = _get_session_override
    main_app.dependency_overrides[get_event_bus] = lambda: PostEventBus(publisher)
    main_app.dependency_overrides[get_moderation_chain] = lambda: _PassThrough()
    yield main_app
    main_app.dependency_overrides.clear()
    main_app.dependency_overrides.update(saved)


@pytest.fixture()
def client(app):
    return TestClient(app)


@dataclass(frozen=True)
class Person:
    id: int
    sub: str


def _person(session, name: str) -> Person:
    user = create_user(
        session, cognito_sub=f"sub-{name}", username=name, date_of_birth=date(1990, 1, 1)
    )
    return Person(id=user.id, sub=f"sub-{name}")


def _post(session, author: Person, **fields) -> int:
    post = Post(author_id=author.id, **fields)
    session.add(post)
    session.commit()
    return post.id


def _reply(session, author: Person, parent_id: int, text: str = "a reply") -> int:
    return _post(session, author, text=text, is_reply=True, parent_post_id=parent_id)


def _repost(session, author: Person, original_id: int, text: str | None = None) -> int:
    return _post(session, author, text=text, is_repost=True, original_post_id=original_id)


def _as(app, person: Person) -> None:
    app.dependency_overrides[get_token_verifier] = lambda: FakeTokenVerifier(
        VerifiedIdentity(sub=person.sub)
    )


def _delete(app, client, person: Person, post_id: int) -> None:
    """`person` deletes `post_id` through the route, which must succeed."""
    _as(app, person)
    response = client.delete(f"/posts/{post_id}", headers=TOKEN)
    assert response.status_code == 204, response.text


def _deleted_at(session_factory, post_id: int):
    with session_factory() as session:
        return session.scalar(select(Post.deleted_at).where(Post.id == post_id))


def _count(session_factory, model, *where) -> int:
    with session_factory() as session:
        return session.scalar(select(func.count()).select_from(model).where(*where))


def _seed_game(session) -> Game:
    home = Team(
        nba_team_id=501, name="Home", abbreviation="HOM", conference="Eastern", division="Atlantic"
    )
    away = Team(
        nba_team_id=502, name="Away", abbreviation="AWY", conference="Western", division="Pacific"
    )
    session.add_all([home, away])
    session.commit()
    game = Game(
        nba_game_id=5501,
        home_team_id=home.id,
        away_team_id=away.id,
        date=datetime(2026, 1, 1, tzinfo=UTC),
        season="2025-26",
        home_score=1,
        away_score=0,
    )
    session.add(game)
    session.commit()
    return game


def _feed(client, *, signed_in: bool) -> list[dict]:
    response = client.get("/feed", headers=TOKEN if signed_in else {})
    assert response.status_code == 200
    return response.json()["items"]


def _ids(items: list[dict]) -> list[int]:
    return [item["id"] for item in items]


def _thread(client, post_id: int):
    return client.get(f"/feed/thread/{post_id}")


# ------------------------------------------------------- DELETE /posts/{id}


def test_owner_delete_answers_204_and_sets_deleted_at(app, client, session_factory):
    with session_factory() as session:
        author = _person(session, "del_owner")
        post_id = _post(session, author, text="mine")
    _as(app, author)

    response = client.delete(f"/posts/{post_id}", headers=TOKEN)

    assert response.status_code == 204
    assert _deleted_at(session_factory, post_id) is not None


def test_owner_can_delete_a_reply_and_a_quote_repost(app, client, session_factory):
    with session_factory() as session:
        author = _person(session, "del_kinds")
        other = _person(session, "del_kinds_other")
        parent_id = _post(session, other, text="parent")
        reply_id = _reply(session, author, parent_id)
        quote_id = _repost(session, author, parent_id, text="my take")

    _delete(app, client, author, reply_id)
    _delete(app, client, author, quote_id)

    assert _deleted_at(session_factory, reply_id) is not None
    assert _deleted_at(session_factory, quote_id) is not None


def test_a_second_delete_answers_204_and_keeps_the_first_timestamp(app, client, session_factory):
    with session_factory() as session:
        author = _person(session, "del_twice")
        post_id = _post(session, author, text="twice")

    _delete(app, client, author, post_id)
    first = _deleted_at(session_factory, post_id)
    _delete(app, client, author, post_id)

    assert first is not None
    assert _deleted_at(session_factory, post_id) == first


def test_delete_cascades_nothing(app, client, session_factory):
    with session_factory() as session:
        author = _person(session, "del_cascade")
        other = _person(session, "del_cascade_other")
        game = _seed_game(session)
        post_id = _post(session, author, text="with everything")
        session.add_all(
            [
                PostLike(user_id=other.id, post_id=post_id),
                Report(post_id=post_id, reporter_id=other.id),
                EventMention(post_id=post_id, game_id=game.id, raw_token="#GameId5501"),
                Media(uploader_id=author.id, status=MediaStatus.PROCESSED, post_id=post_id),
            ]
        )
        session.commit()
        reply_id = _reply(session, other, post_id)
        plain_id = _repost(session, other, post_id)
        quote_id = _repost(session, other, post_id, text="quoted")

    _delete(app, client, author, post_id)

    assert _count(session_factory, Post, Post.id == post_id) == 1
    assert _count(session_factory, PostLike, PostLike.post_id == post_id) == 1
    assert _count(session_factory, Report, Report.post_id == post_id) == 1
    assert _count(session_factory, EventMention, EventMention.post_id == post_id) == 1
    assert _count(session_factory, Media, Media.post_id == post_id) == 1
    assert _count(session_factory, Post, Post.id.in_([reply_id, plain_id, quote_id])) == 3
    for survivor in (reply_id, plain_id, quote_id):
        assert _deleted_at(session_factory, survivor) is None


def test_delete_by_someone_else_answers_403_and_leaves_the_post(app, client, session_factory):
    with session_factory() as session:
        author = _person(session, "del_victim")
        intruder = _person(session, "del_intruder")
        post_id = _post(session, author, text="not yours")
    _as(app, intruder)

    response = client.delete(f"/posts/{post_id}", headers=TOKEN)

    assert response.status_code == 403
    assert _deleted_at(session_factory, post_id) is None


def test_delete_of_an_unknown_post_answers_404(app, client, session_factory):
    with session_factory() as session:
        author = _person(session, "del_unknown")
    _as(app, author)

    response = client.delete("/posts/987654", headers=TOKEN)

    assert response.status_code == 404


def test_delete_without_a_token_answers_401(app, client, session_factory):
    with session_factory() as session:
        author = _person(session, "del_no_token")
        post_id = _post(session, author, text="anonymous attempt")

    response = client.delete(f"/posts/{post_id}")

    assert response.status_code == 401
    assert _deleted_at(session_factory, post_id) is None


def test_delete_by_a_deactivated_author_answers_403_account_deactivated(
    app, client, session_factory
):
    with session_factory() as session:
        author = _person(session, "del_deactivated")
        post_id = _post(session, author, text="before deactivation")
        soft_delete_user(session, author.id)
    _as(app, author)

    response = client.delete(f"/posts/{post_id}", headers=TOKEN)

    assert response.status_code == 403
    assert response.json() == DEACTIVATED
    assert _deleted_at(session_factory, post_id) is None


def test_delete_of_the_callers_own_plain_repost_answers_409_and_changes_nothing(
    app, client, session_factory
):
    with session_factory() as session:
        reposter = _person(session, "del_plain")
        other = _person(session, "del_plain_other")
        original_id = _post(session, other, text="original")
        plain_id = _repost(session, reposter, original_id)
    _as(app, reposter)

    response = client.delete(f"/posts/{plain_id}", headers=TOKEN)

    assert response.status_code == 409
    assert _count(session_factory, Post, Post.id == plain_id) == 1
    assert _deleted_at(session_factory, plain_id) is None


def test_unrepost_still_hard_deletes_plain_reposts_of_a_soft_deleted_original(
    app, client, session_factory
):
    with session_factory() as session:
        reposter = _person(session, "unrepost_deleted")
        author = _person(session, "unrepost_deleted_author")
        original_id = _post(session, author, text="soon gone")
        plain_id = _repost(session, reposter, original_id)
    _delete(app, client, author, original_id)
    _as(app, reposter)

    response = client.delete(f"/posts/{original_id}/repost", headers=TOKEN)

    assert response.status_code == 204
    assert _count(session_factory, Post, Post.id == plain_id) == 0
    assert _count(session_factory, Post, Post.id == original_id) == 1


# ------------------------------------------------------------- visibility


def test_a_deleted_post_is_absent_from_the_guest_feed(app, client, session_factory):
    with session_factory() as session:
        author = _person(session, "vis_guest")
        gone_id = _post(session, author, text="gone")
        kept_id = _post(session, author, text="kept")
    _delete(app, client, author, gone_id)

    ids = _ids(_feed(client, signed_in=False))

    assert gone_id not in ids
    assert kept_id in ids


def test_a_deleted_post_is_absent_from_a_followers_feed(app, client, session_factory):
    with session_factory() as session:
        author = _person(session, "vis_followed")
        viewer = _person(session, "vis_follower")
        session.add(Follow(follower_user_id=viewer.id, followed_user_id=author.id))
        session.commit()
        gone_id = _post(session, author, text="gone")
        kept_id = _post(session, author, text="kept")
    _delete(app, client, author, gone_id)
    _as(app, viewer)

    ids = _ids(_feed(client, signed_in=True))

    assert gone_id not in ids
    assert kept_id in ids


def test_a_deleted_post_is_absent_from_its_authors_own_feed(app, client, session_factory):
    with session_factory() as session:
        author = _person(session, "vis_own")
        gone_id = _post(session, author, text="gone")
        kept_id = _post(session, author, text="kept")
    _delete(app, client, author, gone_id)

    ids = _ids(_feed(client, signed_in=True))  # still signed in as the author

    assert gone_id not in ids
    assert kept_id in ids


def test_a_deleted_post_is_absent_from_a_preferred_team_feed(app, client, session_factory):
    """The signed-in strategy's other branch: a stranger's post that
    mentions a game of the viewer's preferred team."""
    with session_factory() as session:
        game = _seed_game(session)
        stranger = _person(session, "vis_team_stranger")
        viewer = _person(session, "vis_team_viewer")
        session.get(User, viewer.id).preferred_team_id = game.home_team_id
        session.commit()
        gone_id = _post(session, stranger, text="gone #GameId5501")
        kept_id = _post(session, stranger, text="kept #GameId5501")
        for post_id in (gone_id, kept_id):
            session.add(EventMention(post_id=post_id, game_id=game.id, raw_token="#GameId5501"))
        session.commit()
    _as(app, viewer)
    assert gone_id in _ids(_feed(client, signed_in=True))
    _delete(app, client, stranger, gone_id)
    _as(app, viewer)

    ids = _ids(_feed(client, signed_in=True))

    assert gone_id not in ids
    assert kept_id in ids


def test_a_deleted_post_is_absent_from_search(app, client, session_factory):
    with session_factory() as session:
        author = _person(session, "vis_search")
        gone_id = _post(session, author, text="quixotrebound gone")
        kept_id = _post(session, author, text="quixotrebound kept")
    _delete(app, client, author, gone_id)

    response = client.get("/search/posts", params={"q": "quixotrebound"})

    assert response.status_code == 200
    ids = _ids(response.json()["items"])
    assert gone_id not in ids
    assert kept_id in ids


def test_a_deleted_reply_is_absent_from_get_replies(app, client, session_factory):
    with session_factory() as session:
        author = _person(session, "vis_replies")
        parent_id = _post(session, author, text="parent")
        gone_id = _reply(session, author, parent_id, "gone")
        kept_id = _reply(session, author, parent_id, "kept")
    _delete(app, client, author, gone_id)

    response = client.get(f"/posts/{parent_id}/replies")

    assert response.status_code == 200
    assert _ids(response.json()) == [kept_id]


def test_a_deleted_reply_is_absent_from_the_thread(app, client, session_factory):
    with session_factory() as session:
        author = _person(session, "vis_thread")
        parent_id = _post(session, author, text="parent")
        gone_id = _reply(session, author, parent_id, "gone")
        kept_id = _reply(session, author, parent_id, "kept")
    _delete(app, client, author, gone_id)

    response = _thread(client, parent_id)

    assert response.status_code == 200
    assert _ids(response.json()["replies"]) == [kept_id]


def test_get_post_answers_404_for_a_deleted_post(app, client, session_factory):
    with session_factory() as session:
        author = _person(session, "vis_get")
        post_id = _post(session, author, text="gone")
    assert client.get(f"/posts/{post_id}").status_code == 200
    _delete(app, client, author, post_id)

    response = client.get(f"/posts/{post_id}")

    assert response.status_code == 404
    assert response.json() == NOT_FOUND


# ----------------------------------------------------------------- counts


def test_reply_count_drops_by_exactly_the_deleted_replies(app, client, session_factory):
    with session_factory() as session:
        author = _person(session, "count_replies")
        other = _person(session, "count_replies_other")
        parent_id = _post(session, author, text="parent")
        first = _reply(session, other, parent_id, "one")
        second = _reply(session, other, parent_id, "two")
        _reply(session, other, parent_id, "three")
    assert _thread(client, parent_id).json()["root"]["reply_count"] == 3

    _delete(app, client, other, first)
    _delete(app, client, other, second)

    root = _thread(client, parent_id).json()["root"]
    assert root["reply_count"] == 1
    [feed_item] = [item for item in _feed(client, signed_in=False) if item["id"] == parent_id]
    assert feed_item["reply_count"] == 1


def test_repost_count_drops_by_exactly_the_deleted_reposts(app, client, session_factory):
    """A quote repost, and a text-less repost carrying media (not a plain
    repost, so DELETE /posts/{id} applies to it), both deleted; the plain
    repost and the other quote stay counted."""
    with session_factory() as session:
        author = _person(session, "count_reposts")
        other = _person(session, "count_reposts_other")
        original_id = _post(session, author, text="original")
        _repost(session, other, original_id)  # plain, stays
        _repost(session, other, original_id, text="kept quote")
        quote_id = _repost(session, other, original_id, text="deleted quote")
        media_repost_id = _repost(session, other, original_id)
        session.add(
            Media(uploader_id=other.id, status=MediaStatus.PROCESSED, post_id=media_repost_id)
        )
        session.commit()
    assert _thread(client, original_id).json()["root"]["repost_count"] == 4

    _delete(app, client, other, quote_id)
    _delete(app, client, other, media_repost_id)

    assert _thread(client, original_id).json()["root"]["repost_count"] == 2


# ----------------------------------------------- interactions on a deleted post


def _deleted_post(app, client, session_factory) -> dict:
    """An author's post, liked by `viewer` before the author deleted it;
    signed in as `viewer` afterwards. A helper, not a fixture, so a missing
    DELETE route fails the test rather than erroring its setup."""
    with session_factory() as session:
        author = _person(session, "gone_author")
        viewer = _person(session, "gone_viewer")
        post_id = _post(session, author, text="gone")
        session.add(PostLike(user_id=viewer.id, post_id=post_id))
        session.commit()
    _delete(app, client, author, post_id)
    _as(app, viewer)
    return {"author": author, "viewer": viewer, "post_id": post_id}


def test_like_of_a_deleted_post_answers_404_and_writes_nothing(app, client, session_factory):
    deleted = _deleted_post(app, client, session_factory)
    with session_factory() as session:
        stranger = _person(session, "gone_liker")
    _as(app, stranger)
    post_id = deleted["post_id"]

    response = client.post(f"/posts/{post_id}/like", headers=TOKEN)

    assert response.status_code == 404
    assert response.json() == NOT_FOUND
    assert _count(session_factory, PostLike, PostLike.post_id == post_id) == 1


def test_unlike_of_a_deleted_post_answers_404_and_writes_nothing(app, client, session_factory):
    deleted = _deleted_post(app, client, session_factory)
    post_id = deleted["post_id"]

    response = client.delete(f"/posts/{post_id}/like", headers=TOKEN)

    assert response.status_code == 404
    assert response.json() == NOT_FOUND
    assert (
        _count(
            session_factory,
            PostLike,
            PostLike.post_id == post_id,
            PostLike.user_id == deleted["viewer"].id,
        )
        == 1
    )


def test_repost_of_a_deleted_post_answers_404_and_writes_nothing(
    app, client, session_factory, publisher
):
    deleted = _deleted_post(app, client, session_factory)
    post_id = deleted["post_id"]
    posts_before = _count(session_factory, Post)
    events_before = len(publisher.published)

    response = client.post(f"/posts/{post_id}/repost", headers=TOKEN)

    assert response.status_code == 404
    assert response.json() == NOT_FOUND
    assert _count(session_factory, Post) == posts_before
    assert len(publisher.published) == events_before


def test_report_of_a_deleted_post_answers_404_and_writes_nothing(
    app, client, session_factory, publisher
):
    deleted = _deleted_post(app, client, session_factory)
    post_id = deleted["post_id"]
    events_before = len(publisher.published)

    response = client.post(f"/posts/{post_id}/report", headers=TOKEN)

    assert response.status_code == 404
    assert response.json() == NOT_FOUND
    assert _count(session_factory, Report, Report.post_id == post_id) == 0
    with session_factory() as session:
        assert session.get(Post, post_id).reported is False
    assert len(publisher.published) == events_before


@pytest.mark.parametrize(
    "body",
    [
        {"text": "replying", "is_reply": True, "parent_post_id": "TARGET"},
        {"text": "quoting", "is_repost": True, "original_post_id": "TARGET"},
    ],
    ids=["reply", "quote"],
)
def test_create_post_naming_a_deleted_post_answers_404_and_writes_nothing(
    app, client, session_factory, publisher, body
):
    deleted = _deleted_post(app, client, session_factory)
    post_id = deleted["post_id"]
    payload = {key: post_id if value == "TARGET" else value for key, value in body.items()}
    posts_before = _count(session_factory, Post)
    events_before = len(publisher.published)

    response = client.post("/posts", json=payload, headers=TOKEN)

    assert response.status_code == 404
    assert _count(session_factory, Post) == posts_before
    assert len(publisher.published) == events_before


def test_create_post_naming_an_unknown_parent_still_answers_400(app, client, session_factory):
    """The brief: an unknown id is still the FK's IntegrityError, a 400."""
    with session_factory() as session:
        author = _person(session, "unknown_parent")
    _as(app, author)

    response = client.post(
        "/posts",
        json={"text": "into the void", "is_reply": True, "parent_post_id": 987654},
        headers=TOKEN,
    )

    assert response.status_code == 400


# ------------------------------------------------ reposted_post_deleted placeholder


def _feed_item(client, post_id: int) -> dict:
    [item] = [item for item in _feed(client, signed_in=False) if item["id"] == post_id]
    return item


@pytest.mark.parametrize("quote_text", [None, "my quote"], ids=["plain", "quote"])
def test_a_repost_of_a_deleted_original_shows_the_placeholder(
    app, client, session_factory, quote_text
):
    with session_factory() as session:
        author = _person(session, "ph_author")
        reposter = _person(session, "ph_reposter")
        original_id = _post(session, author, text="original")
        repost_id = _repost(session, reposter, original_id, text=quote_text)
    assert _feed_item(client, repost_id)["reposted_post_deleted"] is False
    _delete(app, client, author, original_id)

    item = _feed_item(client, repost_id)

    assert item["reposted_post"] is None
    assert item["reposted_post_deleted"] is True


def test_reposted_post_deleted_is_false_on_every_other_view(app, client, session_factory):
    with session_factory() as session:
        author = _person(session, "ph_live_author")
        hidden = _person(session, "ph_hidden_author")
        reposter = _person(session, "ph_live_reposter")
        original_id = _post(session, author, text="live original")
        hidden_original_id = _post(session, hidden, text="hidden original")
        live_repost_id = _repost(session, reposter, original_id)
        hidden_repost_id = _repost(session, reposter, hidden_original_id, text="quoting hidden")
        plain_post_id = _post(session, reposter, text="just a post")
        soft_delete_user(session, hidden.id)

    items = {item["id"]: item for item in _feed(client, signed_in=False)}

    assert items[live_repost_id]["reposted_post"]["id"] == original_id
    assert items[live_repost_id]["reposted_post_deleted"] is False
    assert items[live_repost_id]["reposted_post"]["reposted_post_deleted"] is False
    # Hidden only because its author is deactivated: today's behaviour.
    assert items[hidden_repost_id]["reposted_post"] is None
    assert items[hidden_repost_id]["reposted_post_deleted"] is False
    assert items[plain_post_id]["reposted_post_deleted"] is False
    assert items[original_id]["reposted_post_deleted"] is False


# ------------------------------------------------------------------ thread


def test_the_thread_of_a_deleted_root_answers_200_with_its_surviving_replies(
    app, client, session_factory
):
    with session_factory() as session:
        author = _person(session, "th_author")
        other = _person(session, "th_other")
        root_id = _post(session, author, text="root")
        first = _reply(session, other, root_id, "first")
        gone = _reply(session, other, root_id, "gone")
        second = _reply(session, author, root_id, "second")
    _delete(app, client, other, gone)
    _delete(app, client, author, root_id)

    response = _thread(client, root_id)

    assert response.status_code == 200
    body = response.json()
    assert body["root"] is None
    assert body["root_deleted"] is True
    assert _ids(body["replies"]) == [first, second]


def test_the_thread_of_a_live_root_has_root_deleted_false(client, session_factory):
    with session_factory() as session:
        author = _person(session, "th_live")
        root_id = _post(session, author, text="root")
        reply_id = _reply(session, author, root_id)

    response = _thread(client, root_id)

    assert response.status_code == 200
    body = response.json()
    assert body["root"]["id"] == root_id
    assert body["root_deleted"] is False
    assert _ids(body["replies"]) == [reply_id]


def test_the_thread_of_an_unknown_post_is_still_404(client):
    assert _thread(client, 987654).status_code == 404


def test_the_thread_of_a_root_hidden_by_a_deactivated_author_is_still_404(client, session_factory):
    with session_factory() as session:
        author = _person(session, "th_hidden")
        other = _person(session, "th_hidden_other")
        root_id = _post(session, author, text="root")
        _reply(session, other, root_id)
        soft_delete_user(session, author.id)

    response = _thread(client, root_id)

    assert response.status_code == 404


# ----------------------------------------------------------- notifications


def test_notifications_leave_out_reply_and_repost_notifications_for_deleted_posts(
    app, client, session_factory
):
    with session_factory() as session:
        recipient = _person(session, "nt_recipient")
        actor = _person(session, "nt_actor")
        root_id = _post(session, recipient, text="root")
        live_reply = _reply(session, actor, root_id, "live")
        gone_reply = _reply(session, actor, root_id, "gone")
        live_quote = _repost(session, actor, root_id, text="live quote")
        gone_quote = _repost(session, actor, root_id, text="gone quote")

        def notify(kind: NotificationType, reference_id: int) -> int:
            row = Notification(
                recipient_user_id=recipient.id,
                type=kind,
                actor_user_id=actor.id,
                reference_id=reference_id,
            )
            session.add(row)
            session.commit()
            return row.id

        follow = notify(NotificationType.FOLLOW, actor.id)
        # A follow's reference_id is a user id; one that happens to equal a
        # deleted post's id must not be filtered.
        follow_colliding = notify(NotificationType.FOLLOW, gone_reply)
        kept_reply = notify(NotificationType.REPLY, live_reply)
        dropped_reply = notify(NotificationType.REPLY, gone_reply)
        kept_repost = notify(NotificationType.REPOST, live_quote)
        dropped_repost = notify(NotificationType.REPOST, gone_quote)
    _delete(app, client, actor, gone_reply)
    _delete(app, client, actor, gone_quote)
    _as(app, recipient)

    response = client.get("/notifications", headers=TOKEN)

    assert response.status_code == 200
    ids = {item["id"] for item in response.json()}
    assert ids == {follow, follow_colliding, kept_reply, kept_repost}
    assert dropped_reply not in ids
    assert dropped_repost not in ids


def test_notifications_learn_of_deleted_posts_through_a_posts_read_function():
    """notifications/ never reads posts.deleted_at itself (0x00-architecture
    Connection rule): no attribute or column named deleted_at is touched
    anywhere in its code (docstrings and comments may mention it)."""
    package = Path(__file__).resolve().parents[2] / "app" / "notifications"
    for source in package.glob("*.py"):
        tree = ast.parse(source.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            assert not (isinstance(node, ast.Attribute) and node.attr == "deleted_at"), (
                f"{source.name}:{node.lineno}"
            )
            assert not (
                isinstance(node, ast.Constant)
                and isinstance(node.value, str)
                and "deleted_at" in node.value
                and not _is_docstring(tree, node)
            ), f"{source.name}:{node.lineno}"


def _is_docstring(tree: ast.Module, node: ast.Constant) -> bool:
    for owner in ast.walk(tree):
        if isinstance(owner, ast.Module | ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef):
            body = owner.body
            if body and isinstance(body[0], ast.Expr) and body[0].value is node:
                return True
    return False


# ----------------------------------------------------------------- recovery


def test_recovery_never_brings_back_a_post_deleted_before_deactivation(
    app, client, session_factory
):
    with session_factory() as session:
        author = _person(session, "rec_author")
        gone_id = _post(session, author, text="deleted first")
        kept_id = _post(session, author, text="kept")
    _delete(app, client, author, gone_id)
    _as(app, author)
    assert client.delete("/users/me", headers=TOKEN).status_code == 204
    assert kept_id not in _ids(_feed(client, signed_in=False))

    assert client.post("/users/me/recover", headers=TOKEN).status_code == 200

    ids = _ids(_feed(client, signed_in=False))
    assert kept_id in ids
    assert gone_id not in ids
    assert client.get(f"/posts/{kept_id}").status_code == 200
    assert client.get(f"/posts/{gone_id}").status_code == 404
