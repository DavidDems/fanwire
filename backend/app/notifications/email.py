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

from app.notifications.models import Notification


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
