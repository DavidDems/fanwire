"""Tests for the media/ upload pipeline (Template Method), per AGENTS.md TDD
workflow. Written before app/media/pipeline.py exists.

See wiki/CodeContext/Modules/0x04-media.md GoF pattern tie-in:
`validateType -> scanForMalware -> stripMetadata -> generateVariants ->
publish`, matching wiki/CodeContext/Modules/0x00-architecture.md
"Ingestion & processing pipelines" and app.events.ingestion's
AbstractEventIngestionPipeline shape.

Fixture images are generated programmatically with Pillow (never committed
as binary files) — keeps the repo text-only and tests fast/deterministic.
"""

from __future__ import annotations

import io
from datetime import date

import boto3
import pytest
from botocore.exceptions import ClientError
from moto import mock_aws
from PIL import Image

from app.db import Base, make_engine, make_session_factory
from app.media.models import Media, MediaStatus
from app.media.pipeline import (
    FakeMalwareScanner,
    GuardDutyScanResultScanner,
    ImageUploadPipeline,
    MediaRejected,
)
from app.users.models import User

QUARANTINE_BUCKET = "fanwire-test-quarantine"
PUBLIC_BUCKET = "fanwire-test-public"


@pytest.fixture()
def s3_client():
    with mock_aws():
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket=QUARANTINE_BUCKET)
        client.create_bucket(Bucket=PUBLIC_BUCKET)
        yield client


@pytest.fixture()
def session_factory(postgres_url):
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    yield make_session_factory(engine)
    Base.metadata.drop_all(engine)
    engine.dispose()


def _make_uploader_and_media(
    session, *, cognito_sub: str, username: str, **media_overrides
) -> Media:
    uploader = User(cognito_sub=cognito_sub, username=username, date_of_birth=date(1990, 1, 1))
    session.add(uploader)
    session.commit()

    media = Media(uploader_id=uploader.id, **media_overrides)
    session.add(media)
    session.commit()
    return media


def _jpeg_bytes(size: tuple[int, int] = (10, 10), color=(255, 0, 0)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, format="JPEG")
    return buffer.getvalue()


