"""Pydantic request/response models for posts/ routes.

`PostOut.model_config = ConfigDict(from_attributes=True)` lets it build
directly from app.posts.models.Post ORM instances (FastAPI's
`response_model` doing that implicitly), same pattern as
app.users.schemas.UserOut / app.media.schemas.MediaOut.

`CreatePostRequest` deliberately has no `author_id` -- always resolved
server-side from get_current_user, never trusted from the client, matching
every other write route in this codebase (app.users.routes.create_profile,
app.media.routes.create_upload).

`data_link` (POSTS-005) is a discriminated union on `type`: each member
forbids extra keys, and only `player_career` takes a `scope`, so a malformed
attachment is Pydantic's 422 at the boundary. Its target is checked later,
by PublishPostFacade. `PostOut.data_link` has the same shape, read from
Post.data_link (app.posts.data_link.DataLink, the one mapping onto Post's
columns).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PositiveInt

from app.posts.data_link import CareerScope, DataLink, DataLinkType


class GameFinalLink(BaseModel):
    """A game's final score; `ref_id` is a games.id."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["game_final"]
    ref_id: PositiveInt

    def to_link(self) -> DataLink:
        return DataLink(type=self.type, ref_id=self.ref_id)


class PlayerGameLink(BaseModel):
    """A player's line in one game; `ref_id` is a player_game_stats.id."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["player_game"]
    ref_id: PositiveInt

    def to_link(self) -> DataLink:
        return DataLink(type=self.type, ref_id=self.ref_id)


class PlayerCareerLink(BaseModel):
    """A player's career averages over one scope; `ref_id` is a players.id."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["player_career"]
    ref_id: PositiveInt
    scope: CareerScope

    def to_link(self) -> DataLink:
        return DataLink(type=self.type, ref_id=self.ref_id, scope=self.scope)


DataLinkIn = Annotated[
    GameFinalLink | PlayerGameLink | PlayerCareerLink, Field(discriminator="type")
]


class DataLinkOut(BaseModel):
    """A stored attachment: `scope` is null except for a player_career."""

    model_config = ConfigDict(from_attributes=True)

    type: DataLinkType
    ref_id: int
    scope: CareerScope | None


class CreatePostRequest(BaseModel):
    text: str | None = None
    is_reply: bool = False
    parent_post_id: int | None = None
    is_repost: bool = False
    original_post_id: int | None = None
    media_ids: list[int] = []
    data_link: DataLinkIn | None = None


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
    data_link: DataLinkOut | None
