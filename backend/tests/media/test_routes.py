"""Tests for media/ HTTP routes, per AGENTS.md TDD workflow. Written before
app/media/routes.py, app/media/schemas.py, and app/media/dependencies.py
exist.

Scope note (see this unit's own report for the full reasoning): this only
covers presigned-upload-URL issuance (POST /media/uploads) and a read-back
(GET /media/{media_id}) -- it does NOT implement the S3-event-triggered
processing Lambda that runs ImageUploadPipeline (app.media.pipeline,
covered by tests/media/test_pipeline.py), since that's triggered by a real
S3 event in production which doesn't exist in this local/test setup.

Router isn't wired into app.main yet -- a later unit wires all three
modules' routers (events/users/media) in together. Throwaway local
FastAPI() app + app.dependency_overrides, same pattern as
backend/tests/users/test_routes.py -- overrides get_current_user (rather
than get_current_identity) since these routes only need the resolved User
row, never the raw VerifiedIdentity. get_s3_client is overridden to a
moto-mocked S3 client with the quarantine bucket pre-created, same
mock_aws()/create_bucket pattern as backend/tests/media/test_pipeline.py's
s3_client fixture.
"""

from __future__ import annotations

from datetime import date

import boto3
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from moto import mock_aws
from testcontainers.postgres import PostgresContainer

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_session
from app.media.dependencies import get_s3_client
from app.media.models import Media, MediaStatus
from app.media.routes import router
from app.users.dependencies import get_current_user
from app.users.models import User

QUARANTINE_BUCKET = "fanwire-test-quarantine"


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


@pytest.fixture()
def s3_client():
    with mock_aws():
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket=QUARANTINE_BUCKET)
        yield client


@pytest.fixture()
def app(session_factory, s3_client):
    app = FastAPI()
    app.include_router(router)

    def _get_session_override():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = _get_session_override
    app.dependency_overrides[get_s3_client] = lambda: s3_client
    return app


@pytest.fixture()
def client(app):
    return TestClient(app)


def _make_user(session, *, cognito_sub: str, username: str) -> User:
    user = User(cognito_sub=cognito_sub, username=username, date_of_birth=date(1990, 1, 1))
    session.add(user)
    session.commit()
    return user


def _as_user(app, user: User) -> None:
    app.dependency_overrides[get_current_user] = lambda: user


# --- POST /media/uploads ---------------------------------------------------


def test_create_upload_issues_url_and_creates_media_row(app, client, session_factory):
    with session_factory() as session:
        user = _make_user(session, cognito_sub="sub-up-1", username="uploader_1")
        user_id = user.id
        _as_user(app, user)

    response = client.post("/media/uploads", json={"mime_type": "image/jpeg"})

    assert response.status_code == 201
    body = response.json()
    assert isinstance(body["media_id"], int)
    assert isinstance(body["upload_url"], str) and body["upload_url"].startswith("http")
    assert body["s3_key"] == f"uploads/{body['media_id']}/original.jpg"

    with session_factory() as session:
        media = session.get(Media, body["media_id"])
        assert media is not None
        assert media.uploader_id == user_id
        assert media.status == MediaStatus.UPLOADED
        assert media.s3_key_quarantine == body["s3_key"]


def test_create_upload_rejects_disallowed_mime_type_and_persists_no_row(
    app, client, session_factory
):
    with session_factory() as session:
        user = _make_user(session, cognito_sub="sub-up-2", username="uploader_2")
        _as_user(app, user)

    response = client.post("/media/uploads", json={"mime_type": "image/svg+xml"})

    assert response.status_code == 400
    with session_factory() as session:
        assert session.query(Media).count() == 0


# --- GET /media/{media_id} --------------------------------------------------


def test_get_media_returns_200_for_owning_uploader(app, client, session_factory):
    with session_factory() as session:
        user = _make_user(session, cognito_sub="sub-get-1", username="getter_1")
        _as_user(app, user)

    create_response = client.post("/media/uploads", json={"mime_type": "image/png"})
    media_id = create_response.json()["media_id"]

    response = client.get(f"/media/{media_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == media_id
    assert body["status"] == "uploaded"
    assert body["s3_key_public"] is None
    assert body["s3_key_thumbnail"] is None


def test_get_media_returns_404_for_a_different_users_media(app, client, session_factory):
    with session_factory() as session:
        owner = _make_user(session, cognito_sub="sub-owner", username="owner_user")
        other = _make_user(session, cognito_sub="sub-other", username="other_user")

    _as_user(app, owner)
    create_response = client.post("/media/uploads", json={"mime_type": "image/jpeg"})
    media_id = create_response.json()["media_id"]

    _as_user(app, other)
    response = client.get(f"/media/{media_id}")

    assert response.status_code == 404


def test_get_media_returns_404_for_nonexistent_id(app, client, session_factory):
    with session_factory() as session:
        user = _make_user(session, cognito_sub="sub-none", username="none_user")
        _as_user(app, user)

    response = client.get("/media/999999")

    assert response.status_code == 404
