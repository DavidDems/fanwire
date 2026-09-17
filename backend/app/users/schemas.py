"""Pydantic request/response models for users/ routes.

`UserOut.model_config = ConfigDict(from_attributes=True)` lets it build
directly from app.users.models.User ORM instances (FastAPI's
`response_model` doing that implicitly) without a separate mapping step,
same pattern as app.events.schemas. See wiki/CodeContext/Modules/
0x01-users.md for the schema these mirror.

Deliberately no `cognito_sub` on UserOut -- it's an internal identity-
linking detail, never a public profile field.
"""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class CreateUserRequest(BaseModel):
    username: str
    date_of_birth: date
    description: str | None = None
    preferred_team_id: int | None = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    description: str | None
    date_of_birth: date
    preferred_team_id: int | None
    profile_picture_media_id: int | None
    created_at: datetime
