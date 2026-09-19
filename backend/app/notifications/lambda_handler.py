"""app.notifications.lambda_handler.handler -- the notifications Lambda's
entry point (infra/lib/app-stack.ts's `Notifications` function, command
`app.notifications.lambda_handler.handler`).

Triggered by the notification SQS queue (`NotificationTrigger`, batch size
10, `reportBatchItemFailures: true`), itself fed by messaging-stack.ts's
`NotificationRule` (`detailType: ["PostCreated", "UserFollowed"]` on
PostEventBus -- filters on detail-type only, so this works regardless of
which module published the event). Each record's `body` is that
EventBridge event, JSON-encoded; this handler unwraps `detail-type` and
`detail` and delegates to the existing
app.notifications.consumer.handle_domain_event, unchanged.

Always constructs a real SesEmailSender: that class itself decides whether
to actually send (see its own docstring -- a no-op, no PII logged, when
NOTIFICATION_FROM_ADDRESS is unset). In-app notification creation in
handle_domain_event happens unconditionally either way, so "email disabled"
never blocks in-app delivery.

Per-record failures are reported via `batchItemFailures` rather than
raising, so one bad record (batch size 10) doesn't block the rest.

Never logs PII: only the event's detail-type is logged, never its `detail`
payload (which can carry user/post ids -- not logged either, to stay
conservative) or anything email-related.
"""

from __future__ import annotations

import json
from typing import Any

import boto3  # type: ignore[import-untyped]  # no boto3 stubs/py.typed marker installed
from aws_lambda_powertools import Logger

from app.dependencies import get_settings, open_session
from app.notifications.consumer import handle_domain_event
from app.notifications.email import SesEmailSender

logger = Logger()


def _cognito_client(region: str) -> Any:
    return boto3.client("cognito-idp", region_name=region)


def _ses_client(region: str) -> Any:
    return boto3.client("ses", region_name=region)


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    settings = get_settings()
    email_sender = SesEmailSender(
        _cognito_client(settings.cognito_region),
        _ses_client(settings.aws_default_region),
        user_pool_id=settings.cognito_user_pool_id,
        from_address=settings.notification_from_address,
    )
    session = open_session()
    batch_item_failures: list[dict[str, str]] = []
    try:
        for record in event["Records"]:
            message_id = record["messageId"]
            try:
                eventbridge_event = json.loads(record["body"])
                detail_type = eventbridge_event["detail-type"]
                detail = eventbridge_event["detail"]
                logger.info("handling domain event", extra={"event_name": detail_type})
                handle_domain_event(
                    session, event_name=detail_type, detail=detail, email_sender=email_sender
                )
            except Exception:
                logger.exception("notification handling failed", extra={"message_id": message_id})
                batch_item_failures.append({"itemIdentifier": message_id})
    finally:
        session.close()
    return {"batchItemFailures": batch_item_failures}
