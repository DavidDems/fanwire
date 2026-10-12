"""Tests for backend/scripts/dev_process_media.py (MEDIA-002).

Locally there is no GuardDuty wired up (wiki/CodeContext/Modules/
0x04-media.md "AWS service mapping" — the scan verdict is a GuardDuty
finding, not something this repo's local stack produces), so a Media row
uploaded through the real presigned-POST route (`POST /media/uploads`)
sits in `Uploaded` forever: nothing ever delivers the "GuardDuty Malware
Protection Object Scan Result" event app.media.lambda_handler.handler
waits for, and the image can never be attached to a post. This script is a
dev-only stand-in for that verdict.

It must drive `Media` to `Processed` by actually running
`app.media.pipeline.ImageUploadPipeline` — the same Template Method
app.media.lambda_handler.handler drives on the real
`NO_THREATS_FOUND` path — not by setting `.status` itself (see
app.media.state's docstring on why `transition()` is the only legal way to
move `.status`, and tests/media/test_lambda_handler.py for the real path's
own field assertions, mirrored here).

Interface this file pins, since backend/scripts/dev_process_media.py does
not exist yet (TDD workflow, AGENTS.md — importing it below is expected to
fail until MEDIA-002's code agent creates it):

- `dev_process_media.main(argv: list[str]) -> int`, `argv[0]` a Media id.
  Returns 0 on success (including the already-Processed no-op case) and a
  non-zero code on any refusal/error, printing a human-readable reason.
- `dev_process_media.ImageUploadPipeline` is the module-level name bound by
  `from app.media.pipeline import ImageUploadPipeline` (the same import
  shape app.media.lambda_handler uses) — tests below patch exactly this
  name to prove the script constructs and runs the real pipeline rather
  than reimplementing the status transition.
- The script refuses to run unless the `ENVIRONMENT` environment variable
  is exactly `"development"` (fail-closed: unset or any other value is
  refused), so it can never be pointed at a deployed environment by
  accident.
"""

from __future__ import annotations

import io
import sys
from datetime import date
from pathlib import Path

import boto3
import pytest
from botocore.exceptions import ClientError
from moto import mock_aws
from PIL import Image

import app.dependencies as app_dependencies
import app.media.dependencies as media_dependencies
from app.db import Base, make_engine, make_session_factory
from app.dependencies import get_settings
from app.media.models import Media, MediaStatus
from app.users.models import User

# scripts/ has no __init__.py (same as scripts/export_openapi.py) -- Python's
# implicit namespace package support picks it up once BACKEND_ROOT is on
# sys.path, inserted the same defensive way export_openapi.py inserts it for
# its own `from app.main import app`.
BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from scripts import dev_process_media

QUARANTINE_BUCKET = "fanwire-media-quarantine"
PUBLIC_BUCKET = "fanwire-media-public"


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
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.delenv("AWS_ENDPOINT_URL_DYNAMODB", raising=False)
    monkeypatch.delenv("AWS_ENDPOINT_URL", raising=False)
    get_settings.cache_clear()
    app_dependencies._get_session_factory.cache_clear()
    media_dependencies.get_s3_client.cache_clear()
    yield
    get_settings.cache_clear()
    app_dependencies._get_session_factory.cache_clear()
    media_dependencies.get_s3_client.cache_clear()


@pytest.fixture()
def s3_client():
    # Every test runs under this, including the ones that never expect the
    # pipeline to touch S3 -- so if the script ever did reach for a real
    # client despite a refusal/no-op path, it would hit moto, not AWS.
    with mock_aws():
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket=QUARANTINE_BUCKET)
        client.create_bucket(Bucket=PUBLIC_BUCKET)
        yield client


def _jpeg_bytes(size: tuple[int, int] = (10, 10), color=(255, 0, 0)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, format="JPEG")
    return buffer.getvalue()


def _make_uploaded_media(session, s3_client, *, cognito_sub: str, username: str, key: str) -> Media:
    uploader = User(cognito_sub=cognito_sub, username=username, date_of_birth=date(1990, 1, 1))
    session.add(uploader)
    session.commit()

    media = Media(uploader_id=uploader.id, status=MediaStatus.UPLOADED, s3_key_quarantine=key)
    session.add(media)
    session.commit()

    s3_client.put_object(Bucket=QUARANTINE_BUCKET, Key=key, Body=_jpeg_bytes())
    return media


