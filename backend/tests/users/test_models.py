"""Round-trip tests for the users/ models against a real Postgres, per
AGENTS.md TDD workflow. Written before app/users/models.py exists.

See wiki/CodeContext/Modules/0x01-users.md for the User/Follow schema.
"""

from datetime import date

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db import Base, make_engine, make_session_factory
from app.events.models import Team
from app.media.models import Media
from app.users.models import Follow, User


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


def _make_user(**overrides):
    defaults = {
        "cognito_sub": "sub-1",
        "username": "alice",
        "date_of_birth": date(1990, 1, 1),
    }
    defaults.update(overrides)
    return User(**defaults)


def test_user_round_trip(session_factory):
    with session_factory() as session:
        user = _make_user()
        session.add(user)
        session.commit()

        fetched = session.scalar(select(User).where(User.cognito_sub == "sub-1"))
        assert fetched is not None
        assert fetched.username == "alice"
        assert fetched.date_of_birth == date(1990, 1, 1)
        assert fetched.description is None
        assert fetched.preferred_team_id is None
        assert fetched.profile_picture_media_id is None
        assert fetched.deleted_at is None
        assert fetched.created_at is not None
        assert fetched.updated_at is not None


def test_user_cognito_sub_is_unique(session_factory):
    with session_factory() as session:
        session.add(_make_user(cognito_sub="dup-sub", username="user_one"))
        session.commit()

        session.add(_make_user(cognito_sub="dup-sub", username="user_two"))
        with pytest.raises(IntegrityError):
            session.commit()


def test_user_username_is_unique(session_factory):
    with session_factory() as session:
        session.add(_make_user(cognito_sub="sub-a", username="dup_username"))
        session.commit()

        session.add(_make_user(cognito_sub="sub-b", username="dup_username"))
        with pytest.raises(IntegrityError):
            session.commit()


def test_user_preferred_team_id_requires_existing_team(session_factory):
    with session_factory() as session:
        session.add(
            _make_user(cognito_sub="sub-c", username="bad_team_user", preferred_team_id=999_999)
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_user_preferred_team_id_resolves_to_a_real_team(session_factory):
    with session_factory() as session:
        team = Team(
            api_sports_team_id=12,
            name="Boston Celtics",
            abbreviation="BOS",
            conference="Eastern",
            division="Atlantic",
        )
        session.add(team)
        session.commit()

        user = _make_user(cognito_sub="sub-d", username="team_user", preferred_team_id=team.id)
        session.add(user)
        session.commit()

        fetched = session.scalar(select(User).where(User.cognito_sub == "sub-d"))
        assert fetched.preferred_team_id == team.id


def test_user_profile_picture_media_id_requires_existing_media(session_factory):
    with session_factory() as session:
        session.add(
            _make_user(
                cognito_sub="sub-j", username="bad_media_user", profile_picture_media_id=999_999
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_user_profile_picture_media_id_resolves_to_a_real_media(session_factory):
    with session_factory() as session:
        uploader = _make_user(cognito_sub="sub-k", username="media_owner_user")
        session.add(uploader)
        session.commit()

        media = Media(uploader_id=uploader.id)
        session.add(media)
        session.commit()

        user = _make_user(
            cognito_sub="sub-l", username="pfp_user", profile_picture_media_id=media.id
        )
        session.add(user)
        session.commit()

        fetched = session.scalar(select(User).where(User.cognito_sub == "sub-l"))
        assert fetched.profile_picture_media_id == media.id


def test_follow_round_trip(session_factory):
    with session_factory() as session:
        follower = _make_user(cognito_sub="sub-e", username="follower_user")
        followed = _make_user(cognito_sub="sub-f", username="followed_user")
        session.add_all([follower, followed])
        session.commit()

        follow = Follow(follower_user_id=follower.id, followed_user_id=followed.id)
        session.add(follow)
        session.commit()

        fetched = session.scalar(
            select(Follow).where(
                Follow.follower_user_id == follower.id,
                Follow.followed_user_id == followed.id,
            )
        )
        assert fetched is not None
        assert fetched.created_at is not None


def test_follow_composite_uniqueness(session_factory):
    with session_factory() as session:
        follower = _make_user(cognito_sub="sub-g", username="follower_two")
        followed = _make_user(cognito_sub="sub-h", username="followed_two")
        session.add_all([follower, followed])
        session.commit()

        session.add(Follow(follower_user_id=follower.id, followed_user_id=followed.id))
        session.commit()

        session.add(Follow(follower_user_id=follower.id, followed_user_id=followed.id))
        with pytest.raises(IntegrityError):
            session.commit()


def test_follow_rejects_self_follow_at_db_level(session_factory):
    with session_factory() as session:
        user = _make_user(cognito_sub="sub-i", username="self_follower")
        session.add(user)
        session.commit()

        session.add(Follow(follower_user_id=user.id, followed_user_id=user.id))
        with pytest.raises(IntegrityError):
            session.commit()


def test_follow_has_no_deleted_at_column():
    assert not hasattr(Follow, "deleted_at")
