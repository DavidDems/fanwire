"""Pydantic request/response models for media/ routes.

`MediaOut.model_config = ConfigDict(from_attributes=True)` lets it build
directly from app.media.models.Media ORM instances (FastAPI's
`response_model` doing that implicitly), same pattern as
app.users.schemas.UserOut. See wiki/CodeContext/Modules/0x04-media.md for
the schema this mirrors.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.media.models import MediaStatus


class CreateUploadRequest(BaseModel):
    mime_type: str


class CreateUploadResponse(BaseModel):
    media_id: int
    upload_url: str
    s3_key: str


class MediaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: MediaStatus
    mime_type: str | None
    size_bytes: int | None
    s3_key_public: str | None
    s3_key_thumbnail: str | None
    created_at: datetime