def _spy_on_pipeline(monkeypatch) -> list:
    """Patch dev_process_media's own ImageUploadPipeline binding with a
    subclass that records every instance constructed, so a test can assert
    the real pipeline ran (or didn't) without caring how the script gets
    there internally."""
    instances: list = []
    base_cls = dev_process_media.ImageUploadPipeline

    class _SpyPipeline(base_cls):  # type: ignore[misc, valid-type]
        def __init__(self, *args, **kwargs) -> None:
            super().__init__(*args, **kwargs)
            instances.append(self)

    monkeypatch.setattr(dev_process_media, "ImageUploadPipeline", _SpyPipeline)
    return instances


def _output(captured) -> str:
    return captured.out + captured.err


# --------------------------------------------------------- criterion 1 & 6


def test_moves_uploaded_media_through_scanning_to_processed_recording_pipeline_fields(
    session_factory, s3_client
):
    with session_factory() as session:
        media = _make_uploaded_media(
            session,
            s3_client,
            cognito_sub="sub-1",
            username="user_one",
            key="uploads/1/original.jpg",
        )
        media_id = media.id

    rc = dev_process_media.main([str(media_id)])

    assert rc == 0
    with session_factory() as session:
        media = session.get(Media, media_id)
        # The exact fields app.media.pipeline.ImageUploadPipeline.publish()
        # records on the real GuardDuty-verdict path (see
        # tests/media/test_lambda_handler.py's own assertions for that path).
        assert media.status == MediaStatus.PROCESSED
        assert media.s3_key_quarantine is None
        assert media.s3_key_public == f"media/{media_id}/public.jpg"
        assert media.s3_key_thumbnail == f"media/{media_id}/thumbnail.jpg"
        assert media.mime_type == "image/jpeg"
        assert media.size_bytes == len(_jpeg_bytes())

    # The public bucket actually has the two published objects -- not just
    # the Media row's keys, which could be set without ever publishing.
    s3_client.get_object(Bucket=PUBLIC_BUCKET, Key=f"media/{media_id}/public.jpg")
    s3_client.get_object(Bucket=PUBLIC_BUCKET, Key=f"media/{media_id}/thumbnail.jpg")
    # the quarantine object is actually gone, not just the DB column cleared
    with pytest.raises(ClientError):
        s3_client.head_object(Bucket=QUARANTINE_BUCKET, Key="uploads/1/original.jpg")


def test_reuses_image_upload_pipeline_rather_than_writing_the_transition_itself(
    session_factory, s3_client, monkeypatch
):
    with session_factory() as session:
        media = _make_uploaded_media(
            session,
            s3_client,
            cognito_sub="sub-2",
            username="user_two",
            key="uploads/2/original.jpg",
        )
        media_id = media.id

    instances = _spy_on_pipeline(monkeypatch)

    rc = dev_process_media.main([str(media_id)])

    assert rc == 0
    assert len(instances) == 1, (
        "dev_process_media.py must drive Media to Processed by constructing "
        "and running app.media.pipeline.ImageUploadPipeline -- the same "
        "Template Method app.media.lambda_handler.handler uses -- not by "
        "writing its own status-transition logic."
    )
    with session_factory() as session:
        media = session.get(Media, media_id)
        assert media.status == MediaStatus.PROCESSED


# --------------------------------------------------------------- criterion 2


def test_already_processed_media_is_left_unchanged_and_reported_not_reprocessed(
    session_factory, s3_client, monkeypatch
):
    with session_factory() as session:
        uploader = User(cognito_sub="sub-3", username="user_three", date_of_birth=date(1990, 1, 1))
        session.add(uploader)
        session.commit()
        media = Media(
            uploader_id=uploader.id,
            status=MediaStatus.PROCESSED,
            s3_key_quarantine=None,
            s3_key_public="media/999/public.jpg",
            s3_key_thumbnail="media/999/thumbnail.jpg",
            mime_type="image/jpeg",
            size_bytes=123,
        )
        session.add(media)
        session.commit()
        media_id = media.id

    instances = _spy_on_pipeline(monkeypatch)

    rc = dev_process_media.main([str(media_id)])

    assert rc == 0, "an already-Processed row is not an error -- it's a no-op"
    assert instances == [], (
        "an already-Processed Media row must never be run through the "
        "pipeline again -- that would be double-processing"
    )
    with session_factory() as session:
        media = session.get(Media, media_id)
        assert media.status == MediaStatus.PROCESSED
        assert media.s3_key_public == "media/999/public.jpg"
        assert media.s3_key_thumbnail == "media/999/thumbnail.jpg"
        assert media.mime_type == "image/jpeg"
        assert media.size_bytes == 123