def _png_bytes(size: tuple[int, int] = (10, 10), color=(0, 255, 0, 128)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGBA", size, color).save(buffer, format="PNG")
    return buffer.getvalue()


def _gif_bytes(size: tuple[int, int] = (10, 10)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, (0, 0, 255)).save(buffer, format="GIF")
    return buffer.getvalue()


def _garbage_bytes() -> bytes:
    return b"this is not an image, just some garbage byte content"


def _jpeg_bytes_with_exif(size: tuple[int, int] = (10, 10), color=(255, 0, 0)) -> bytes:
    image = Image.new("RGB", size, color)
    exif = image.getexif()
    exif[271] = "TestCameraMake"  # tag 271 = Make
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", exif=exif.tobytes())
    return buffer.getvalue()


def _put_quarantine_object(s3_client, key: str, data: bytes) -> None:
    s3_client.put_object(Bucket=QUARANTINE_BUCKET, Key=key, Body=data)


def _make_pipeline(
    s3_client, media: Media, *, session=None, malware_scanner=None
) -> ImageUploadPipeline:
    return ImageUploadPipeline(
        media,
        session,
        s3_client,
        malware_scanner or FakeMalwareScanner(True),
        quarantine_bucket=QUARANTINE_BUCKET,
        public_bucket=PUBLIC_BUCKET,
    )


def test_fake_malware_scanner_returns_preset_boolean_verdict():
    clean_scanner = FakeMalwareScanner(True)
    infected_scanner = FakeMalwareScanner(False)

    assert clean_scanner.scan(bucket="b", key="k") is True
    assert infected_scanner.scan(bucket="b", key="k") is False


def test_fake_malware_scanner_supports_per_key_verdicts():
    scanner = FakeMalwareScanner({"clean.jpg": True, "infected.jpg": False})

    assert scanner.scan(bucket="b", key="clean.jpg") is True
    assert scanner.scan(bucket="b", key="infected.jpg") is False


def test_fake_malware_scanner_defaults_missing_key_to_clean_in_dict_mode():
    scanner = FakeMalwareScanner({"infected.jpg": False})

    assert scanner.scan(bucket="b", key="unlisted.jpg") is True


def test_validate_type_accepts_jpeg_and_sets_observed_mime_and_size(s3_client):
    data = _jpeg_bytes()
    _put_quarantine_object(s3_client, "q/1.jpg", data)
    media = Media(uploader_id=1, s3_key_quarantine="q/1.jpg", status=MediaStatus.SCANNING)

    _make_pipeline(s3_client, media).validate_type()

    assert media.mime_type == "image/jpeg"
    assert media.size_bytes == len(data)


def test_validate_type_accepts_png(s3_client):
    data = _png_bytes()
    _put_quarantine_object(s3_client, "q/2.png", data)
    media = Media(uploader_id=1, s3_key_quarantine="q/2.png", status=MediaStatus.SCANNING)

    _make_pipeline(s3_client, media).validate_type()

    assert media.mime_type == "image/png"
    assert media.size_bytes == len(data)


def test_validate_type_rejects_oversized_object(s3_client):
    oversized = b"0" * (ImageUploadPipeline.MAX_SIZE_BYTES + 1)
    _put_quarantine_object(s3_client, "q/big.jpg", oversized)
    media = Media(uploader_id=1, s3_key_quarantine="q/big.jpg", status=MediaStatus.SCANNING)

    with pytest.raises(MediaRejected):
        _make_pipeline(s3_client, media).validate_type()


def test_validate_type_rejects_non_image_bytes(s3_client):
    _put_quarantine_object(s3_client, "q/garbage.bin", _garbage_bytes())
    media = Media(uploader_id=1, s3_key_quarantine="q/garbage.bin", status=MediaStatus.SCANNING)

    with pytest.raises(MediaRejected):
        _make_pipeline(s3_client, media).validate_type()


def test_validate_type_rejects_real_image_format_not_in_allow_list(s3_client):
    """A real, Pillow-parseable image (GIF) that simply isn't in the MIME
    allow-list must still be rejected — same rule that rejects SVG."""
    _put_quarantine_object(s3_client, "q/pic.gif", _gif_bytes())
    media = Media(uploader_id=1, s3_key_quarantine="q/pic.gif", status=MediaStatus.SCANNING)

    with pytest.raises(MediaRejected):
        _make_pipeline(s3_client, media).validate_type()


def test_strip_metadata_removes_exif_from_generated_variants(s3_client):
    _put_quarantine_object(s3_client, "q/exif.jpg", _jpeg_bytes_with_exif())
    media = Media(uploader_id=1, s3_key_quarantine="q/exif.jpg", status=MediaStatus.SCANNING)
    pipeline = _make_pipeline(s3_client, media)

    pipeline.validate_type()
    pipeline.strip_metadata()
    pipeline.generate_variants()

    served = Image.open(io.BytesIO(pipeline._served_bytes))
    thumbnail = Image.open(io.BytesIO(pipeline._thumbnail_bytes))
    assert not served.getexif()
    assert not thumbnail.getexif()
    assert "exif" not in served.info
    assert "exif" not in thumbnail.info


def test_generate_variants_caps_served_and_thumbnail_dimensions(s3_client):
    original_size = (2000, 800)
    _put_quarantine_object(s3_client, "q/big.jpg", _jpeg_bytes(size=original_size))
    media = Media(uploader_id=1, s3_key_quarantine="q/big.jpg", status=MediaStatus.SCANNING)
    pipeline = _make_pipeline(s3_client, media)

    pipeline.validate_type()
    pipeline.strip_metadata()
    pipeline.generate_variants()

    served = Image.open(io.BytesIO(pipeline._served_bytes))
    thumbnail = Image.open(io.BytesIO(pipeline._thumbnail_bytes))

    assert max(served.size) == ImageUploadPipeline.SERVED_MAX_EDGE
    assert served.size[0] / served.size[1] == pytest.approx(
        original_size[0] / original_size[1], rel=0.02
    )
    assert max(thumbnail.size) == ImageUploadPipeline.THUMBNAIL_MAX_EDGE
    assert thumbnail.size[0] / thumbnail.size[1] == pytest.approx(
        original_size[0] / original_size[1], rel=0.05
    )


def test_generate_variants_never_upscales_a_small_image(s3_client):
    _put_quarantine_object(s3_client, "q/small.jpg", _jpeg_bytes(size=(10, 10)))
    media = Media(uploader_id=1, s3_key_quarantine="q/small.jpg", status=MediaStatus.SCANNING)
    pipeline = _make_pipeline(s3_client, media)

    pipeline.validate_type()
    pipeline.strip_metadata()
    pipeline.generate_variants()

    served = Image.open(io.BytesIO(pipeline._served_bytes))
    thumbnail = Image.open(io.BytesIO(pipeline._thumbnail_bytes))

    assert served.size == (10, 10)
    assert thumbnail.size == (10, 10)


def test_publish_uploads_variants_transitions_to_processed_and_clears_quarantine(
    s3_client, session_factory
):
    with session_factory() as session:
        media = _make_uploader_and_media(
            session,
            cognito_sub="sub-pub-1",
            username="pub_user_1",
            s3_key_quarantine="q/pub1.jpg",
            status=MediaStatus.SCANNING,
        )
        _put_quarantine_object(s3_client, "q/pub1.jpg", _jpeg_bytes())
        pipeline = _make_pipeline(s3_client, media, session=session)
        pipeline.validate_type()
        pipeline.strip_metadata()
        pipeline.generate_variants()

        pipeline.publish()

        assert media.status == MediaStatus.PROCESSED
        assert media.s3_key_quarantine is None
        assert media.s3_key_public is not None
        assert media.s3_key_thumbnail is not None

        # the quarantine object is actually gone
        with pytest.raises(ClientError):
            s3_client.head_object(Bucket=QUARANTINE_BUCKET, Key="q/pub1.jpg")

        # the public objects actually exist and hold the generated bytes
        public_obj = s3_client.get_object(Bucket=PUBLIC_BUCKET, Key=media.s3_key_public)
        assert public_obj["Body"].read() == pipeline._served_bytes
        thumbnail_obj = s3_client.get_object(Bucket=PUBLIC_BUCKET, Key=media.s3_key_thumbnail)
        assert thumbnail_obj["Body"].read() == pipeline._thumbnail_bytes


def test_run_happy_path_processes_media_end_to_end(s3_client, session_factory):
    with session_factory() as session:
        media = _make_uploader_and_media(
            session,
            cognito_sub="sub-run-1",
            username="run_user_1",
            s3_key_quarantine="q/run1.jpg",
            status=MediaStatus.UPLOADED,
        )
        _put_quarantine_object(s3_client, "q/run1.jpg", _jpeg_bytes())
        pipeline = _make_pipeline(s3_client, media, session=session)

        pipeline.run()

        assert media.status == MediaStatus.PROCESSED
        assert media.mime_type == "image/jpeg"
        assert media.size_bytes is not None
        assert media.s3_key_quarantine is None
        assert media.s3_key_public is not None
        assert media.s3_key_thumbnail is not None
        # public objects were actually written
        s3_client.head_object(Bucket=PUBLIC_BUCKET, Key=media.s3_key_public)
        s3_client.head_object(Bucket=PUBLIC_BUCKET, Key=media.s3_key_thumbnail)
        # quarantine object was actually deleted
        with pytest.raises(ClientError):
            s3_client.head_object(Bucket=QUARANTINE_BUCKET, Key="q/run1.jpg")


def test_run_rejects_on_malware_scan_failure(s3_client, session_factory):
    with session_factory() as session:
        media = _make_uploader_and_media(
            session,
            cognito_sub="sub-run-2",
            username="run_user_2",
            s3_key_quarantine="q/run2.jpg",
            status=MediaStatus.UPLOADED,
        )
        _put_quarantine_object(s3_client, "q/run2.jpg", _jpeg_bytes())
        pipeline = _make_pipeline(
            s3_client, media, session=session, malware_scanner=FakeMalwareScanner(False)
        )

        pipeline.run()

        assert media.status == MediaStatus.REJECTED
        assert media.s3_key_quarantine is None
        assert media.s3_key_public is None
        assert media.s3_key_thumbnail is None
        with pytest.raises(ClientError):
            s3_client.head_object(Bucket=QUARANTINE_BUCKET, Key="q/run2.jpg")


def test_run_rejects_on_invalid_file_content(s3_client, session_factory):
    with session_factory() as session:
        media = _make_uploader_and_media(
            session,
            cognito_sub="sub-run-3",
            username="run_user_3",
            s3_key_quarantine="q/run3.bin",
            status=MediaStatus.UPLOADED,
        )
        _put_quarantine_object(s3_client, "q/run3.bin", _garbage_bytes())
        pipeline = _make_pipeline(s3_client, media, session=session)

        pipeline.run()

        assert media.status == MediaStatus.REJECTED
        assert media.s3_key_quarantine is None
        with pytest.raises(ClientError):
            s3_client.head_object(Bucket=QUARANTINE_BUCKET, Key="q/run3.bin")


# --- GuardDutyScanResultScanner (real MalwareScanner adapter) -------------
# app.media.lambda_handler only ever constructs this once it has already
# confirmed the GuardDuty scan-result event's scanResultStatus was exactly
# "NO_THREATS_FOUND" -- the fail-closed branching for THREATS_FOUND/any
# unrecognized status now lives entirely in the handler, which skips
# ImageUploadPipeline.run() (and therefore this class) altogether for those
# cases rather than feeding it a false verdict (see
# tests/media/test_lambda_handler.py and that module's docstring for why:
# validate_type()'s GetObject would hit the quarantine bucket policy's Deny
# for an object GuardDuty didn't tag NO_THREATS_FOUND). This class exists
# only because ImageUploadPipeline's Template Method still requires a
# MalwareScanner collaborator even on the confirmed-clean path (GuardDuty's
# own async scan already happened) -- it always returns True.


def test_guardduty_scanner_always_reports_clean():
    assert GuardDutyScanResultScanner().scan(bucket="b", key="k") is True
