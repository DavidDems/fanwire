"""USERS-005 avatar colour contract, persistence and public mapping tests."""

from datetime import UTC, date, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_session
from app.media.models import Media, MediaStatus
from app.users.auth import VerifiedIdentity
from app.users.dependencies import get_current_identity, get_current_user
from app.users.models import User
from app.users.routes import router
from app.users.service import create_user, get_public_profiles

RECENT_AUTH_TIME = int(datetime.now(UTC).timestamp())
INNER = ("gold", "orange", "red", "green", "sky", "lavender", "silver", "teal")
OUTER = ("blue", "crimson", "black", "purple", "forest")


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
    return create_user(session, cognito_sub=f"sub-{username}", username=username,
                       date_of_birth=date(1990, 1, 1), **overrides)


@pytest.mark.parametrize("inner", INNER)
@pytest.mark.parametrize("outer", OUTER)
def test_patch_persists_independent_palette_colours(client, session_factory, inner, outer):
    http, app = client
    with session_factory() as session:
        user = _create(session, f"colour-{inner}-{outer}")
        user_id = user.id
    app.dependency_overrides[get_current_user] = lambda: user

    response = http.patch("/users/me", json={"avatar_inner_color": inner,
                                               "avatar_outer_color": outer})

    assert response.status_code == 200
    assert response.json()["avatar_inner_color"] == inner
    assert response.json()["avatar_outer_color"] == outer
    with session_factory() as session:
        saved = session.scalar(select(User).where(User.id == user_id))
        assert saved.avatar_inner_color == inner
        assert saved.avatar_outer_color == outer


@pytest.mark.parametrize("field,value", [
    ("avatar_inner_color", "blue"), ("avatar_outer_color", "gold"),
    ("avatar_inner_color", "not-a-team-colour"),
    ("avatar_outer_color", "not-a-team-colour"),
])
def test_patch_rejects_wrong_palette_or_unknown_key_without_mutation(
    client, session_factory, field, value
):
    http, app = client
    with session_factory() as session:
        user = _create(session, f"invalid-{field}-{value}",
                       avatar_inner_color="red", avatar_outer_color="black")
        user_id = user.id
    app.dependency_overrides[get_current_user] = lambda: user

    response = http.patch("/users/me", json={field: value})

    assert response.status_code == 422
    with session_factory() as session:
        saved = session.get(User, user_id)
        assert (saved.avatar_inner_color, saved.avatar_outer_color) == ("red", "black")


def test_patch_omission_preserves_and_null_clears_each_colour(client, session_factory):
    http, app = client
    with session_factory() as session:
        user = _create(session, "colour-patch", avatar_inner_color="sky",
                       avatar_outer_color="purple")
    app.dependency_overrides[get_current_user] = lambda: user

    unchanged = http.patch("/users/me", json={"avatar_outer_color": "blue"})
    cleared = http.patch("/users/me", json={"avatar_inner_color": None})

    assert (unchanged.json()["avatar_inner_color"], unchanged.json()["avatar_outer_color"]) == ("sky", "blue")
    assert (cleared.json()["avatar_inner_color"], cleared.json()["avatar_outer_color"]) == (None, "blue")


def test_colours_default_null_and_are_returned_by_me_and_public(client, session_factory):
    http, app = client
    with session_factory() as session:
        user = _create(session, "default-colours")
        user_id = user.id
    app.dependency_overrides[get_current_identity] = lambda: VerifiedIdentity(
        sub="sub-default-colours", auth_time=RECENT_AUTH_TIME)
    app.dependency_overrides[get_current_user] = lambda: user

    own = http.get("/users/me").json()
    public = http.get(f"/users/{user_id}").json()

    assert own["avatar_inner_color"] is None and own["avatar_outer_color"] is None
    assert public["avatar_inner_color"] is None and public["avatar_outer_color"] is None
    assert "profile_avatar_key" not in own and "profile_avatar_key" not in public


def test_legacy_preset_is_neither_accepted_nor_returned(client, session_factory):
    http, app = client
    with session_factory() as session:
        user = _create(session, "legacy-preset")
    app.dependency_overrides[get_current_user] = lambda: user

    response = http.patch("/users/me", json={"profile_avatar_key": "court-lines"})

    assert response.status_code == 422
    assert "profile_avatar_key" not in http.get("/users/me").json()


def test_setting_colour_does_not_clear_picture_or_delete_media(client, session_factory):
    http, app = client
    with session_factory() as session:
        user = _create(session, "colour-picture")
        media = Media(uploader_id=user.id, s3_key_thumbnail="thumbs/kept.webp",
                      s3_key_public="public/kept.webp", status=MediaStatus.PROCESSED)
        session.add(media)
        session.commit()
        user.profile_picture_media_id = media.id
        session.commit()
        user_id, media_id = user.id, media.id
    app.dependency_overrides[get_current_user] = lambda: user

    response = http.patch("/users/me", json={"avatar_inner_color": "teal"})

    assert response.status_code == 200
    with session_factory() as session:
        saved = session.get(User, user_id)
        media = session.get(Media, media_id)
        assert saved.profile_picture_media_id == media_id
        assert media is not None and media.s3_key_public == "public/kept.webp"


def test_public_profile_interface_exposes_both_colours(session_factory):
    with session_factory() as session:
        user = _create(session, "mapped-colours", avatar_inner_color="gold",
                       avatar_outer_color="forest")
        profile = get_public_profiles(session, [user.id])[user.id]
        assert (profile.avatar_inner_color, profile.avatar_outer_color) == ("gold", "forest")


def test_allowlists_are_the_palette_literals_in_schemas():
    """The two allowlists are Literal types in app.users.schemas, in the
    palette's own order, so the OpenAPI schema (and the frontend's generated
    types) carry each list as its own enum."""
    from typing import get_args

    from app.users import schemas

    assert get_args(schemas.AvatarInnerColor) == INNER
    assert get_args(schemas.AvatarOuterColor) == OUTER
    fields = schemas.UpdateMeRequest.model_fields
    assert "profile_avatar_key" not in fields
    assert "profile_avatar_key" not in schemas.PublicUserOut.model_fields
