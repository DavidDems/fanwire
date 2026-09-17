"""Round-trip tests for the media/ Media model, per AGENTS.md TDD workflow.
Written before app/media/models.py exists.

See wiki/CodeContext/Modules/0x04-media.md for the Media schema.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from testcontainers.postgres import PostgresContainer

from app.db import Base, make_engine, make_session_factory
from app.media.models import Media, MediaStatus
from app.users.models import User


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


def _make_user(**overrides):
    from datetime import date

    defaults = {
        "cognito_sub": "sub-media-1",
        "username": "media_uploader",
        "date_of_birth": date(1990, 1, 1),
    }
    defaults.update(overrides)
    return User(**defaults)


def test_media_round_trip_with_defaults(session_factory):
    with session_factory() as session:
        uploader = _make_user()
        session.add(uploader)
        session.commit()

        media = Media(uploader_id=uploader.id)
        session.add(media)
        session.commit()

        fetched = session.scalar(select(Media).where(Media.id == media.id))
        assert fetched is not None
        assert fetched.uploader_id == uploader.id
        assert fetched.post_id is None
        assert fetched.s3_key_quarantine is None
        assert fetched.s3_key_public is None
        assert fetched.s3_key_thumbnail is None
        assert fetched.mime_type is None
        assert fetched.size_bytes is None
        assert fetched.status == MediaStatus.UPLOADED
        assert fetched.created_at is not None
        assert fetched.updated_at is not None


def test_media_uploader_id_requires_existing_user(session_factory):
    with session_factory() as session:
        session.add(Media(uploader_id=999_999))
        with pytest.raises(IntegrityError):
            session.commit()


def test_media_post_id_has_no_enforced_fk_constraint(session_factory):
    """post_id is deliberately a plain column (no ForeignKey) until posts/'s
    Post table lands in Phase 2 — an arbitrary, non-existent post_id must
    NOT raise an IntegrityError."""
    with session_factory() as session:
        uploader = _make_user(cognito_sub="sub-media-2", username="media_uploader_2")
        session.add(uploader)
        session.commit()

        media = Media(uploader_id=uploader.id, post_id=999_999)
        session.add(media)
        session.commit()

        fetched = session.scalar(select(Media).where(Media.id == media.id))
        assert fetched.post_id == 999_999


def test_media_status_enum_round_trips(session_factory):
    with session_factory() as session:
        uploader = _make_user(cognito_sub="sub-media-3", username="media_uploader_3")
        session.add(uploader)
        session.commit()

        media = Media(uploader_id=uploader.id, status=MediaStatus.SCANNING)
        session.add(media)
        session.commit()

        fetched = session.scalar(select(Media).where(Media.id == media.id))
        assert fetched.status == MediaStatus.SCANNING


def test_media_status_defaults_to_uploaded_without_explicit_value(session_factory):
    with session_factory() as session:
        uploader = _make_user(cognito_sub="sub-media-4", username="media_uploader_4")
        session.add(uploader)
        session.commit()

        media = Media(uploader_id=uploader.id)
        session.add(media)
        session.commit()
        session.refresh(media)

        assert media.status == MediaStatus.UPLOADED
