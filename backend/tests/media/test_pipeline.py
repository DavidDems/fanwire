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

import boto3
import pytest
from moto import mock_aws
from PIL import Image

from app.media.models import Media, MediaStatus
from app.media.pipeline import FakeMalwareScanner, ImageUploadPipeline, MediaRejected

QUARANTINE_BUCKET = "fanwire-test-quarantine"
PUBLIC_BUCKET = "fanwire-test-public"


@pytest.fixture()
def s3_client():
    with mock_aws():
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket=QUARANTINE_BUCKET)
        client.create_bucket(Bucket=PUBLIC_BUCKET)
        yield client


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


def _put_quarantine_object(s3_client, key: str, data: bytes) -> None:
    s3_client.put_object(Bucket=QUARANTINE_BUCKET, Key=key, Body=data)


def _make_pipeline(s3_client, media: Media, *, session=None, malware_scanner=None) -> ImageUploadPipeline:
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
