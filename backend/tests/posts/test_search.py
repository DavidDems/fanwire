"""Tests for app.posts.service.search_posts and the Post.search_vector
generated column/GIN index, per AGENTS.md TDD workflow and this unit's task
brief (wiki/CodeContext/Modules/0x07-search.md). Written before
Post.search_vector / search_posts exist.

Full-text search against to_tsvector('english', coalesce(text, '')),
queried with websearch_to_tsquery('english', :q) bound as a parameter
(never string-interpolated). Replies are included; posts whose author is
soft-deleted are excluded. Ordered by rank desc, then newest first.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

from app.db import Base, make_engine, make_session_factory
from app.posts.models import Post
from app.posts.service import search_posts
from app.users.models import User


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


def _make_user(session, **overrides) -> User:
    defaults = {
        "cognito_sub": f"sub-{overrides.get('username', 'u')}",
        "username": "post_search_user",
        "date_of_birth": date(1990, 1, 1),
    }
    defaults.update(overrides)
    user = User(**defaults)
    session.add(user)
    session.commit()
    return user


def _make_post(session, author, **overrides) -> Post:
    defaults = {"author_id": author.id, "text": "hello world"}
    defaults.update(overrides)
    post = Post(**defaults)
    session.add(post)
    session.commit()
    return post


def test_search_posts_matches_text(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="author_one")
        match = _make_post(session, author, text="the Celtics won last night")
        no_match = _make_post(session, author, text="unrelated content")

        results = search_posts(session, "celtics", limit=20, offset=0)

        assert [p.id for p in results] == [match.id]
        assert no_match.id not in [p.id for p in results]


def test_search_posts_includes_replies(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="author_two")
        root = _make_post(session, author, text="root basketball post")
        reply = Post(
            author_id=author.id,
            text="a basketball reply",
            is_reply=True,
            parent_post_id=root.id,
        )
        session.add(reply)
        session.commit()

        results = search_posts(session, "basketball", limit=20, offset=0)

        assert {p.id for p in results} == {root.id, reply.id}


def test_search_posts_excludes_soft_deleted_authors(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="deleted_author", deleted_at=datetime.now(UTC))
        _make_post(session, author, text="ghostly basketball content")

        results = search_posts(session, "ghostly", limit=20, offset=0)

        assert results == []


def test_search_posts_orders_by_rank_then_newest(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="order_author")
        base = datetime(2026, 1, 1, tzinfo=UTC)
        older = _make_post(session, author, text="basketball game", created_at=base)
        newer = _make_post(
            session, author, text="basketball game", created_at=base + timedelta(hours=1)
        )

        results = search_posts(session, "basketball", limit=20, offset=0)

        assert [p.id for p in results] == [newer.id, older.id]


def test_search_posts_respects_limit_and_offset(session_factory):
    with session_factory() as session:
        author = _make_user(session, username="page_author")
        posts = [
            _make_post(session, author, text=f"paginated basketball post {i}") for i in range(5)
        ]

        page1 = search_posts(session, "basketball", limit=2, offset=0)
        page2 = search_posts(session, "basketball", limit=2, offset=2)

        assert len(page1) == 2
        assert len(page2) == 2
        assert {p.id for p in page1}.isdisjoint({p.id for p in page2})
        assert len(posts) == 5


@pytest.mark.parametrize(
    "dangerous_query",
    ["'", ";", "--", ":*", "&|!()", "%", "post'; DROP TABLE posts; --"],
)
def test_search_posts_is_injection_safe(session_factory, dangerous_query):
    with session_factory() as session:
        author = _make_user(session, username="safe_post_author")
        _make_post(session, author, text="safe content")

        results = search_posts(session, dangerous_query, limit=20, offset=0)

        assert isinstance(results, list)
