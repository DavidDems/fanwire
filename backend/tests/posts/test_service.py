"""Tests for app.posts.service — plain functions operating on an injected
Session (report_post, like_post, unlike_post), per AGENTS.md TDD workflow.
Written before app/posts/service.py exists.

See wiki/CodeContext/Modules/0x03-posts.md "Report"/"PostLike" sections:
report_post is idempotent on (post_id, reporter_id), Post.reported flips
true only on the first Report row and never unsets, and PostReported is
published on every new (non-duplicate) Report row.
"""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import select

from app.db import Base, make_engine, make_session_factory
from app.eventbus import InMemoryEventPublisher, PostEventBus
from app.posts.models import Post, PostLike, Report
from app.posts.service import (
    POST_REPORTED,
    AlreadyLikedError,
    NotLikedError,
    PostNotFoundError,
    like_post,
    report_post,
    unlike_post,
)
from app.users.models import User


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


def _make_user(**overrides) -> User:
    defaults = {
        "cognito_sub": "sub-svc-1",
        "username": "svc_user_1",
        "date_of_birth": date(1990, 1, 1),
    }
    defaults.update(overrides)
    return User(**defaults)


def _seed_post(session, author) -> Post:
    post = Post(author_id=author.id, text="a post to report or like")
    session.add(post)
    session.commit()
    return post


# --- report_post ---


def test_report_post_first_report_sets_reported_and_publishes(session_factory):
    with session_factory() as session:
        author = _make_user(cognito_sub="sub-report-author", username="report_author")
        reporter = _make_user(cognito_sub="sub-report-1", username="reporter_one")
        session.add_all([author, reporter])
        session.commit()
        post = _seed_post(session, author)

        publisher = InMemoryEventPublisher()
        bus = PostEventBus(publisher)

        result = report_post(session, bus, post_id=post.id, reporter_id=reporter.id)

        assert result is not None
        fetched_post = session.scalar(select(Post).where(Post.id == post.id))
        assert fetched_post.reported is True

        event_names = [e.name for e in publisher.published]
        assert event_names == [POST_REPORTED]


def test_report_post_duplicate_is_a_no_op(session_factory):
    with session_factory() as session:
        author = _make_user(cognito_sub="sub-report-author-2", username="report_author_2")
        reporter = _make_user(cognito_sub="sub-report-2", username="reporter_two")
        session.add_all([author, reporter])
        session.commit()
        post = _seed_post(session, author)

        publisher = InMemoryEventPublisher()
        bus = PostEventBus(publisher)
        report_post(session, bus, post_id=post.id, reporter_id=reporter.id)

        result = report_post(session, bus, post_id=post.id, reporter_id=reporter.id)

        assert result is None
        event_names = [e.name for e in publisher.published]
        assert event_names == [POST_REPORTED]  # not published a second time

        reports = session.scalars(
            select(Report).where(Report.post_id == post.id, Report.reporter_id == reporter.id)
        ).all()
        assert len(reports) == 1


def test_report_post_second_different_reporter_still_creates_row_and_publishes(
    session_factory,
):
    with session_factory() as session:
        author = _make_user(cognito_sub="sub-report-author-3", username="report_author_3")
        reporter_one = _make_user(cognito_sub="sub-report-3a", username="reporter_three_a")
        reporter_two = _make_user(cognito_sub="sub-report-3b", username="reporter_three_b")
        session.add_all([author, reporter_one, reporter_two])
        session.commit()
        post = _seed_post(session, author)

        publisher = InMemoryEventPublisher()
        bus = PostEventBus(publisher)
        report_post(session, bus, post_id=post.id, reporter_id=reporter_one.id)

        result = report_post(session, bus, post_id=post.id, reporter_id=reporter_two.id)

        assert result is not None
        event_names = [e.name for e in publisher.published]
        assert event_names == [POST_REPORTED, POST_REPORTED]

        fetched_post = session.scalar(select(Post).where(Post.id == post.id))
        assert fetched_post.reported is True  # was already true, stays true


def test_report_post_raises_for_nonexistent_post(session_factory):
    with session_factory() as session:
        reporter = _make_user(cognito_sub="sub-report-4", username="reporter_four")
        session.add(reporter)
        session.commit()

        publisher = InMemoryEventPublisher()
        bus = PostEventBus(publisher)

        with pytest.raises(PostNotFoundError):
            report_post(session, bus, post_id=999_999, reporter_id=reporter.id)


# --- like_post / unlike_post ---


def test_like_post_creates_a_like_row(session_factory):
    with session_factory() as session:
        author = _make_user(cognito_sub="sub-like-author", username="like_author")
        liker = _make_user(cognito_sub="sub-like-1", username="liker_one")
        session.add_all([author, liker])
        session.commit()
        post = _seed_post(session, author)

        result = like_post(session, user_id=liker.id, post_id=post.id)

        assert result.user_id == liker.id
        assert result.post_id == post.id
        fetched = session.scalar(
            select(PostLike).where(PostLike.user_id == liker.id, PostLike.post_id == post.id)
        )
        assert fetched is not None


def test_like_post_raises_already_liked_error_on_duplicate(session_factory):
    with session_factory() as session:
        author = _make_user(cognito_sub="sub-like-author-2", username="like_author_2")
        liker = _make_user(cognito_sub="sub-like-2", username="liker_two")
        session.add_all([author, liker])
        session.commit()
        post = _seed_post(session, author)
        like_post(session, user_id=liker.id, post_id=post.id)

        with pytest.raises(AlreadyLikedError):
            like_post(session, user_id=liker.id, post_id=post.id)


def test_unlike_post_deletes_the_row(session_factory):
    with session_factory() as session:
        author = _make_user(cognito_sub="sub-like-author-3", username="like_author_3")
        liker = _make_user(cognito_sub="sub-like-3", username="liker_three")
        session.add_all([author, liker])
        session.commit()
        post = _seed_post(session, author)
        like_post(session, user_id=liker.id, post_id=post.id)

        unlike_post(session, user_id=liker.id, post_id=post.id)

        fetched = session.scalar(
            select(PostLike).where(PostLike.user_id == liker.id, PostLike.post_id == post.id)
        )
        assert fetched is None


def test_unlike_post_raises_not_liked_error(session_factory):
    with session_factory() as session:
        author = _make_user(cognito_sub="sub-like-author-4", username="like_author_4")
        liker = _make_user(cognito_sub="sub-like-4", username="liker_four")
        session.add_all([author, liker])
        session.commit()
        post = _seed_post(session, author)

        with pytest.raises(NotLikedError):
            unlike_post(session, user_id=liker.id, post_id=post.id)
