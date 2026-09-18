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
verdict, fed into GuardDutyScanResultScanner (app.media.pipeline) so the
existing Template Method's scan_for_malware step consumes it directly
rather than scanning again.

Per-record failures are reported via `batchItemFailures`
(reportBatchItemFailures: true) rather than raising, so one bad record
doesn't block the rest of the batch (batch size is 1 today, but this stays
correct if that ever changes). A record whose objectKey matches no `Media`
row is treated as a no-op, not a failure: `Media.s3_key_quarantine` is
cleared once a row reaches Processed/Rejected (app.media.pipeline's
`_cleanup_quarantine_object`), so a duplicate/late redelivery of an
already-finalized scan-result event naturally finds nothing to do -- this
also makes the handler idempotent against SQS at-least-once delivery
without needing a separate idempotency table for media.

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
from app.media.models import Media
from app.media.pipeline import GuardDutyScanResultScanner, ImageUploadPipeline

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
    record: dict[str, Any], *, session: Any, s3_client: Any, quarantine_bucket: str, public_bucket: str
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

    scanner = GuardDutyScanResultScanner(scan_result_status)
    pipeline = ImageUploadPipeline(
        media,
        session,
        s3_client,
        scanner,
        quarantine_bucket=quarantine_bucket,
        public_bucket=public_bucket,
    )
    pipeline.run()
