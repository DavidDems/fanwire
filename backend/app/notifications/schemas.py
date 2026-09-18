"""Pydantic request/response models for notifications/ routes.

`NotificationOut.model_config = ConfigDict(from_attributes=True)` lets it
build directly from app.notifications.models.Notification ORM instances,
same pattern as app.posts.schemas.PostOut / app.users.schemas.UserOut.

NotificationPreferenceOut/UpdateNotificationPreferenceRequest are built by
hand from plain values in app.notifications.routes (not from_attributes),
since GET /notifications/preference must return a default value even when
no NotificationPreference row exists yet.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.notifications.models import NotificationType


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    recipient_user_id: int
    type: NotificationType
    actor_user_id: int
    reference_id: int | None
    created_at: datetime


class NotificationPreferenceOut(BaseModel):
    email_notifications_enabled: bool


class UpdateNotificationPreferenceRequest(BaseModel):
    email_notifications_enabled: bool
