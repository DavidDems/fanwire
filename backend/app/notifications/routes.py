"""notifications/ HTTP routes.

Security: all four routes require a verified caller (get_current_user) --
recipient_user_id is always resolved server-side from the caller's own
User row, never trusted from the client, matching every other "my own
data" route in this codebase (e.g. app.users.routes.delete_me).

GET /notifications has no pagination -- YAGNI, matches this repo's existing
precedent for GET /events/teams, GET /events/games (small-scale, revisit
later if needed). It leaves out reply and repost notifications whose post
its owner has since deleted (POSTS-004), learned through posts/' read
interface (app.posts.service.deleted_post_ids, one query per list), never
by reading posts/' table: a follow's reference_id is a user id, so only
reply/repost rows are checked.

POST /notifications/{notification_id}/clear never leaks whether an id
exists for another user -- 404 both when the id doesn't exist at all and
when it belongs to someone else, same least-privilege precedent as
DELETE /users/me. Idempotent: already-cleared is a no-op, 204 either way.

GET/PUT /notifications/preference read/write NotificationPreference by the
caller's own id only. GET returns email_notifications_enabled=True when no
row exists yet (matches the column's stated default), rather than
requiring a row to have been created first.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dependencies import get_session
from app.notifications.models import Notification, NotificationPreference, NotificationType
from app.notifications.schemas import (
    NotificationOut,
    NotificationPreferenceOut,
    UpdateNotificationPreferenceRequest,
)
from app.posts.service import deleted_post_ids
from app.users.dependencies import get_current_user
from app.users.models import User

router = APIRouter(prefix="/notifications", tags=["notifications"])

# The types whose reference_id names a post (a follow's names a user).
_POST_REFERENCES = {NotificationType.REPLY, NotificationType.REPOST}


@router.get("", response_model=list[NotificationOut])
def list_notifications(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[Notification]:
    stmt = (
        select(Notification)
        .where(
            Notification.recipient_user_id == current_user.id,
            Notification.cleared_at.is_(None),
        )
        .order_by(Notification.created_at.desc())
    )
    notifications = list(session.scalars(stmt).all())
    post_ids = {
        n.reference_id
        for n in notifications
        if n.type in _POST_REFERENCES and n.reference_id is not None
    }
    deleted = deleted_post_ids(session, post_ids)
    return [
        n for n in notifications if not (n.type in _POST_REFERENCES and n.reference_id in deleted)
    ]


@router.post("/{notification_id}/clear", status_code=status.HTTP_204_NO_CONTENT)
def clear_notification(
    notification_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    notification = session.scalar(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.recipient_user_id == current_user.id,
        )
    )
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")

    if notification.cleared_at is None:
        notification.cleared_at = datetime.now(UTC)
        session.commit()


@router.get("/preference", response_model=NotificationPreferenceOut)
def get_preference(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> NotificationPreferenceOut:
    preference = session.get(NotificationPreference, current_user.id)
    enabled = True if preference is None else preference.email_notifications_enabled
    return NotificationPreferenceOut(email_notifications_enabled=enabled)


@router.put("/preference", response_model=NotificationPreferenceOut)
def update_preference(
    body: UpdateNotificationPreferenceRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> NotificationPreferenceOut:
    preference = session.get(NotificationPreference, current_user.id)
    if preference is None:
        preference = NotificationPreference(
            user_id=current_user.id,
            email_notifications_enabled=body.email_notifications_enabled,
        )
        session.add(preference)
    else:
        preference.email_notifications_enabled = body.email_notifications_enabled
    session.commit()
    return NotificationPreferenceOut(
        email_notifications_enabled=preference.email_notifications_enabled
    )
