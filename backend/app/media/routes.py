"""media/ HTTP routes.

Not wired into app.main yet -- a later unit wires all three modules'
routers (events/users/media) in together.

Scope (deliberately minimal, per this unit's brief): presigned-upload-URL
issuance (POST /media/uploads) plus a read-back (GET /media/{media_id}).
This does NOT implement the S3-event-triggered processing Lambda that
actually runs app.media.pipeline.ImageUploadPipeline -- that pipeline is
triggered by a real S3 event in production, which doesn't exist in this
local/test setup, and is exercised directly (bypassing S3 events) by
backend/tests/media/test_pipeline.py.

Security (wiki/CodeContext/Modules/0x04-media.md Security section): the
MIME allow-list, ~5MB size cap, quarantine isolation, and "never trust
client-declared type" all apply. POST /media/uploads' mime_type check
below is a fail-fast UX check on the client-declared type at *request*
time only -- it is NOT the real trust boundary. The real boundary is
ImageUploadPipeline.validate_type's Pillow-based check once the object is
actually processed (open/parse the bytes, never trust Content-Type or
file extension) -- see app.media.pipeline's own docstring for the same
framing.

GET /media/{media_id} is uploader-only (judgment call): media isn't public
until it's attached to a Post and reaches Processed, and that surfacing
mechanism belongs to posts/'s own routes (not built yet), not to media/
itself. So for now, a caller may only look up their own upload's status;
404 (not 403) for anything else, so as not to reveal whether a given id
belongs to someone else.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.dependencies import get_session, get_settings
from app.media.dependencies import get_s3_client
from app.media.models import Media, MediaStatus
from app.media.pipeline import ImageUploadPipeline
from app.media.schemas import CreateUploadRequest, CreateUploadResponse, MediaOut
from app.settings import Settings
from app.users.dependencies import get_current_user
from app.users.models import User

router = APIRouter(prefix="/media", tags=["media"])

# Same mapping as app.media.pipeline.ImageUploadPipeline._EXTENSION_BY_MIME_TYPE,
# defined locally rather than importing that name -- it's private
# (leading underscore) to that module, an internal detail of the
# pipeline's own variant-generation step, not a contract media/ routes
# should reach into.
_EXTENSION_BY_MIME_TYPE: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


@router.post("/uploads", status_code=status.HTTP_201_CREATED, response_model=CreateUploadResponse)
def create_upload(
    body: CreateUploadRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    s3_client: Any = Depends(get_s3_client),
    settings: Settings = Depends(get_settings),
) -> CreateUploadResponse:
    # Fail-fast UX check only -- see module docstring. Not the trust
    # boundary; ImageUploadPipeline.validate_type is.
    if body.mime_type not in ImageUploadPipeline.ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"mime type {body.mime_type!r} not in allow-list",
        )

    media = Media(uploader_id=current_user.id, status=MediaStatus.UPLOADED)
    session.add(media)
    session.flush()  # assign media.id before building the S3 key, don't commit yet

    ext = _EXTENSION_BY_MIME_TYPE[body.mime_type]
    key = f"uploads/{media.id}/original.{ext}"
    media.s3_key_quarantine = key
    session.commit()

    upload_url = s3_client.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.media_quarantine_bucket,
            "Key": key,
            "ContentType": body.mime_type,
        },
        ExpiresIn=300,
    )

    return CreateUploadResponse(media_id=media.id, upload_url=upload_url, s3_key=key)


@router.get("/{media_id}", response_model=MediaOut)
def get_media(
    media_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Media:
    media = session.get(Media, media_id)
    if media is None or media.uploader_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media not found")
    return media
