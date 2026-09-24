"""Tests for users/ service functions, per AGENTS.md TDD workflow. Written
before app/users/service.py exists.

See wiki/CodeContext/Modules/0x01-users.md for User/Follow behavior
(soft-delete, follow/unfollow fail-fast rules).
"""

from datetime import date

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db import Base, make_engine, make_session_factory
from app.eventbus import InMemoryEventPublisher, PostEventBus
from app.events.models import Team
from app.media.models import Media, MediaStatus
from app.users.models import Follow, User
from app.users.service import (
    USER_FOLLOWED,
    AlreadyFollowingError,
    InvalidPreferredTeamError,
    InvalidProfilePictureError,
    NotFollowingError,
    PublicProfile,
    SelfFollowError,
    UserNotFoundError,
    create_user,
    follow,
    followed_user_ids,
    follower_count,
    following_count,
    get_public_profiles,
    soft_delete_user,
    unfollow,
    update_profile,
)


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


# --- update_profile ---------------------------------------------------


def test_update_profile_updates_only_fields_present(session_factory):
    with session_factory() as session:
        user = _create(session, "sub-up-1", "up_user_1")

        updated = update_profile(
            session, user.id, fields_set={"description"}, description="new bio"
        )

        assert updated.description == "new bio"


def test_update_profile_explicit_null_clears_field(session_factory):
    with session_factory() as session:
        user = create_user(
            session,
            cognito_sub="sub-up-2",
            username="up_user_2",
            date_of_birth=date(1990, 1, 1),
            description="has text",
        )

        updated = update_profile(session, user.id, fields_set={"description"}, description=None)

        assert updated.description is None


def test_update_profile_leaves_absent_fields_untouched(session_factory):
    with session_factory() as session:
        user = create_user(
            session,
            cognito_sub="sub-up-3",
            username="up_user_3",
            date_of_birth=date(1990, 1, 1),
            description="keep",
        )

        updated = update_profile(session, user.id, fields_set=set())

        assert updated.description == "keep"


def test_update_profile_raises_for_unknown_preferred_team(session_factory):
    with session_factory() as session:
        user = _create(session, "sub-up-4", "up_user_4")

        with pytest.raises(InvalidPreferredTeamError):
            update_profile(
                session, user.id, fields_set={"preferred_team_id"}, preferred_team_id=999999
            )


def test_update_profile_accepts_valid_preferred_team_id(session_factory):
    with session_factory() as session:
        user = _create(session, "sub-up-9", "up_user_9")
        team = Team(
            api_sports_team_id=401,
            name="Valid Team",
            abbreviation="VLD",
            conference="Eastern",
            division="Atlantic",
        )
        session.add(team)
        session.commit()
        team_id = team.id

        updated = update_profile(
            session, user.id, fields_set={"preferred_team_id"}, preferred_team_id=team_id
        )

        assert updated.preferred_team_id == team_id


def test_update_profile_raises_for_missing_media(session_factory):
    with session_factory() as session:
        user = _create(session, "sub-up-5", "up_user_5")

        with pytest.raises(InvalidProfilePictureError):
            update_profile(
                session,
                user.id,
                fields_set={"profile_picture_media_id"},
                profile_picture_media_id=999999,
            )


def test_update_profile_raises_for_media_not_owned_by_caller(session_factory):
    with session_factory() as session:
        owner = _create(session, "sub-up-6a", "up_user_6a")
        other = _create(session, "sub-up-6b", "up_user_6b")
        media = Media(uploader_id=other.id, status=MediaStatus.PROCESSED)
        session.add(media)
        session.commit()
        media_id = media.id

        with pytest.raises(InvalidProfilePictureError):
            update_profile(
                session,
                owner.id,
                fields_set={"profile_picture_media_id"},
                profile_picture_media_id=media_id,
            )


