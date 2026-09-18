"""app.media.lambda_handler.handler -- the media-processing Lambda's entry
point (infra/lib/app-stack.ts's `Media` function, command
`app.media.lambda_handler.handler`).

Triggered by the media-scan-result SQS queue (`MediaScanResultTrigger`,
batch size 1, `reportBatchItemFailures: true`), which is itself fed by an
EventBridge rule matching GuardDuty's own `source=aws.guardduty`,
`detail-type="GuardDuty Malware Protection Object Scan Result"` events for
the quarantine bucket (infra/lib/messaging-stack.ts's `MalwareScanResultRule`
-- see wiki/CodeContext/Modules/0x00-architecture.md "Media trigger":
processing is triggered by the scan *result*, never raw `ObjectCreated`, so
it can't race the scan).

Each record's `body` is that EventBridge event, JSON-encoded (SQS's own
wrapping, not a Lambda destination payload like the ingestion retry queue --
this queue is fed by an EventBridge rule target, not a Lambda failure
destination). `detail.s3ObjectDetails.{bucketName, objectKey}` identifies
the object; `detail.scanResultDetails.scanResultStatus` is GuardDuty's
verdict.

**Only a `NO_THREATS_FOUND` verdict runs `ImageUploadPipeline`** (fed a
`GuardDutyScanResultScanner`, which the Template Method's `scan_for_malware`
step still needs a collaborator for even though the real scan already
happened). Anything else -- `THREATS_FOUND`, or any status this code
predates (fail-closed) -- is rejected **directly by this handler**, never
by running the pipeline: per wiki/CodeContext/Modules/0x04-media.md, the
quarantine bucket policy denies `GetObject` to every principal except
GuardDuty's role until an object is tagged `NO_THREATS_FOUND`, and GuardDuty
tags every scan result (not only clean ones), so a non-clean object stays
`GetObject`-denied. `ImageUploadPipeline.run()`'s first step,
`validate_type()`, opens with a `GetObject` -- calling it for a non-clean
object would raise an unhandled `ClientError` instead of ever reaching
`Rejected`, leaving the SQS message to retry into the DLQ forever. So the
not-clean path here moves `Media` `Uploaded -> Scanning -> Rejected` via the
existing State machine (`app.media.state.transition`, the same two-step
move `AbstractMediaUploadPipeline.run()` itself makes) and deletes the
quarantine object directly with `s3:DeleteObject` (granted unconditionally
to this role, unlike `GetObject`) -- **`GetObject`/`GetObjectTagging` are
never called on this path.**

Per-record failures are reported via `batchItemFailures`
(reportBatchItemFailures: true) rather than raising, so one bad record
doesn't block the rest of the batch (batch size is 1 today, but this stays
correct if that ever changes). A record whose objectKey matches no `Media`
row is treated as a no-op, not a failure: `Media.s3_key_quarantine` is
cleared once a row reaches Processed/Rejected, so a duplicate/late
redelivery of an already-finalized scan-result event naturally finds
nothing to do -- this also makes the handler idempotent against SQS
at-least-once delivery without needing a separate idempotency table for
media.

Never logs PII: only S3 keys/bucket names and scan verdicts are logged,
never anything about the uploading user.
"""

from __future__ import annotations

import json
from typing import Any

from aws_lambda_powertools import Logger
from sqlalchemy import select

from app.dependencies import get_settings, open_session
from app.media.dependencies import get_s3_client
from app.media.models import Media, MediaStatus
from app.media.pipeline import GuardDutyScanResultScanner, ImageUploadPipeline
from app.media.state import transition

logger = Logger()


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    settings = get_settings()
    s3_client = get_s3_client()
    session = open_session()
    batch_item_failures: list[dict[str, str]] = []
    try:
        for record in event["Records"]:
            message_id = record["messageId"]
            try:
                _process_record(
                    record,
                    session=session,
                    s3_client=s3_client,
                    quarantine_bucket=settings.media_quarantine_bucket,
                    public_bucket=settings.media_public_bucket,
                )
            except Exception:
                logger.exception(
                    "media scan-result processing failed", extra={"message_id": message_id}
                )
                batch_item_failures.append({"itemIdentifier": message_id})
    finally:
        session.close()
    return {"batchItemFailures": batch_item_failures}


def _process_record(
    record: dict[str, Any],
    *,
    session: Any,
    s3_client: Any,
    quarantine_bucket: str,
    public_bucket: str,
) -> None:
    eventbridge_event = json.loads(record["body"])
    detail = eventbridge_event["detail"]
    object_key = detail["s3ObjectDetails"]["objectKey"]
    scan_result_status = detail["scanResultDetails"]["scanResultStatus"]

    media = session.execute(
        select(Media).where(Media.s3_key_quarantine == object_key)
    ).scalar_one_or_none()
    if media is None:
        logger.info(
            "no Media row for quarantine key -- treating as an already-finalized "
            "duplicate delivery, not a failure",
            extra={"object_key": object_key},
        )
        return

    if scan_result_status != GuardDutyScanResultScanner.NO_THREATS_FOUND:
        logger.info(
            "guardduty scan result not clean -- rejecting without reading the object",
            extra={"scan_result_status": scan_result_status},
        )
        _reject_without_reading_object(media, session, s3_client, quarantine_bucket)
        return

    pipeline = ImageUploadPipeline(
        media,
        session,
        s3_client,
        GuardDutyScanResultScanner(),
        quarantine_bucket=quarantine_bucket,
        public_bucket=public_bucket,
    )
    pipeline.run()


def _reject_without_reading_object(
    media: Media, session: Any, s3_client: Any, quarantine_bucket: str
) -> None:
    """Moves `media` straight to Rejected and deletes its quarantine object,
    without ever calling GetObject -- see this module's own docstring for
    why a non-clean scan result must never run ImageUploadPipeline
    (validate_type's GetObject would hit the bucket policy's Deny). Mirrors
    AbstractMediaUploadPipeline.run()'s own Uploaded -> Scanning -> Rejected
    move and quarantine-object cleanup, without going through the pipeline
    itself."""
    transition(media, MediaStatus.SCANNING)
    transition(media, MediaStatus.REJECTED)
    if media.s3_key_quarantine is not None:
        s3_client.delete_object(Bucket=quarantine_bucket, Key=media.s3_key_quarantine)
        media.s3_key_quarantine = None
    session.commit()
