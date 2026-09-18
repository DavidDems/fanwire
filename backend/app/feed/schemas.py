"""Response envelopes for feed/'s routes -- kept separate from
app.feed.views.PostView, which search/ (a later unit, per this unit's task
brief) also needs to import without pulling in these route-level wrapper
shapes.
"""

from __future__ import annotations

from pydantic import BaseModel

from app.feed.views import PostView


class FeedPage(BaseModel):
    items: list[PostView]
    next_before_id: int | None


class ThreadView(BaseModel):
    root: PostView
    replies: list[PostView]
