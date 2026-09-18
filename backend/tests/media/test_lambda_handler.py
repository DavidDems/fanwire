"""Tests for app.media.lambda_handler.handler -- the media-processing
Lambda, per AGENTS.md TDD workflow. Written before app/media/
lambda_handler.py exists.

Triggered by the media-scan-result SQS queue (batch size 1,
reportBatchItemFailures: true, infra/lib/app-stack.ts's
`MediaScanResultTrigger`), each record wrapping a real "GuardDuty Malware
Protection Object Scan Result" EventBridge event (fixtures: tests/fixtures/
media_scan_result_{clean,threats_found,unknown_status}_sqs_event.json).

All three fixture quarantine objects hold a *valid* small JPEG (not
garbage bytes) so validate_type always succeeds on the clean path --
isolating that test from validate_type's own unrelated rejection paths,
which tests/media/test_pipeline.py already covers.

Only a NO_THREATS_FOUND verdict runs ImageUploadPipeline at all. Any other
verdict (THREATS_FOUND, or an unrecognized status -- fail-closed) is
rejected directly by the handler via the existing State machine plus a
DeleteObject, and must never call GetObject: the quarantine bucket policy
denies GetObject to every principal except GuardDuty's role until an
object is tagged NO_THREATS_FOUND, so validate_type's GetObject would
otherwise raise an unhandled ClientError instead of ever reaching
Rejected. See app.media.lambda_handler's own module docstring.
"""

from __future__ import annotations

import io
import json
from datetime import date
from pathlib import Path

import boto3
import pytest
from moto import mock_aws
from PIL import Image
from testcontainers.postgres import PostgresContainer

import app.dependencies as app_dependencies
from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_settings
from app.media.models import Media, MediaStatus
from app.users.models import User

FIXTURES = Path(__file__).parent.parent / "fixtures"
QUARANTINE_BUCKET = "fanwire-media-quarantine"
PUBLIC_BUCKET = "fanwire-media-public"


def _load_fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


def _jpeg_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (10, 10), (255, 0, 0)).save(buffer, format="JPEG")
    return buffer.getvalue()


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


@pytest.fixture(autouse=True)
def _wire_env_and_caches(monkeypatch, postgres_url):
    monkeypatch.setenv("DATABASE_URL", postgres_url)
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.delenv("AWS_ENDPOINT_URL_DYNAMODB", raising=False)
    monkeypatch.delenv("AWS_ENDPOINT_URL", raising=False)
    get_settings.cache_clear()
    app_dependencies._get_session_factory.cache_clear()
    import app.media.dependencies as media_dependencies

    media_dependencies.get_s3_client.cache_clear()
    yield
    get_settings.cache_clear()
    app_dependencies._get_session_factory.cache_clear()
    media_dependencies.get_s3_client.cache_clear()


@pytest.fixture()
def s3_and_media(session_factory):
    with mock_aws():
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket=QUARANTINE_BUCKET)
        client.create_bucket(Bucket=PUBLIC_BUCKET)

        with session_factory() as session:
            uploader = User(
                cognito_sub="sub-media-handler",
                username="media_handler_user",
                date_of_birth=date(1990, 1, 1),
            )
            session.add(uploader)
            session.commit()

            media_by_key = {}
            for key in (
                "uploads/42/original.jpg",
                "uploads/43/original.jpg",
                "uploads/44/original.jpg",
            ):
                media = Media(
                    uploader_id=uploader.id,
                    status=MediaStatus.UPLOADED,
                    s3_key_quarantine=key,
                )
                session.add(media)
                session.commit()
                client.put_object(Bucket=QUARANTINE_BUCKET, Key=key, Body=_jpeg_bytes())
                media_by_key[key] = media.id

        yield client, media_by_key


class _S3GetObjectSpy:
    """Delegates every S3 call to a real (moto-backed) client, but records
    every get_object call so a test can assert it was never made -- proving
    the handler never attempts to read a quarantine object the bucket
    policy would deny GetObject on for a non-clean scan result (see
    app.media.lambda_handler's module docstring)."""

    def __init__(self, real_client) -> None:
        self._real = real_client
        self.get_object_calls: list[dict] = []

    def get_object(self, **kwargs):
        self.get_object_calls.append(kwargs)
        return self._real.get_object(**kwargs)

    def __getattr__(self, name):
        return getattr(self._real, name)


