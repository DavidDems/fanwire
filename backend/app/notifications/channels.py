"""NotificationChannel -- Factory Method product interface, per
wiki/CodeContext/Standards/gof-patterns.md "Factory Method". Calling code
(app.notifications.consumer) depends only on this interface, never a
concrete channel class.

Naming note (see wiki/CodeContext/Modules/0x05-notifications.md): the wiki's
GoF section names this interface `Notification` (mirroring wiki/CodeContext/
Standards/gof-patterns.md's reference project, which returns
`EmailNotification`/`PushNotification`/`InAppNotification`). That name is
already taken here by the ORM model class (app.notifications.models.
Notification), so the abstract delivery interface is named
NotificationChannel instead, with concrete classes EmailNotificationChannel
and InAppNotificationChannel.

Only two concrete channels exist for v1 -- no PushNotification(Channel):
nothing in the business rules asks for a third channel (wiki/CodeContext/
Standards/design-principles.md YAGNI), and the wiki's own "Bridge --
deliberately not applied" section is explicit that the transport axis is
fixed at exactly two for v1 (in-app mandatory, email optional).
"""

from __future__ import annotations

import abc

from sqlalchemy.orm import Session

from app.notifications.email import EmailSender
from app.notifications.models import Notification
from app.users.models import User


class NotificationChannel(abc.ABC):
    """Factory Method product interface. Every channel is invoked
    uniformly regardless of concrete type -- calling code never branches on
    which channel it holds."""

    @abc.abstractmethod
    def deliver(self, session: Session, notification: Notification, *, recipient: User) -> None:
        """Deliver `notification` to `recipient`."""


class InAppNotificationChannel(NotificationChannel):
    """No-op beyond the already-persisted Notification row: in-app display
    *is* the stored row (wiki/CodeContext/Modules/0x05-notifications.md --
    in-app notifications are mandatory and can't be disabled). This class
    exists mainly so Factory Method dispatch stays uniform across both
    channels, not because it does real delivery work."""

    def deliver(self, session: Session, notification: Notification, *, recipient: User) -> None:
        return None


class EmailNotificationChannel(NotificationChannel):
    """Delivers via an injected EmailSender, keyed by the recipient's
    cognito_sub -- never a plaintext email address, see
    app.notifications.email.EmailSender."""

    def __init__(self, email_sender: EmailSender) -> None:
        self._email_sender = email_sender

    def deliver(self, session: Session, notification: Notification, *, recipient: User) -> None:
        self._email_sender.send(
            recipient_cognito_sub=recipient.cognito_sub, notification=notification
        )


class UnknownNotificationChannelError(ValueError):
    """Raised by NotificationFactory.create() for any channel name other
    than "email"/"in_app" -- fail fast, no silent default."""


class NotificationFactory:
    """Factory Method: create(channel) returns a NotificationChannel;
    calling code never instantiates a concrete channel class directly.
    Holds the EmailSender dependency so create("email") returns an
    already-wired EmailNotificationChannel."""

    def __init__(self, email_sender: EmailSender) -> None:
        self._email_sender = email_sender

    def create(self, channel: str) -> NotificationChannel:
        if channel == "email":
            return EmailNotificationChannel(self._email_sender)
        if channel == "in_app":
            return InAppNotificationChannel()
        raise UnknownNotificationChannelError(f"Unknown notification channel: {channel!r}")
