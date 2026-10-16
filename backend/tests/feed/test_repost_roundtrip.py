"""POSTS-001: after a repost or an un-repost, the original's repost_count and
reposted_by_viewer in the next GET /feed, GET /feed/thread/{id} and
GET /search/posts response reflect it -- the end-to-end path the post
card's one-click toggle relies on. Written before the repost routes exist.

One throwaway FastAPI() with the posts, feed and search routers, the same
viewer signed in for all of them. The viewer follows the original's author,
so the original is in the viewer's personalized feed.
"""

from __future__ import annotations

from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_event_bus, get_session
from app.eventbus import InMemoryEventPublisher, PostEventBus
from app.feed.routes import router as feed_router
from app.posts.dependencies import get_moderation_chain
from app.posts.models import Post
from app.posts.moderation import ModerationCheck, ModerationContext
from app.posts.routes import router as posts_router
from app.search.routes import router as search_router
from app.users.dependencies import get_current_user, get_optional_current_user
from app.users.models import Follow, User


class NeverRejects(ModerationCheck):
    def check(self, context: ModerationContext) -> None:
        pass


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


def _make_user(session, username: str) -> User:
    user = User(cognito_sub=f"sub-{username}", username=username, date_of_birth=date(1990, 1, 1))
    session.add(user)
    session.commit()
    return user


@pytest.fixture()
def world(session_factory):
    with session_factory() as session:
        author = _make_user(session, "trip_author")
        viewer = _make_user(session, "trip_viewer")
        session.add(Follow(follower_user_id=viewer.id, followed_user_id=author.id))
        original = Post(author_id=author.id, text="zamboni highlight reel")
        session.add(original)
        session.commit()
    return {"author": author, "viewer": viewer, "original_id": original.id}


@pytest.fixture()
def client(session_factory, world):
    app = FastAPI()
    for router in (posts_router, feed_router, search_router):
        app.include_router(router)

    def _get_session_override():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    viewer = world["viewer"]
    app.dependency_overrides[get_session] = _get_session_override
    app.dependency_overrides[get_event_bus] = lambda: PostEventBus(InMemoryEventPublisher())
    app.dependency_overrides[get_moderation_chain] = lambda: NeverRejects()
    app.dependency_overrides[get_current_user] = lambda: viewer
    app.dependency_overrides[get_optional_current_user] = lambda: viewer
    return TestClient(app)


def _original_in_feed(client, original_id) -> dict:
    response = client.get("/feed")
    assert response.status_code == 200
    [item] = [i for i in response.json()["items"] if i["id"] == original_id]
    return item


def _original_in_thread(client, original_id) -> dict:
    response = client.get(f"/feed/thread/{original_id}")
    assert response.status_code == 200
    return response.json()["root"]


def _original_in_search(client, original_id) -> dict:
    response = client.get("/search/posts", params={"q": "zamboni"})
    assert response.status_code == 200
    [item] = [i for i in response.json()["items"] if i["id"] == original_id]
    return item


_READS = {
    "feed": _original_in_feed,
    "thread": _original_in_thread,
    "search": _original_in_search,
}


@pytest.mark.parametrize("read", sorted(_READS))
def test_repost_and_unrepost_show_in_the_next_read(client, world, read):
    original_id = world["original_id"]
    fetch = _READS[read]

    before = fetch(client, original_id)
    assert (before["repost_count"], before["reposted_by_viewer"]) == (0, False)

    assert client.post(f"/posts/{original_id}/repost").status_code == 201
    after_repost = fetch(client, original_id)
    assert (after_repost["repost_count"], after_repost["reposted_by_viewer"]) == (1, True)

    assert client.delete(f"/posts/{original_id}/repost").status_code == 204
    after_undo = fetch(client, original_id)
    assert (after_undo["repost_count"], after_undo["reposted_by_viewer"]) == (0, False)


def test_the_viewers_repost_appears_in_their_feed_carrying_the_original(client, world):
    original_id = world["original_id"]

    created = client.post(f"/posts/{original_id}/repost")
    assert created.status_code == 201

    items = client.get("/feed").json()["items"]
    [repost] = [i for i in items if i["id"] == created.json()["id"]]
    assert repost["is_repost"] is True
    assert repost["text"] is None
    assert repost["reposted_post"]["id"] == original_id
    assert repost["reposted_post"]["text"] == "zamboni highlight reel"
    assert repost["reposted_post"]["repost_count"] == 1
    assert repost["reposted_post"]["reposted_by_viewer"] is True
    assert repost["reposted_post"]["reposted_post"] is None


def test_a_reply_shows_in_reply_count_on_feed_thread_and_search(client, world):
    original_id = world["original_id"]

    reply = client.post(
        "/posts", json={"text": "great clip", "is_reply": True, "parent_post_id": original_id}
    )
    assert reply.status_code == 201

    for read in _READS.values():
        assert read(client, original_id)["reply_count"] == 1
