"""AbstractMediaUploadPipeline / ImageUploadPipeline — Template Method
(wiki/CodeContext/Standards/gof-patterns.md), same skeleton shape as
app.events.ingestion.AbstractEventIngestionPipeline. Full pipeline
shape/rationale: wiki/CodeContext/Modules/0x00-architecture.md "Ingestion &
processing pipelines", detail in wiki/CodeContext/Modules/0x04-media.md.

Step order is exactly `validate_type -> scan_for_malware -> strip_metadata
-> generate_variants -> publish`, per that wiki page's own GoF section
(matching 0x00-architecture.md's statement of the same pipeline) — this is
implemented literally even though the same wiki page's separate "AWS
service mapping" table describes GuardDuty's scan as triggered directly on
upload, ahead of a separate processing Lambda. That's a real inconsistency
between the two sections of the wiki source, not something this module
tries to reconcile — flagged back to the requester rather than resolved
here.
"""

from __future__ import annotations

import abc
import io
from typing import Any, ClassVar

from PIL import Image
from sqlalchemy.orm import Session

from app.media.models import Media, MediaStatus
from app.media.state import transition


class MediaRejected(Exception):
    """Raised internally by any pipeline step that fails; carries a short
    reason string. Caught by AbstractMediaUploadPipeline.run(), never meant
    to escape it."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class MalwareScanner(abc.ABC):
    """Narrow injected interface (Dependency Inversion, same shape as
    app.users.auth.TokenVerifier) — the pipeline depends on this, never on
    a concrete scanner implementation.

    Real GuardDuty Malware Protection for S3 is event-driven/async in
    production (a finding on the bucket, not a synchronous call this
    pipeline can block on) and its CDK wiring is Phase 6 infra — out of
    scope here. A production GuardDutyMalwareScanner adapter satisfying
    this interface (however it ends up sourcing the verdict — polling,
    an EventBridge-delivered finding, etc.) is future work."""

    @abc.abstractmethod
    def scan(self, *, bucket: str, key: str) -> bool:
        """Return True if `key` in `bucket` is clean, False if infected."""


class FakeMalwareScanner(MalwareScanner):
    """Test double. Constructed with either a single verdict applied to
    every key, or a dict[str, bool] for per-key verdicts in one test — a
    key missing from the dict defaults to clean (True), keeping the common
    case (one infected object among otherwise-clean ones) terse to write."""

    def __init__(self, verdict: bool | dict[str, bool]) -> None:
        self._verdict = verdict

    def scan(self, *, bucket: str, key: str) -> bool:
        if isinstance(self._verdict, dict):
            return self._verdict.get(key, True)
        return self._verdict


class GuardDutyScanResultScanner(MalwareScanner):
    """Real production adapter (app.media.lambda_handler): fed GuardDuty's
    already-computed verdict from the SQS-delivered "GuardDuty Malware
    Protection Object Scan Result" EventBridge event -- never calls
    GuardDuty or scans anything itself (see MalwareScanner's own docstring:
    the real scan is async/event-driven, not a synchronous call this
    pipeline can block on). `scan()` ignores its bucket/key arguments: by
    construction, one instance is built per SQS record for exactly the one
    object that event's verdict is about, so there's nothing to look up.

    Fail-closed per wiki/CodeContext/Standards/security.md: only the exact
    "NO_THREATS_FOUND" `scanResultStatus` counts as clean. Every other value
    -- including "THREATS_FOUND" and any status this pipeline doesn't
    recognize (a future GuardDuty status this code predates, a malformed
    event, etc.) -- is treated as not clean, never Processed.
    """

    NO_THREATS_FOUND = "NO_THREATS_FOUND"

    def __init__(self, scan_result_status: str) -> None:
        self._clean = scan_result_status == self.NO_THREATS_FOUND

    def scan(self, *, bucket: str, key: str) -> bool:
        return self._clean


class AbstractMediaUploadPipeline(abc.ABC):
    """Fixes the upload pipeline skeleton; subclasses implement each step.
    See wiki/CodeContext/Standards/gof-patterns.md's Template Method entry.

    Holds `media`/`session`/`s3_client`/`quarantine_bucket` directly (rather
    than leaving them to subclasses) because run()'s fail-closed cleanup on
    rejection needs all four regardless of which concrete pipeline is
    running.
    """

    def __init__(
        self, media: Media, session: Session, s3_client: Any, *, quarantine_bucket: str
    ) -> None:
        self._media = media
        self._session = session
        self._s3_client = s3_client
        self._quarantine_bucket = quarantine_bucket

    def run(self) -> None:
        transition(self._media, MediaStatus.SCANNING)
        try:
            self.validate_type()
            self.scan_for_malware()
            self.strip_metadata()
            self.generate_variants()
            self.publish()
        except MediaRejected:
            # Fail-closed cleanup, per wiki/CodeContext/Standards/security.md
            # "User-generated content": nothing failing scan/validation is
            # retained "for review". The Media row itself stays (status
            # REJECTED) for user-facing error messaging/abuse analysis — see
            # wiki/CodeContext/Modules/0x04-media.md "Resolved decisions".
            transition(self._media, MediaStatus.REJECTED)
            self._cleanup_quarantine_object()
            self._session.commit()

    def _cleanup_quarantine_object(self) -> None:
        """Delete the quarantine S3 object and clear s3_key_quarantine.
        Shared by both the reject path (here) and the publish path (once
        processing succeeds, the quarantine copy's job is done)."""
        if self._media.s3_key_quarantine is not None:
            self._s3_client.delete_object(
                Bucket=self._quarantine_bucket, Key=self._media.s3_key_quarantine
            )
            self._media.s3_key_quarantine = None

    @abc.abstractmethod
    def validate_type(self) -> None: ...

    @abc.abstractmethod
    def scan_for_malware(self) -> None: ...

    @abc.abstractmethod
    def strip_metadata(self) -> None: ...

    @abc.abstractmethod
    def generate_variants(self) -> None: ...

    @abc.abstractmethod
    def publish(self) -> None: ...


class ImageUploadPipeline(AbstractMediaUploadPipeline):
    """Concrete image pipeline: validates/scans/strips/resizes/publishes a
    single quarantined image object. See wiki/CodeContext/Modules/
    0x04-media.md Security requirements — MIME allow-list, size cap, no
    trust in client-declared type, EXIF stripping, fail-closed cleanup.
    """

    ALLOWED_MIME_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
    MAX_SIZE_BYTES = 5 * 1024 * 1024  # ~5MB, per wiki/CodeContext/Modules/0x04-media.md

    # Longest-edge caps for the two generated variants — resolves
    # wiki/CodeContext/Modules/0x04-media.md's "exact served-image and
    # thumbnail dimensions" open decision. See "Resolved decisions" there.
    SERVED_MAX_EDGE = 1600
    THUMBNAIL_MAX_EDGE = 200

    _FORMAT_BY_MIME_TYPE: ClassVar[dict[str, str]] = {
        "image/jpeg": "JPEG",
        "image/png": "PNG",
        "image/webp": "WEBP",
    }
    _EXTENSION_BY_MIME_TYPE: ClassVar[dict[str, str]] = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
    }

    def __init__(
        self,
        media: Media,
        session: Session,
        s3_client: Any,
        malware_scanner: MalwareScanner,
        *,
        quarantine_bucket: str,
        public_bucket: str,
    ) -> None:
        super().__init__(media, session, s3_client, quarantine_bucket=quarantine_bucket)
        self._malware_scanner = malware_scanner
        self._public_bucket = public_bucket
        # In-memory working state carried between steps — never re-fetched
        # from S3 once validate_type has read the object once.
        self._raw_bytes: bytes | None = None
        self._stripped_image: Image.Image | None = None
        self._served_bytes: bytes | None = None
        self._thumbnail_bytes: bytes | None = None

    def validate_type(self) -> None:
        obj = self._s3_client.get_object(
            Bucket=self._quarantine_bucket, Key=self._media.s3_key_quarantine
        )
        data = obj["Body"].read()

        if len(data) > self.MAX_SIZE_BYTES:
            raise MediaRejected(
                f"object exceeds {self.MAX_SIZE_BYTES} byte size cap ({len(data)} bytes)"
            )

        # Never trust the client-declared Content-Type or file extension —
        # actually open/parse it with Pillow, per wiki/CodeContext/Standards/
        # security.md "User-generated content". This is also how SVG (and
        # any other non-raster or malformed content) gets rejected: Pillow
        # either can't parse it at all, or — if some plugin somehow does —
        # the resulting format still isn't in ALLOWED_MIME_TYPES below.
        try:
            image = Image.open(io.BytesIO(data))
            image.load()
        except Exception as exc:
            raise MediaRejected("not a parseable image") from exc

        mime_type = Image.MIME.get(image.format)
        if mime_type not in self.ALLOWED_MIME_TYPES:
            raise MediaRejected(f"mime type {mime_type!r} not in allow-list")

        # Set from what was actually observed, never a client-declared value
        # — there isn't one available here anyway, this pipeline only ever
        # sees what's in S3.
        self._media.mime_type = mime_type
        self._media.size_bytes = len(data)
        self._raw_bytes = data

    def scan_for_malware(self) -> None:
        clean = self._malware_scanner.scan(
            bucket=self._quarantine_bucket, key=self._media.s3_key_quarantine
        )
        if not clean:
            raise MediaRejected("failed malware scan")

    def strip_metadata(self) -> None:
        assert self._raw_bytes is not None  # validate_type always runs first
        image = Image.open(io.BytesIO(self._raw_bytes))
        image.load()

        # Standard approach: rebuild a brand-new Image from pixel data only
        # (Image.new starts with an empty .info dict) rather than deleting a
        # few known EXIF tags off the original — .convert() alone is not
        # enough, since Pillow carries the source .info (and therefore EXIF)
        # forward across a plain convert(). Preserve alpha where the source
        # actually has it (RGBA PNG/WEBP), otherwise flatten to RGB (plain
        # JPEG has no alpha channel to begin with).
        mode = "RGBA" if image.mode in ("RGBA", "LA") or "transparency" in image.info else "RGB"
        normalized = image.convert(mode)
        clean_image = Image.new(mode, image.size)
        clean_image.putdata(list(normalized.getdata()))

        self._stripped_image = clean_image

    def generate_variants(self) -> None:
        assert self._stripped_image is not None  # strip_metadata always runs first
        fmt = self._FORMAT_BY_MIME_TYPE[self._media.mime_type]

        served = self._resized(self._stripped_image, self.SERVED_MAX_EDGE)
        thumbnail = self._resized(self._stripped_image, self.THUMBNAIL_MAX_EDGE)

        self._served_bytes = self._encode(served, fmt)
        self._thumbnail_bytes = self._encode(thumbnail, fmt)

    def publish(self) -> None:
        assert self._served_bytes is not None and self._thumbnail_bytes is not None
        ext = self._EXTENSION_BY_MIME_TYPE[self._media.mime_type]
        public_key = f"media/{self._media.id}/public.{ext}"
        thumbnail_key = f"media/{self._media.id}/thumbnail.{ext}"

        self._s3_client.put_object(
            Bucket=self._public_bucket,
            Key=public_key,
            Body=self._served_bytes,
            ContentType=self._media.mime_type,
        )
        self._s3_client.put_object(
            Bucket=self._public_bucket,
            Key=thumbnail_key,
            Body=self._thumbnail_bytes,
            ContentType=self._media.mime_type,
        )

        self._media.s3_key_public = public_key
        self._media.s3_key_thumbnail = thumbnail_key
        transition(self._media, MediaStatus.PROCESSED)

        # The quarantine copy's job is done once the public copies exist —
        # same "don't retain past the point it's needed" instinct as the
        # reject-path cleanup. See wiki/CodeContext/Modules/0x04-media.md
        # AWS service mapping: "only after the malware scan passes and
        # processing succeeds does the Lambda copy the output to the public
        # bucket."
        self._cleanup_quarantine_object()
        self._session.commit()

    @staticmethod
    def _resized(image: Image.Image, max_edge: int) -> Image.Image:
        width, height = image.size
        longest = max(width, height)
        if longest <= max_edge:
            return image.copy()  # never upscale past the original
        scale = max_edge / longest
        new_size = (max(1, round(width * scale)), max(1, round(height * scale)))
        return image.resize(new_size, Image.LANCZOS)

    @staticmethod
    def _encode(image: Image.Image, fmt: str) -> bytes:
        buffer = io.BytesIO()
        if fmt == "JPEG" and image.mode not in ("RGB", "L"):
            image = image.convert("RGB")  # JPEG has no alpha channel
        image.save(buffer, format=fmt)
        return buffer.getvalue()
