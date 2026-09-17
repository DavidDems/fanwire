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


def _jpeg_bytes_with_exif(size: tuple[int, int] = (10, 10), color=(255, 0, 0)) -> bytes:
    image = Image.new("RGB", size, color)
    exif = image.getexif()
    exif[271] = "TestCameraMake"  # tag 271 = Make
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", exif=exif.tobytes())
    return buffer.getvalue()


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
