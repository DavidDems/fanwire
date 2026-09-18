"""Pydantic request/response models for posts/ routes.

`PostOut.model_config = ConfigDict(from_attributes=True)` lets it build
directly from app.posts.models.Post ORM instances (FastAPI's
`response_model` doing that implicitly), same pattern as
app.users.schemas.UserOut / app.media.schemas.MediaOut.

`CreatePostRequest` deliberately has no `author_id` -- always resolved
server-side from get_current_user, never trusted from the client, matching
every other write route in this codebase (app.users.routes.create_profile,
app.media.routes.create_upload).
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CreatePostRequest(BaseModel):
    text: str | None = None
    is_reply: bool = False
    parent_post_id: int | None = None
    is_repost: bool = False
    original_post_id: int | None = None
    media_ids: list[int] = []


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    author_id: int
    text: str | None
    is_reply: bool
    parent_post_id: int | None
    is_repost: bool
    original_post_id: int | None
    reported: bool
    created_at: datetime
