"""POSTS-010: the per-user upload limit seen through POST /media/uploads.
Written before the limiter is wired.

The route takes its limiter from app.media.dependencies.get_upload_rate_limiter;
these tests override it with app.media.rate_limit.FakeUploadRateLimiter, so
"at the limit" is a fixed verdict here -- the window boundaries are proved
once against real Postgres in tests/media/test_upload_rate_limiter.py. A
refusal answers 429 with a detail, writes no Media row and never presigns.
A mime type outside the allow-list stays 400, checked before the limit.

get_s3_client is overridden with a recording fake rather than moto: these
tests only need to know whether generate_presigned_post was called (the
presigned POST itself is tests/media/test_routes.py's).

New names are reached through `importlib` / `dependencies.<Name>` inside
fixtures and tests rather than imported at the top, so each test fails on
its own missing name instead of the whole module failing to collect.
"""

from __future__ import annotations

import importlib
from datetime import date
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_session, get_settings
from app.media import dependencies
from app.media.dependencies import get_s3_client
from app.media.models import Media, MediaStatus
from app.media.routes import router
from app.settings import Settings
from app.users.dependencies import get_current_user
from app.users.models import User


class RecordingS3Client:
    """Stands in for boto3's S3 client: records every presign it is asked for."""

    def __init__(self) -> None:
        self.presigned: list[dict[str, Any]] = []

    def generate_presigned_post(self, **kwargs: Any) -> dict[str, Any]:
        self.presigned.append(kwargs)
        return {"url": "https://example.invalid/upload", "fields": {"key": kwargs["Key"]}}


def _fake(allowed: bool):
    return importlib.import_module("app.media.rate_limit").FakeUploadRateLimiter(allowed)


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def s3_client():
    return RecordingS3Client()


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
    _limit(app, allowed=True)
    return app


@pytest.fixture()
def client(app):
    return TestClient(app)


def _limit(app, *, allowed: bool) -> None:
    app.dependency_overrides[dependencies.get_upload_rate_limiter] = lambda: _fake(allowed)


@pytest.fixture()
def uploader(app, session_factory):
    with session_factory() as session:
        user = User(cognito_sub="sub-uploader", username="uploader", date_of_birth=date(1990, 1, 1))
        session.add(user)
        session.commit()
    app.dependency_overrides[get_current_user] = lambda: user
    return user


def _media_count(session_factory, uploader_id: int) -> int:
    with session_factory() as session:
        return session.scalar(
            select(func.count()).select_from(Media).where(Media.uploader_id == uploader_id)
        )


# --- at the limit -----------------------------------------------------------


def test_upload_at_the_limit_answers_429_with_a_detail(app, client, uploader):
    _limit(app, allowed=False)

    response = client.post("/media/uploads", json={"mime_type": "image/jpeg"})

    assert response.status_code == 429
    detail = response.json()["detail"]
    assert isinstance(detail, str) and detail


def test_upload_at_the_limit_writes_no_row_and_never_presigns(
    app, client, session_factory, s3_client, uploader
):
    _limit(app, allowed=False)

    client.post("/media/uploads", json={"mime_type": "image/jpeg"})

    assert _media_count(session_factory, uploader.id) == 0
    assert s3_client.presigned == []


def test_a_disallowed_mime_type_at_the_limit_still_answers_400(
    app, client, session_factory, s3_client, uploader
):
    _limit(app, allowed=False)

    response = client.post("/media/uploads", json={"mime_type": "image/svg+xml"})

    assert response.status_code == 400
    assert _media_count(session_factory, uploader.id) == 0
    assert s3_client.presigned == []


# --- below the limit --------------------------------------------------------


def test_upload_below_the_limit_is_unchanged(client, session_factory, s3_client, uploader):
    response = client.post("/media/uploads", json={"mime_type": "image/png"})

    assert response.status_code == 201
    body = response.json()
    assert body["upload_url"] == "https://example.invalid/upload"
    assert len(s3_client.presigned) == 1
    with session_factory() as session:
        [media] = session.scalars(select(Media).where(Media.uploader_id == uploader.id)).all()
        assert media.id == body["media_id"]
        assert media.status == MediaStatus.UPLOADED


# --- the real wiring --------------------------------------------------------


def test_get_upload_rate_limiter_wires_the_media_count_limiter_from_settings(
    app, client, session_factory, s3_client, uploader
):
    """With the real provider (only get_settings overridden), a limit of one
    upload a minute refuses the second upload straight away."""
    del app.dependency_overrides[dependencies.get_upload_rate_limiter]
    settings = Settings(
        database_url="postgresql+psycopg://u:p@host:5432/db",
        media_upload_rate_limit_per_minute=1,
        media_upload_rate_limit_per_hour=20,
    )
    app.dependency_overrides[get_settings] = lambda: settings

    assert client.post("/media/uploads", json={"mime_type": "image/jpeg"}).status_code == 201
    assert client.post("/media/uploads", json={"mime_type": "image/jpeg"}).status_code == 429
    assert _media_count(session_factory, uploader.id) == 1
    assert len(s3_client.presigned) == 1


def test_get_upload_rate_limiter_returns_a_media_count_rate_limiter(session_factory):
    settings = Settings(database_url="postgresql+psycopg://u:p@host:5432/db")
    with session_factory() as session:
        limiter = dependencies.get_upload_rate_limiter(session=session, settings=settings)

    module = importlib.import_module("app.media.rate_limit")
    assert isinstance(limiter, module.MediaCountRateLimiter)


# --- OpenAPI ----------------------------------------------------------------


def test_the_upload_route_declares_429_in_openapi():
    app = FastAPI()
    app.include_router(router)

    responses = app.openapi()["paths"]["/media/uploads"]["post"]["responses"]

    assert "429" in responses
