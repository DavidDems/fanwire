"""EmailSender -- narrow injected interface (Dependency Inversion, same
shape as app.eventbus.EventPublisher / app.media.pipeline.MalwareScanner)
that app.notifications.channels.EmailNotificationChannel depends on.

`send` takes `recipient_cognito_sub`, never a plaintext email address: no
real SES adapter exists this phase (no live AWS this phase, same precedent
as EventPublisher/MalwareScanner), and this keeps notifications/ from ever
handling or logging PII (wiki/CodeContext/Standards/security.md; wiki/
CodeContext/Modules/0x05-notifications.md "No new PII surface" -- SES
delivery resolves the recipient's real email address from Cognito via
cognito_sub at send time, not from anything notifications/ stores or passes
as plaintext).
"""

from __future__ import annotations

import abc
from dataclasses import dataclass
from typing import Any

from aws_lambda_powertools import Logger

from app.notifications.models import Notification, NotificationType

logger = Logger()


class EmailSender(abc.ABC):
    """Narrow injected interface -- EmailNotificationChannel depends on
    this, never a concrete SES client."""

    @abc.abstractmethod
    def send(self, *, recipient_cognito_sub: str, notification: Notification) -> None:
        """Send an email for `notification` to the Cognito user identified
        by `recipient_cognito_sub`. Never passed a plaintext email address
        -- see module docstring."""


@dataclass(frozen=True)
class RecordedEmail:
    """One recorded send() call, as captured by RecordingEmailSender."""

    recipient_cognito_sub: str
    notification: Notification


class RecordingEmailSender(EmailSender):
    """Test double: records every send() call in arrival order, never
    touches SES. No real SES adapter exists this phase -- same precedent as
    app.eventbus.InMemoryEventPublisher / app.media.pipeline.
    FakeMalwareScanner."""

    def __init__(self) -> None:
        self.sent: list[RecordedEmail] = []

    def send(self, *, recipient_cognito_sub: str, notification: Notification) -> None:
        self.sent.append(
            RecordedEmail(recipient_cognito_sub=recipient_cognito_sub, notification=notification)
        )


# Minimal, no-PII copy per notification type -- never includes the actor's
# name/username/email (this class only ever has cognito subs and ids to work
# with anyway, see the module docstring's "never handling or logging PII").
_SUBJECT_BY_TYPE: dict[NotificationType, str] = {
    NotificationType.FOLLOW: "You have a new follower on fanwire",
    NotificationType.REPLY: "Someone replied to your post on fanwire",
    NotificationType.REPOST: "Someone reposted your post on fanwire",
}


class SesEmailSender(EmailSender):
    """Real production adapter. `send` is only ever given a
    `recipient_cognito_sub` (see EmailSender's own docstring) -- this class
    resolves the real email address at send time via Cognito `AdminGetUser`,
    never from anything notifications/ stores itself, then delivers via SES
    `send_email` from `from_address`.

    `from_address` empty (Settings.notification_from_address /
    NOTIFICATION_FROM_ADDRESS unset) means no SES identity exists yet --
    infra/lib/app-stack.ts only sets it once `config.domainName` is
    configured. In that case this logs (no PII: no email address, no
    cognito sub) that email is disabled and returns without calling AWS at
    all; in-app notifications (app.notifications.channels.
    InAppNotificationChannel) are unaffected -- they're delivered
    independently of this class, see app.notifications.consumer.

    Takes already-constructed boto3 clients (Dependency Inversion, same
    "inject the clients" shape as app.eventbus.EventBridgePublisher) --
    app.notifications.lambda_handler owns constructing/caching them.
    """

    def __init__(
        self, cognito_client: Any, ses_client: Any, *, user_pool_id: str, from_address: str
    ) -> None:
        self._cognito_client = cognito_client
        self._ses_client = ses_client
        self._user_pool_id = user_pool_id
        self._from_address = from_address

    def send(self, *, recipient_cognito_sub: str, notification: Notification) -> None:
        if not self._from_address:
            logger.info("email notification skipped: no NOTIFICATION_FROM_ADDRESS configured")
            return

        user = self._cognito_client.admin_get_user(
            UserPoolId=self._user_pool_id, Username=recipient_cognito_sub
        )
        email = next(
            (a["Value"] for a in user["UserAttributes"] if a["Name"] == "email"), None
        )
        if email is None:
            logger.info("email notification skipped: recipient has no email attribute in Cognito")
            return

        subject = _SUBJECT_BY_TYPE[notification.type]
        body = f"{subject}. Open fanwire to see it."
        self._ses_client.send_email(
            Source=self._from_address,
            Destination={"ToAddresses": [email]},
            Message={"Subject": {"Data": subject}, "Body": {"Text": {"Data": body}}},
        )