def _spy_on_get_s3_client(monkeypatch, spy) -> None:
    import app.media.lambda_handler as media_lambda_handler

    monkeypatch.setattr(media_lambda_handler, "get_s3_client", lambda: spy)


def test_clean_scan_result_processes_media_to_processed(session_factory, s3_and_media):
    from app.media.lambda_handler import handler

    _, media_by_key = s3_and_media
    event = _load_fixture("media_scan_result_clean_sqs_event.json")

    result = handler(event, None)

    assert result == {"batchItemFailures": []}
    with session_factory() as session:
        media = session.get(Media, media_by_key["uploads/42/original.jpg"])
        assert media.status == MediaStatus.PROCESSED
        assert media.s3_key_quarantine is None
        assert media.s3_key_public is not None


def test_threats_found_scan_result_rejects_and_deletes_the_object_without_get_object(
    session_factory, s3_and_media, monkeypatch
):
    # THREATS_FOUND objects stay GetObject-denied by the quarantine bucket
    # policy (only a NO_THREATS_FOUND tag unlocks read) -- the handler must
    # reject via the State machine + DeleteObject directly, never by running
    # ImageUploadPipeline (whose validate_type step opens with GetObject).
    from botocore.exceptions import ClientError

    from app.media.lambda_handler import handler

    s3_client, media_by_key = s3_and_media
    spy = _S3GetObjectSpy(s3_client)
    _spy_on_get_s3_client(monkeypatch, spy)
    event = _load_fixture("media_scan_result_threats_found_sqs_event.json")

    result = handler(event, None)

    assert result == {"batchItemFailures": []}
    assert spy.get_object_calls == []
    with session_factory() as session:
        media = session.get(Media, media_by_key["uploads/43/original.jpg"])
        assert media.status == MediaStatus.REJECTED
        assert media.s3_key_quarantine is None
        assert media.s3_key_public is None
    with pytest.raises(ClientError):
        s3_client.head_object(Bucket=QUARANTINE_BUCKET, Key="uploads/43/original.jpg")


def test_unknown_scan_status_fails_closed_to_rejected_without_get_object(
    session_factory, s3_and_media, monkeypatch
):
    # The contract's required fail-closed test: an unrecognized
    # scanResultStatus (here "UNSUPPORTED") must never leave Media Processed,
    # and -- same reasoning as THREATS_FOUND above -- must never call
    # GetObject on an object GuardDuty didn't tag NO_THREATS_FOUND.
    from botocore.exceptions import ClientError

    from app.media.lambda_handler import handler

    s3_client, media_by_key = s3_and_media
    spy = _S3GetObjectSpy(s3_client)
    _spy_on_get_s3_client(monkeypatch, spy)
    event = _load_fixture("media_scan_result_unknown_status_sqs_event.json")

    result = handler(event, None)

    assert result == {"batchItemFailures": []}
    assert spy.get_object_calls == []
    with session_factory() as session:
        media = session.get(Media, media_by_key["uploads/44/original.jpg"])
        assert media.status == MediaStatus.REJECTED
        assert media.status != MediaStatus.PROCESSED
        assert media.s3_key_quarantine is None
    with pytest.raises(ClientError):
        s3_client.head_object(Bucket=QUARANTINE_BUCKET, Key="uploads/44/original.jpg")


def test_no_matching_media_row_is_a_no_op_not_a_batch_item_failure(session_factory, s3_and_media):
    # Duplicate/late SQS delivery for an object already finalized
    # (s3_key_quarantine cleared once Processed/Rejected) -- must not be
    # treated as a failure requiring redelivery.
    from app.media.lambda_handler import handler

    event = _load_fixture("media_scan_result_clean_sqs_event.json")
    body = json.loads(event["Records"][0]["body"])
    body["detail"]["s3ObjectDetails"]["objectKey"] = "uploads/999/original.jpg"
    event["Records"][0]["body"] = json.dumps(body)

    result = handler(event, None)

    assert result == {"batchItemFailures": []}
