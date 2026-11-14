"""LocalDispatchPublisher -- the third EventPublisher, for the local stack only
(wiki/CodeContext/Modules/0x05-notifications.md "Local dispatch").

It stands in for EventBridge, SQS and the Lambda: each event goes straight to
the same app.notifications.consumer.handle_domain_event, in process. Observer
stays as wiki/CodeContext/Standards/gof-patterns.md assigns it: posts/ and
users/ publish to the bus and know nothing of this subscriber.

app.dependencies.get_event_bus is the only place that wires it, and only with
ENVIRONMENT exactly "development" and no POST_EVENT_BUS_NAME. app.settings
refuses that environment beside a bus name or inside a Lambda. The session
factory is injected, so this module needs no app.dependencies import; nothing
it imports reaches that module, and it must stay that way.

Delivery is at most once. There is no redelivery locally, which is fine for dev
tooling.
"""

from __future__ import annotations

import json
from collections.abc import Callable

from aws_lambda_powertools import Logger
from sqlalchemy.orm import Session

from app.eventbus import EventPublisher
from app.notifications.consumer import handle_domain_event
from app.notifications.email import EmailSender
from app.notifications.models import Notification

logger = Logger()


class LocalEmailSender(EmailSender):
    """Sends nothing. Not app.notifications.email.SesEmailSender: a developer's
    .env could set a from-address, and that class would then send real mail."""

    def send(self, *, recipient_cognito_sub: str, notification: Notification) -> None:
        pass


class LocalDispatchPublisher(EventPublisher):
    """Runs the consumer inside put_event, which both notifying sites call after
    their commit, so a new session sees the row and any lock is released."""

    def __init__(self, open_session: Callable[[], Session]) -> None:
        self._open_session = open_session
        self._email_sender = LocalEmailSender()

    def put_event(self, *, source: str, detail_type: str, detail: str) -> None:
        try:
            with self._open_session() as session:
                handle_domain_event(
                    session,
                    event_name=detail_type,
                    detail=json.loads(detail),
                    email_sender=self._email_sender,
                )
        except Exception as exc:  # noqa: BLE001 -- logged below, see the comment
            # Broad on purpose: in production the consumer is asynchronous, so
            # its failure can never fail the request that published the event.
            # The exception's type only: its message or traceback can carry user
            # and post ids (a SQLAlchemy error prints its statement parameters).
            logger.error(
                "local notification dispatch failed",
                extra={"event_name": detail_type, "exception_type": type(exc).__name__},
            )
