"""Response envelopes for search/ routes.

AccountResult is deliberately its own narrow schema (id, username,
description, profile_picture_media_id) -- never app.users.models.User
handed straight to FastAPI's response_model, and never DOB, per
wiki/CodeContext/Modules/0x07-search.md and wiki/CodeContext/Modules/
0x01-users.md's DOB-privacy rule. PostsPage/GamesPage reuse feed/'s
PostView and events/'s GameOut respectively -- search/ owns no tables and
no response shapes of its own for data it doesn't originate
(0x00-architecture.md Connection rule).
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from app.events.schemas import GameOut
from app.feed.views import PostView


class AccountResult(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    description: str | None
    profile_picture_media_id: int | None


class AccountsPage(BaseModel):
    items: list[AccountResult]
    next_offset: int | None


class PostsPage(BaseModel):
    items: list[PostView]
    next_offset: int | None


class GamesPage(BaseModel):
    items: list[GameOut]
    next_offset: int | None


class GameFiltersOut(BaseModel):
    seasons: list[str]
    positions: list[str]
