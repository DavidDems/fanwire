"""app.events.lambda_handler.handler -- the ingestion Lambda's entry point
(infra/lib/app-stack.ts's `Ingestion` function, command
`app.events.lambda_handler.handler`).

Two trigger shapes, both driving the same
app.events.ingestion.FinalScoreIngestion Template Method:
  - **EventBridge Scheduler**, hourly (infra/lib/app-stack.ts's
    `ingestionSchedule`): the event IS the Scheduler's configured `input`
    JSON directly (`{"trigger": "schedule", "mode": "baseline"}`) -- no SQS/
    EventBridge envelope, since Scheduler invokes the function directly.
    Exceptions propagate uncaught here: Lambda's own async on-failure
    destination (`IngestionAsyncConfig`) is what routes a failed invocation
    to the ingestion-retry queue -- this handler must not swallow anything
    on that path.
  - **The ingestion-retry SQS queue** (`IngestionRetryTrigger`, batch size
    1, `reportBatchItemFailures: true`): each record's `body` is the JSON
    Lambda's destination delivers on failure (AWS docs' documented shape:
    `requestContext`/`requestPayload`/`responseContext`/`responsePayload`).
    `requestPayload` is the original invocation's event -- this handler
    re-runs the same pipeline that payload would have triggered. A
    per-record failure is reported via `batchItemFailures` (matching the
    event source mapping's `reportBatchItemFailures: true`) rather than
    raising, so one bad record doesn't block SQS from deleting/redelivering
    the others in the batch.

Never logs PII: nothing that flows through ingestion is user data (Team/Game
rows are public sports data) -- only the retry condition and message id are
logged, never a payload's contents.
"""

from __future__ import annotations

import json
from typing import Any

import boto3  # type: ignore[import-untyped]  # no boto3 stubs/py.typed marker installed
from aws_lambda_powertools import Logger

from app.dependencies import get_settings, open_session
from app.events.dependencies import UrllibHttpClient, resolve_api_sports_key
from app.events.factory import SportsProviderFactory
from app.events.ingestion import FinalScoreIngestion

logger = Logger()


def _dynamodb_client(region: str) -> Any:
    # Built fresh per invocation rather than process-cached: Lambda
    # invocations of this handler are infrequent (hourly baseline + rare
    # retries), so the lru_cache "build once per cold start" optimization
    # used elsewhere (e.g. app.events.dependencies) buys little here and
    # keeping this handler dependency-free of that module's cache state
    # keeps it simpler to reason about/test in isolation.
    return boto3.client("dynamodb", region_name=region)


def _run_ingestion_pipeline() -> None:
    settings = get_settings()
    api_key = resolve_api_sports_key(settings)
    source = SportsProviderFactory.create_adapter(
        UrllibHttpClient(), base_url=settings.api_sports_base_url, api_key=api_key
    )
    session = open_session()
    try:
        pipeline = FinalScoreIngestion(
            source,
            session,
            _dynamodb_client(settings.aws_default_region),
            idempotency_table_name=settings.idempotency_table_name,
        )
        pipeline.run()
    finally:
        session.close()


def handler(event: dict[str, Any], context: Any) -> dict[str, Any] | None:
    if "Records" in event:
        return _handle_retry_queue(event["Records"])

    logger.info("ingestion triggered by scheduler", extra={"mode": event.get("mode")})
    _run_ingestion_pipeline()
    return None


def _handle_retry_queue(records: list[dict[str, Any]]) -> dict[str, Any]:
    batch_item_failures: list[dict[str, str]] = []
    for record in records:
        message_id = record["messageId"]
        try:
            destination_payload = json.loads(record["body"])
            logger.info(
                "retrying ingestion invocation",
                extra={
                    "condition": destination_payload.get("requestContext", {}).get("condition"),
                    "approximate_invoke_count": destination_payload.get("requestContext", {}).get(
                        "approximateInvokeCount"
                    ),
                },
            )
            _run_ingestion_pipeline()
        except Exception:
            logger.exception("ingestion retry failed", extra={"message_id": message_id})
            batch_item_failures.append({"itemIdentifier": message_id})
    return {"batchItemFailures": batch_item_failures}
