"""Shared fixtures-as-functions for POSTS-006's read-side tests
(test_data_link_views.py, test_data_link_queries.py,
test_data_link_relevance.py): a post's sports-data attachment carried into
PostView as `data_link` and `data_link_preview`.

Plain functions, not pytest fixtures, as tests/events/players_support.py.
Linked posts are created through PublishPostFacade (the one create path),
so whatever the facade stores beside a link -- POSTS-006's
linked_line_game_id -- is stored here too, without a test naming the new
column.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import asdict
from datetime import date, datetime
from itertools import count
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app.dependencies import get_session
from app.eventbus import InMemoryEventPublisher, PostEventBus
from app.feed.routes import router as feed_router
from app.posts.data_link import DataLink
from app.posts.facade import CreatePostRequest, PublishPostFacade
from app.posts.moderation import ModerationCheck, ModerationContext
from app.search.routes import router as search_router
from app.users.dependencies import get_optional_current_user
from app.users.models import User

_usernames = count(1)


class PassThrough(ModerationCheck):
    def check(self, context: ModerationContext) -> None:
        pass


def make_user(session: Session, prefix: str = "dl", **attrs: Any) -> User:
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


def publish(
    session: Session,
    author_id: int,
    *,
    text: str | None = None,
    link: DataLink | None = None,
    **fields: Any,
) -> int:
    """Creates a post through PublishPostFacade; returns its id."""
    facade = PublishPostFacade(
        session=session,
        moderation_chain=PassThrough(),
        event_bus=PostEventBus(InMemoryEventPublisher()),
    )
    post = facade.publish(
        CreatePostRequest(author_id=author_id, text=text, data_link=link, **fields)
    )
    return post.id


def game_final(game_id: int) -> DataLink:
    return DataLink(type="game_final", ref_id=game_id)


def player_game(line_id: int) -> DataLink:
    return DataLink(type="player_game", ref_id=line_id)


def player_career(player_id: int, scope: str = "regular") -> DataLink:
    return DataLink(type="player_career", ref_id=player_id, scope=scope)  # type: ignore[arg-type]


def link_json(link: DataLink) -> dict[str, Any]:
    """The PostOut shape of a stored link."""
    return {"type": link.type, "ref_id": link.ref_id, "scope": link.scope}


def assert_preview(actual: dict[str, Any] | None, type_: str, preview: Any) -> None:
    """`actual` (a response's data_link_preview) is `type_` plus exactly
    the fields of the events/ preview dataclass `preview`, each equal to
    it (a datetime compared after parsing, a TeamRef as its dict)."""
    assert actual is not None
    expected = asdict(preview)
    assert set(actual) == {"type", *expected}, sorted(set(actual) ^ {"type", *expected})
    assert actual["type"] == type_
    for key, value in expected.items():
        got = actual[key]
        if isinstance(value, datetime):
            got = datetime.fromisoformat(got)
            if value.tzinfo is None and got.tzinfo is not None:
                got = got.replace(tzinfo=None)
        assert got == value, (key, got, value)


def read_client(session_factory: sessionmaker[Session], viewer: User | None = None) -> TestClient:
    """GET /feed, /feed/thread/{id} and /search/posts on one app, as `viewer`
    (a guest when None)."""
    app = FastAPI()
    app.include_router(feed_router)
    app.include_router(search_router)

    def _get_session_override() -> Iterator[Session]:
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = _get_session_override
    app.dependency_overrides[get_optional_current_user] = lambda: viewer
    return TestClient(app)
