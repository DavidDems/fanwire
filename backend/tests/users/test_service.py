"""Tests for users/ service functions, per AGENTS.md TDD workflow. Written
before app/users/service.py exists.

See wiki/CodeContext/Modules/0x01-users.md for User/Follow behavior
(soft-delete, follow/unfollow fail-fast rules).
"""

from datetime import date

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from testcontainers.postgres import PostgresContainer

from app.db import Base, make_engine, make_session_factory
from app.eventbus import InMemoryEventPublisher, PostEventBus
from app.users.models import Follow, User
from app.users.service import (
    USER_FOLLOWED,
    AlreadyFollowingError,
    NotFollowingError,
    SelfFollowError,
    UserNotFoundError,
    create_user,
    follow,
    soft_delete_user,
    unfollow,
)


@pytest.fixture(scope="module")
def postgres_url():
    with PostgresContainer("postgres:16-alpine") as pg:
        yield pg.get_connection_url().replace("psycopg2", "psycopg")


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


def _create(session, cognito_sub, username):
    return create_user(
        session,
        cognito_sub=cognito_sub,
        username=username,
        date_of_birth=date(1990, 1, 1),
    )


def test_create_user_persists_and_returns_the_row(session_factory):
    with session_factory() as session:
        user = create_user(
            session,
            cognito_sub="sub-1",
            username="alice",
            date_of_birth=date(1990, 1, 1),
            description="hi",
        )

        assert user.id is not None
        fetched = session.scalar(select(User).where(User.cognito_sub == "sub-1"))
        assert fetched is not None
        assert fetched.username == "alice"
        assert fetched.description == "hi"


def test_create_user_duplicate_cognito_sub_raises_integrity_error(session_factory):
    with session_factory() as session:
        _create(session, "dup-sub", "user_one")

        with pytest.raises(IntegrityError):
            _create(session, "dup-sub", "user_two")


def test_create_user_duplicate_username_raises_integrity_error(session_factory):
    with session_factory() as session:
        _create(session, "sub-a", "dup_username")

        with pytest.raises(IntegrityError):
            _create(session, "sub-b", "dup_username")


def test_soft_delete_user_sets_deleted_at(session_factory):
    with session_factory() as session:
        user = _create(session, "sub-c", "deleteme")

        soft_delete_user(session, user.id)

        fetched = session.scalar(select(User).where(User.id == user.id))
        assert fetched.deleted_at is not None


def test_soft_delete_user_raises_for_unknown_user(session_factory):
    with session_factory() as session, pytest.raises(UserNotFoundError):
        soft_delete_user(session, 999_999)


def test_soft_delete_user_raises_when_already_deleted(session_factory):
    with session_factory() as session:
        user = _create(session, "sub-d", "twice_deleted")
        soft_delete_user(session, user.id)

        with pytest.raises(UserNotFoundError):
            soft_delete_user(session, user.id)


def _event_bus():
    publisher = InMemoryEventPublisher()
    return PostEventBus(publisher), publisher


def test_follow_creates_a_follow_row(session_factory):
    with session_factory() as session:
        follower = _create(session, "sub-e", "follower_user")
        followed = _create(session, "sub-f", "followed_user")
        bus, _ = _event_bus()

        result = follow(
            session, event_bus=bus, follower_user_id=follower.id, followed_user_id=followed.id
        )

        assert result.follower_user_id == follower.id
        assert result.followed_user_id == followed.id
        fetched = session.scalar(
            select(Follow).where(
                Follow.follower_user_id == follower.id,
                Follow.followed_user_id == followed.id,
            )
        )
        assert fetched is not None


def test_follow_publishes_user_followed_on_success(session_factory):
    with session_factory() as session:
        follower = _create(session, "sub-e2", "follower_user_2")
        followed = _create(session, "sub-f2", "followed_user_2")
        bus, publisher = _event_bus()

        follow(session, event_bus=bus, follower_user_id=follower.id, followed_user_id=followed.id)

        event_names = [e.name for e in publisher.published]
        assert event_names == [USER_FOLLOWED]
        published_event = publisher.published[0]
        assert published_event.detail["follower_user_id"] == follower.id
        assert published_event.detail["followed_user_id"] == followed.id


def test_follow_raises_self_follow_error_without_touching_db(session_factory):
    with session_factory() as session:
        user = _create(session, "sub-g", "self_follower")
        bus, publisher = _event_bus()

        with pytest.raises(SelfFollowError):
            follow(session, event_bus=bus, follower_user_id=user.id, followed_user_id=user.id)

        assert publisher.published == []


def test_follow_raises_already_following_error(session_factory):
    with session_factory() as session:
        follower = _create(session, "sub-h", "follower_two")
        followed = _create(session, "sub-i", "followed_two")
        bus, publisher = _event_bus()
        follow(session, event_bus=bus, follower_user_id=follower.id, followed_user_id=followed.id)
        publisher.published.clear()

        with pytest.raises(AlreadyFollowingError):
            follow(
                session, event_bus=bus, follower_user_id=follower.id, followed_user_id=followed.id
            )

        assert publisher.published == []


def test_unfollow_deletes_the_row(session_factory):
    with session_factory() as session:
        follower = _create(session, "sub-j", "follower_three")
        followed = _create(session, "sub-k", "followed_three")
        bus, _ = _event_bus()
        follow(session, event_bus=bus, follower_user_id=follower.id, followed_user_id=followed.id)

        unfollow(session, follower_user_id=follower.id, followed_user_id=followed.id)

        fetched = session.scalar(
            select(Follow).where(
                Follow.follower_user_id == follower.id,
                Follow.followed_user_id == followed.id,
            )
        )
        assert fetched is None


def test_unfollow_raises_not_following_error(session_factory):
    with session_factory() as session:
        follower = _create(session, "sub-l", "follower_four")
        followed = _create(session, "sub-m", "followed_four")

        with pytest.raises(NotFollowingError):
            unfollow(session, follower_user_id=follower.id, followed_user_id=followed.id)
