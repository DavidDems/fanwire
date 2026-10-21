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
    """A post and its direct replies. `root` is null, and `root_deleted`
    true, only when its owner deleted the root (POSTS-004): the surviving
    replies stay readable under a "Post deleted" placeholder."""

    root: PostView | None
    root_deleted: bool
    replies: list[PostView]