def test_update_profile_raises_for_media_not_processed(session_factory):
    with session_factory() as session:
        user = _create(session, "sub-up-7", "up_user_7")
        media = Media(uploader_id=user.id, status=MediaStatus.UPLOADED)
        session.add(media)
        session.commit()
        media_id = media.id

        with pytest.raises(InvalidProfilePictureError):
            update_profile(
                session,
                user.id,
                fields_set={"profile_picture_media_id"},
                profile_picture_media_id=media_id,
            )


def test_update_profile_accepts_own_processed_media(session_factory):
    with session_factory() as session:
        user = _create(session, "sub-up-8", "up_user_8")
        media = Media(uploader_id=user.id, status=MediaStatus.PROCESSED)
        session.add(media)
        session.commit()
        media_id = media.id

        updated = update_profile(
            session,
            user.id,
            fields_set={"profile_picture_media_id"},
            profile_picture_media_id=media_id,
        )

        assert updated.profile_picture_media_id == media_id


# --- followed_user_ids / get_public_profiles (public read helpers) --------


def test_followed_user_ids_returns_ids_the_user_follows(session_factory):
    with session_factory() as session:
        follower = _create(session, "sub-fid-1", "fid_follower")
        followed_a = _create(session, "sub-fid-2", "fid_followed_a")
        followed_b = _create(session, "sub-fid-3", "fid_followed_b")
        bus, _ = _event_bus()
        follow(session, event_bus=bus, follower_user_id=follower.id, followed_user_id=followed_a.id)
        follow(session, event_bus=bus, follower_user_id=follower.id, followed_user_id=followed_b.id)

        ids = followed_user_ids(session, follower.id)

        assert sorted(ids) == sorted([followed_a.id, followed_b.id])


def test_followed_user_ids_empty_when_following_no_one(session_factory):
    with session_factory() as session:
        user = _create(session, "sub-fid-lonely", "fid_lonely")

        assert followed_user_ids(session, user.id) == []


def test_get_public_profiles_returns_mapping_for_active_users(session_factory):
    with session_factory() as session:
        a = _create(session, "sub-pp-a", "pp_user_a")
        b = _create(session, "sub-pp-b", "pp_user_b")

        profiles = get_public_profiles(session, [a.id, b.id])

        assert profiles[a.id] == PublicProfile(
            id=a.id, username="pp_user_a", profile_picture_media_id=None
        )
        assert profiles[b.id] == PublicProfile(
            id=b.id, username="pp_user_b", profile_picture_media_id=None
        )


def test_get_public_profiles_excludes_soft_deleted_users(session_factory):
    with session_factory() as session:
        active = _create(session, "sub-pp-active", "pp_active")
        deleted = _create(session, "sub-pp-deleted", "pp_deleted")
        soft_delete_user(session, deleted.id)

        profiles = get_public_profiles(session, [active.id, deleted.id])

        assert active.id in profiles
        assert deleted.id not in profiles


def test_get_public_profiles_empty_input_returns_empty_dict(session_factory):
    with session_factory() as session:
        assert get_public_profiles(session, []) == {}


# --- follower_count / following_count --------------------------------


def test_follower_count_and_following_count(session_factory):
    with session_factory() as session:
        a = _create(session, "sub-fc-a", "fc_user_a")
        b = _create(session, "sub-fc-b", "fc_user_b")
        c = _create(session, "sub-fc-c", "fc_user_c")
        bus, _ = _event_bus()
        follow(session, event_bus=bus, follower_user_id=b.id, followed_user_id=a.id)
        follow(session, event_bus=bus, follower_user_id=c.id, followed_user_id=a.id)
        follow(session, event_bus=bus, follower_user_id=a.id, followed_user_id=b.id)

        assert follower_count(session, a.id) == 2
        assert following_count(session, a.id) == 1


def test_follower_count_excludes_soft_deleted_followers(session_factory):
    with session_factory() as session:
        target = _create(session, "sub-fc-target", "fc_target")
        follower = _create(session, "sub-fc-follower", "fc_follower")
        bus, _ = _event_bus()
        follow(session, event_bus=bus, follower_user_id=follower.id, followed_user_id=target.id)
        soft_delete_user(session, follower.id)

        assert follower_count(session, target.id) == 0
