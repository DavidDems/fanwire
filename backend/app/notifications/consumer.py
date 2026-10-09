"""app.notifications.consumer.handle_domain_event -- the PostEventBus
Observer subscriber, per wiki/CodeContext/Standards/gof-patterns.md
"Observer" and wiki/CodeContext/Modules/0x05-notifications.md.

Not wired to any live EventBridge/SQS trigger yet: app.eventbus.
PostEventBus's only real backing is InMemoryEventPublisher, which just
records published events for tests and does not dispatch to in-process
subscribers (wiki/CodeContext/Modules/0x00-architecture.md "PostEventBus
implementation"). Real EventBridge -> SQS (with a DLQ, per the wiki's AWS
mapping) -> Lambda wiring is Phase 6 CDK infra, out of scope here -- same
deferred-infra precedent as app.events.ingestion's
AbstractEventIngestionPipeline (a plain Python class, not yet wired to any
actual trigger). handle_domain_event is instead a plain, directly-
invokable, fully unit-testable function a future Lambda handler will call
once that wiring exists.

Resolved gap between the wiki's stated design and the actual PostCreated
payload: the wiki says this subscriber "distinguishes reply/repost from
the event payload's flags," but app.posts.facade.PublishPostFacade's actual
POST_CREATED detail dict is only {"post_id", "author_id"} -- no
is_reply/is_repost/parent_post_id/original_post_id. Rather than modify
app.posts.facade to add those fields, this module re-fetches the Post row
by post_id (session.get(Post, post_id)) to read those flags, and -- for a
reply/repost -- fetches the parent/original Post row the same way to find
its author_id (the notification recipient). This is a direct read of
posts/'s Post table, for lookup only, never a write -- the same kind of
narrow, explicitly-justified boundary crossing app.posts.facade already
makes into app.media.models.Media ("the one place posts/ touches media/'s
Media rows directly"); here it's the one place notifications/ touches
posts/'s Post rows directly.

Self-notification skip (judgment call, not stated in the business rules):
a self-reply/self-repost (recipient == actor) is skipped, not notified --
mirrors app.users.service's existing no-self-follow rule. UserFollowed
never hits this branch since users/ already disallows self-follow at the
source.

A row an event names that does not exist (the post, its parent or original,
the recipient) raises MissingReferenceError, before anything is committed.
Posts are never deleted and users only soft-deleted, so that is a malformed
event, not a race a retry would win: it fails the record, and SQS dead-letters
it for a human. The recipient is looked up before the commit for the same
reason -- after it, failing the record would commit a duplicate row on
redelivery (see "Email is best-effort" in the module wiki).
"""

from __future__ import annotations

from typing import Any

from aws_lambda_powertools import Logger
from sqlalchemy.orm import Session

from app.notifications.channels import NotificationFactory
from app.notifications.email import EmailSender
from app.notifications.models import Notification, NotificationPreference, NotificationType
from app.posts.models import Post  # read-only lookup only, see module docstring
from app.users.models import User

POST_CREATED = "PostCreated"
USER_FOLLOWED = "UserFollowed"

logger = Logger()


class MissingReferenceError(LookupError):
    """An event names a row that does not exist. Carries the model name only:
    the lambda handler logs the exception, and ids stay out of the logs."""


def _require[RowT: (Post, User)](session: Session, model: type[RowT], row_id: Any) -> RowT:
    row = session.get(model, row_id)
    if row is None:
        raise MissingReferenceError(f"the event names a {model.__name__} that does not exist")
    return row


def handle_domain_event(
    session: Session, *, event_name: str, detail: dict[str, Any], email_sender: EmailSender
) -> Notification | None:
    """Handle one domain event published on PostEventBus. Only
    PostCreated (reply/repost only, not a plain post) and UserFollowed are
    notification triggers, per wiki/CodeContext/Modules/
    0x05-notifications.md business rules; every other event name --
    including PostReported and PostMentionedEvent -- returns None without
    raising.

    On a notification-worthy event: always creates+persists the
    Notification row (in-app display is mandatory, not gated by
    preference), commits, then "delivers" via NotificationFactory's
    in_app channel (a no-op, for Factory Method uniformity) and, if the
    recipient's NotificationPreference.email_notifications_enabled is true
    (or no preference row exists yet -- default enabled), via the email
    channel.

    Email is a best-effort side channel: the committed Notification row is
    the durable outcome, so any exception from email delivery (e.g. SES
    MessageRejected) is logged -- notification type and id only, no PII --
    and swallowed, and the notification is still returned. Failures before
    the commit still propagate, MissingReferenceError among them (see the
    module docstring).
    """
    if event_name == POST_CREATED:
        recipient_id, actor_id, notif_type, reference_id = _resolve_post_created(session, detail)
        if recipient_id is None:
            return None  # plain post -- not a notification trigger
    elif event_name == USER_FOLLOWED:
        recipient_id = detail["followed_user_id"]
        actor_id = detail["follower_user_id"]
        notif_type = NotificationType.FOLLOW
        reference_id = actor_id
    else:
        return None

    if recipient_id == actor_id:
        return None  # self-reply/self-repost -- see module docstring

    recipient = _require(session, User, recipient_id)

    notification = Notification(
        recipient_user_id=recipient_id,
        type=notif_type,
        actor_user_id=actor_id,
        reference_id=reference_id,
    )
    session.add(notification)
    session.commit()

    factory = NotificationFactory(email_sender)

    # In-app "delivery" is always attempted for interface uniformity, even
    # though it's a no-op -- see app.notifications.channels.
    factory.create("in_app").deliver(session, notification, recipient=recipient)

    preference = session.get(NotificationPreference, recipient_id)
    email_enabled = preference is None or preference.email_notifications_enabled
    if email_enabled:
        try:
            factory.create("email").deliver(session, notification, recipient=recipient)
        except Exception:
            # Broad on purpose: the row is already committed, and failing the
            # record would make SQS redeliver it and commit a duplicate row.
            logger.exception(
                "email notification delivery failed",
                extra={
                    "notification_type": notification.type.value,
                    "notification_id": notification.id,
                },
            )

    return notification


def _resolve_post_created(
    session: Session, detail: dict[str, Any]
) -> tuple[int | None, int, NotificationType | None, int | None]:
    """Returns (recipient_id, actor_id, type, reference_id) for a
    PostCreated event, or (None, actor_id, None, None) if the new post is
    neither a reply nor a repost (a plain post -- no notification)."""
    post = _require(session, Post, detail["post_id"])
    actor_id = detail["author_id"]

    if post.is_reply:
        parent = _require(session, Post, post.parent_post_id)
        return parent.author_id, actor_id, NotificationType.REPLY, post.id
    if post.is_repost:
        original = _require(session, Post, post.original_post_id)
        return original.author_id, actor_id, NotificationType.REPOST, post.id

    return None, actor_id, None, None