def test_already_processed_media_reports_the_outcome(session_factory, s3_client, capsys):
    with session_factory() as session:
        uploader = User(
            cognito_sub="sub-3b", username="user_three_b", date_of_birth=date(1990, 1, 1)
        )
        session.add(uploader)
        session.commit()
        media = Media(uploader_id=uploader.id, status=MediaStatus.PROCESSED)
        session.add(media)
        session.commit()
        media_id = media.id

    rc = dev_process_media.main([str(media_id)])
    captured = _output(capsys.readouterr())

    assert rc == 0
    assert str(media_id) in captured, "the report must name which media id it's reporting on"
    assert "process" in captured.lower(), (
        "the report must say it's already Processed, not stay silent"
    )


# --------------------------------------------------------------- criterion 3


def test_nonexistent_media_id_exits_non_zero_and_names_the_id_without_changing_anything(
    session_factory, s3_client, capsys
):
    missing_id = 424242

    rc = dev_process_media.main([str(missing_id)])
    captured = _output(capsys.readouterr())

    assert rc != 0
    assert str(missing_id) in captured, "the failure message must name the id that wasn't found"

    with session_factory() as session:
        assert session.query(Media).count() == 0


# --------------------------------------------------------------- criterion 4


@pytest.mark.parametrize("environment_value", [None, "production", "staging", ""])
def test_refuses_to_run_outside_development_and_changes_nothing(
    session_factory, s3_client, monkeypatch, capsys, environment_value
):
    with session_factory() as session:
        media = _make_uploaded_media(
            session,
            s3_client,
            cognito_sub="sub-4",
            username="user_four",
            key="uploads/4/original.jpg",
        )
        media_id = media.id

    if environment_value is None:
        monkeypatch.delenv("ENVIRONMENT", raising=False)
    else:
        monkeypatch.setenv("ENVIRONMENT", environment_value)

    instances = _spy_on_pipeline(monkeypatch)

    rc = dev_process_media.main([str(media_id)])
    captured = _output(capsys.readouterr())

    assert rc != 0, f"must refuse when ENVIRONMENT={environment_value!r}"
    assert "development" in captured.lower(), "the refusal must say why -- that this is dev-only"
    assert instances == [], "a non-development environment must never reach the real pipeline"

    with session_factory() as session:
        media = session.get(Media, media_id)
        assert media.status == MediaStatus.UPLOADED
        assert media.s3_key_quarantine == "uploads/4/original.jpg"
        assert media.s3_key_public is None


def test_development_environment_value_is_required_to_be_exact(
    session_factory, s3_client, monkeypatch
):
    # Fail-closed: "Development" / "DEVELOPMENT" / "dev" must not accidentally
    # satisfy the gate -- only the literal value this script is told to
    # require should ever let it run, so no near-miss configuration
    # accidentally arms it against a real environment.
    with session_factory() as session:
        media = _make_uploaded_media(
            session,
            s3_client,
            cognito_sub="sub-4b",
            username="user_four_b",
            key="uploads/4b/original.jpg",
        )
        media_id = media.id

    monkeypatch.setenv("ENVIRONMENT", "DEVELOPMENT")
    instances = _spy_on_pipeline(monkeypatch)

    rc = dev_process_media.main([str(media_id)])

    assert rc != 0
    assert instances == []


# --------------------------------------------------------------- criterion 5


def test_running_twice_in_a_row_is_idempotent_same_end_state_same_reported_outcome(
    session_factory, s3_client, capsys
):
    with session_factory() as session:
        media = _make_uploaded_media(
            session,
            s3_client,
            cognito_sub="sub-5",
            username="user_five",
            key="uploads/5/original.jpg",
        )
        media_id = media.id

    rc_first = dev_process_media.main([str(media_id)])
    capsys.readouterr()  # discard -- the first run legitimately did real work
    assert rc_first == 0

    with session_factory() as session:
        media = session.get(Media, media_id)
        first_end_state = (
            media.status,
            media.s3_key_quarantine,
            media.s3_key_public,
            media.s3_key_thumbnail,
            media.mime_type,
            media.size_bytes,
        )

    rc_second = dev_process_media.main([str(media_id)])
    second_output = _output(capsys.readouterr())

    rc_third = dev_process_media.main([str(media_id)])
    third_output = _output(capsys.readouterr())

    assert rc_second == 0
    assert rc_third == 0
    assert second_output == third_output, (
        "re-running on an id the script already finished must report the same "
        "outcome every time, not just on the first repeat"
    )

    with session_factory() as session:
        media = session.get(Media, media_id)
        second_end_state = (
            media.status,
            media.s3_key_quarantine,
            media.s3_key_public,
            media.s3_key_thumbnail,
            media.mime_type,
            media.size_bytes,
        )
    assert second_end_state == first_end_state, "a repeat run must never change the end state"
