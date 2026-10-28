"""USERS-004 profile avatar contract, persistence and exclusivity tests."""

from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_session
from app.events.models import Team
from app.media.models import Media, MediaStatus
from app.users.auth import VerifiedIdentity
from app.users.dependencies import get_current_identity, get_current_user
from app.users.models import User
from app.users.routes import router
from app.users.service import create_user, get_public_profiles

AVATAR_KEYS = (
    "court-lines",
    "ball-seams",
    "shot-clock",
    "scoreboard",
    "arc",
    "net-grid",
    "baseline",
    "play-pattern",
)


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def client(session_factory):
    app = FastAPI()
    app.include_router(router)

    def get_session_override():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = get_session_override
    return TestClient(app), app


def _create(session, username: str, **overrides) -> User:
    return create_user(
        session,
        cognito_sub=f"sub-{username}",
        username=username,
        date_of_birth=date(1990, 1, 1),
        **overrides,
    )


@pytest.mark.parametrize("avatar_key", AVATAR_KEYS)
def test_patch_accepts_each_stable_avatar_key(client, session_factory, avatar_key):
    http, app = client
    with session_factory() as session:
        user = _create(session, f"avatar-{avatar_key}")
        user_id = user.id
    app.dependency_overrides[get_current_user] = lambda: user

    response = http.patch("/users/me", json={"profile_avatar_key": avatar_key})

    assert response.status_code == 200
    assert response.json()["profile_avatar_key"] == avatar_key
    with session_factory() as session:
        assert session.scalar(select(User).where(User.id == user_id)).profile_avatar_key == avatar_key


def test_invalid_avatar_key_is_rejected_without_changing_profile(client, session_factory):
    http, app = client
    with session_factory() as session:
        user = _create(session, "bad-avatar", profile_avatar_key="arc")
        user_id = user.id
    app.dependency_overrides[get_current_user] = lambda: user

    response = http.patch("/users/me", json={"profile_avatar_key": "team-logo"})

    assert response.status_code == 422
    with session_factory() as session:
        assert session.scalar(select(User).where(User.id == user_id)).profile_avatar_key == "arc"


def test_avatar_key_default_and_public_and_me_serialization(client, session_factory):
    http, app = client
    with session_factory() as session:
        user = _create(session, "default-avatar")
        user_id = user.id
    app.dependency_overrides[get_current_identity] = lambda: VerifiedIdentity(sub="sub-default-avatar")
    app.dependency_overrides[get_current_user] = lambda: user

    own = http.get("/users/me")
    public = http.get(f"/users/{user_id}")

    assert own.json()["profile_avatar_key"] is None
    assert public.json()["profile_avatar_key"] is None


def test_avatar_patch_null_resets_and_omission_preserves_choice(client, session_factory):
    http, app = client
    with session_factory() as session:
        user = _create(session, "reset-avatar", profile_avatar_key="net-grid")
        user_id = user.id
    app.dependency_overrides[get_current_user] = lambda: user

    unchanged = http.patch("/users/me", json={})
    reset = http.patch("/users/me", json={"profile_avatar_key": None})

    assert unchanged.json()["profile_avatar_key"] == "net-grid"
    assert reset.json()["profile_avatar_key"] is None


def test_preset_clears_picture_reference_but_preserves_media_row(client, session_factory):
    http, app = client
    with session_factory() as session:
        user = _create(session, "picture-avatar")
        media = Media(
            uploader_id=user.id,
            s3_key_thumbnail="thumbs/preserved.webp",
            s3_key_public="public/preserved.webp",
            status=MediaStatus.PROCESSED,
        )
        session.add(media)
        session.commit()
        user.profile_picture_media_id = media.id
        session.commit()
        user_id = user.id
        media_id = media.id
    app.dependency_overrides[get_current_user] = lambda: user

    response = http.patch("/users/me", json={"profile_avatar_key": "shot-clock"})

    assert response.status_code == 200
    with session_factory() as session:
        user = session.get(User, user_id)
        media = session.get(Media, media_id)
        assert user.profile_avatar_key == "shot-clock"
        assert user.profile_picture_media_id is None
        assert media is not None
        assert media.s3_key_public == "public/preserved.webp"


def test_attaching_processed_picture_clears_preset(client, session_factory):
    http, app = client
    with session_factory() as session:
        user = _create(session, "picture-wins", profile_avatar_key="arc")
        media = Media(uploader_id=user.id, status=MediaStatus.PROCESSED)
        session.add(media)
        session.commit()
        user_id = user.id
        media_id = media.id
    app.dependency_overrides[get_current_user] = lambda: session_factory().get(User, user_id)

    response = http.patch("/users/me", json={"profile_picture_media_id": media_id})

    assert response.status_code == 200
    assert response.json()["profile_avatar_key"] is None


def test_public_profile_interface_exposes_avatar_key(session_factory):
    with session_factory() as session:
        user = _create(session, "public-avatar", profile_avatar_key="play-pattern")

        profile = get_public_profiles(session, [user.id])[user.id]

        assert profile.profile_avatar_key == "play-pattern"
