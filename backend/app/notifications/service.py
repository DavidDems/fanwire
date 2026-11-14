"""Notifications-owned account removal, inside the caller's transaction."""

from collections.abc import Collection

from sqlalchemy import and_, delete, or_
from sqlalchemy.orm import Session

from app.notifications.models import Notification, NotificationPreference, NotificationType


def remove_account_notifications(session: Session, user_id: int, post_ids: Collection[int]) -> None:
    session.execute(
        delete(Notification).where(
            or_(
                Notification.recipient_user_id == user_id,
                Notification.actor_user_id == user_id,
                and_(
                    Notification.type == NotificationType.FOLLOW,
                    Notification.reference_id == user_id,
                ),
                and_(
                    Notification.type.in_([NotificationType.REPLY, NotificationType.REPOST]),
                    Notification.reference_id.in_(post_ids),
                ),
            )
        )
    )
    session.execute(delete(NotificationPreference).where(NotificationPreference.user_id == user_id))
