"""Shared fixtures-as-functions for POSTS-009's tests (test_replied_post.py,
test_replied_post_routes.py, test_replied_post_queries.py,
test_feed_liked_replies.py): a reply's PostView carries its parent one
level deep, and GET /feed includes replies with at least one like.

Plain functions, not pytest fixtures, as data_link_support.py. Rows are
inserted directly (Post(...)), as tests/feed/test_post_view_queries.py
does, so a reply to a repost or to a deleted post can be built without the
create path's own rules getting in the way.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, date, datetime
from itertools import count
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.orm import Session, sessionmaker

from app.dependencies import get_session
from app.feed.routes import router as feed_router
from app.posts.models import Post
from app.posts.service import like_post, unlike_post
from app.search.routes import router as search_router
from app.users.dependencies import get_current_user, get_optional_current_user
from app.users.models import Follow, User

_usernames = count(1)


def make_user(session: Session, prefix: str = "rp", **attrs: Any) -> User:
    n = next(_usernames)
    user = User(
        cognito_sub=f"sub-{prefix}-{n}",
        username=f"{prefix}_{n}",
        date_of_birth=date(1990, 1, 1),
        **attrs,
    )
    session.add(user)
    session.commit()
    return user


def make_post(session: Session, author: User, **attrs: Any) -> Post:
    values: dict[str, Any] = {"author_id": author.id, "text": "a post"}
    values.update(attrs)
    post = Post(**values)
    session.add(post)
    session.commit()
    return post


def reply_to(session: Session, author: User, parent: Post, text: str = "a reply") -> Post:
    return make_post(session, author, text=text, is_reply=True, parent_post_id=parent.id)


def plain_repost(session: Session, author: User, original: Post) -> Post:
    return make_post(session, author, text=None, is_repost=True, original_post_id=original.id)


def quote_repost(session: Session, author: User, original: Post, text: str = "a quote") -> Post:
    return make_post(session, author, text=text, is_repost=True, original_post_id=original.id)


def like(session: Session, user: User, post: Post) -> None:
    like_post(session, user_id=user.id, post_id=post.id)


def unlike(session: Session, user: User, post: Post) -> None:
    unlike_post(session, user_id=user.id, post_id=post.id)


def follow(session: Session, follower: User, followed: User) -> None:
    session.add(Follow(follower_user_id=follower.id, followed_user_id=followed.id))
    session.commit()


def delete_posts(session: Session, *posts: Post) -> None:
    """The owner's delete (POSTS-004): the row stays, deleted_at is set."""
    session.execute(
        update(Post)
        .where(Post.id.in_([post.id for post in posts]))
        .values(deleted_at=datetime.now(UTC))
    )
    session.commit()


def deactivate(session: Session, user: User) -> None:
    """A soft-deleted (deactivated) account: its posts are hidden, not deleted."""
    session.execute(update(User).where(User.id == user.id).values(deleted_at=datetime.now(UTC)))
    session.commit()


class ReadClient:
    """GET /feed, /feed/thread, /feed/history and /search/posts on one
    throwaway app, as a chosen viewer (None is a guest)."""

    def __init__(self, factory: sessionmaker[Session]) -> None:
        self.app = FastAPI()
        self.app.include_router(feed_router)
        self.app.include_router(search_router)

        def session_override() -> Iterator[Session]:
            session = factory()
            try:
                yield session
            finally:
                session.close()

        self.app.dependency_overrides[get_session] = session_override
        self.as_viewer(None)
        self.http = TestClient(self.app)

    def as_viewer(self, viewer: User | None) -> ReadClient:
        self.app.dependency_overrides[get_optional_current_user] = lambda: viewer
        if viewer is not None:
            self.app.dependency_overrides[get_current_user] = lambda: viewer
        else:
            self.app.dependency_overrides.pop(get_current_user, None)
        return self

    def get(self, path: str, **params: Any) -> Any:
        response = self.http.get(path, params=params)
        assert response.status_code == 200, response.text
        return response.json()

    def feed(self, **params: Any) -> dict[str, Any]:
        return self.get("/feed", **params)

    def feed_ids(self, **params: Any) -> list[int]:
        return [item["id"] for item in self.feed(**params)["items"]]

    def walk_feed(self, *, limit: int) -> tuple[list[int], list[dict[str, Any]]]:
        """Every page of GET /feed through before_id: the ids in order, and
        each page's body."""
        ids: list[int] = []
        pages: list[dict[str, Any]] = []
        params: dict[str, Any] = {"limit": limit}
        for _ in range(100):
            body = self.feed(**params)
            pages.append(body)
            ids.extend(item["id"] for item in body["items"])
            if body["next_before_id"] is None:
                return ids, pages
            params = {"limit": limit, "before_id": body["next_before_id"]}
        raise AssertionError("GET /feed never returned a null next_before_id")


def items_by_id(items: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    return {item["id"]: item for item in items}
