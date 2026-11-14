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
    # generate_presigned_post's form fields the browser's multipart POST
    # must submit alongside the file (key, Content-Type, policy,
    # signature, ...) -- see app.media.routes. Breaking change from the
    # old presigned-PUT shape (no `fields`); no compatibility shim, the
    # frontend doesn't consume this endpoint yet (YAGNI).
    fields: dict[str, str]
    s3_key: str
    # ImageUploadPipeline.MAX_SIZE_BYTES, echoed back so the client can
    # pre-check a file before even attempting the upload. The S3 policy
    # (see app.media.routes) is the actual enforcement point.
    max_bytes: int


class MediaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: MediaStatus
    mime_type: str | None
    size_bytes: int | None
    s3_key_public: str | None
    s3_key_thumbnail: str | None
    created_at: datetime
