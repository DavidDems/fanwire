"""History's opaque keyset cursor: validated once, at the HTTP boundary."""

from __future__ import annotations

import base64
import binascii
from typing import Annotated

from fastapi import HTTPException
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, ValidationError

from app.posts.service import HistoryTab


class HistoryPosition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tab: HistoryTab
    post_id: Annotated[int, Field(strict=True, gt=0, le=9_223_372_036_854_775_807)]
    liked_at: AwareDatetime | None

    def encode(self) -> str:
        return base64.urlsafe_b64encode(self.model_dump_json().encode()).decode().rstrip("=")


def decode_history_cursor(cursor: str | None, tab: HistoryTab) -> HistoryPosition | None:
    if cursor is None:
        return None
    try:
        if not cursor or len(cursor) > 512:
            raise ValueError("Invalid cursor length")
        payload = base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True)
        position = HistoryPosition.model_validate_json(payload)
        if position.tab != tab or (position.liked_at is not None) != (tab == "likes"):
            raise ValueError("Cursor does not match tab")
        return position
    except (ValueError, binascii.Error, ValidationError) as exc:
        raise HTTPException(status_code=422, detail="Invalid history cursor") from exc
