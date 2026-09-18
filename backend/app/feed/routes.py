"""feed/ HTTP routes.

Security: both routes use get_optional_current_user (users/'s auth
dependency, the sanctioned cross-module contact point) -- no Authorization
header at all is a guest request (the guest feed / a guest's read of a
thread), a valid token personalizes GET /feed, and a *present but invalid*
token still 401s, inherited from get_optional_current_user itself. Reading
a feed/thread never requires being logged in, matching GET /posts/... and
GET /events/...'s guest-read precedent.

No tables, no migrations here -- feed/ is a pure computation layer over
posts/users/media/events' public read functions (0x00-architecture.md
Connection rule; wiki/CodeContext/Modules/0x06-feed.md).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.dependencies import get_session
from app.events.dependencies import get_live_score_proxy
from app.events.proxy import CachedEventProxy
from app.feed.schemas import FeedPage, ThreadView
from app.feed.strategies import strategy_for
from app.feed.views import assemble_post_views
from app.posts.models import Post
from app.posts.service import replies_to
from app.users.dependencies import get_optional_current_user
from app.users.models import User

router = APIRouter(prefix="/feed", tags=["feed"])

_DEFAULT_LIMIT = 20
_MAX_LIMIT = 50


@router.get("", response_model=FeedPage)
def get_feed(
    before_id: int | None = None,
    limit: int = Query(default=_DEFAULT_LIMIT, ge=1, le=_MAX_LIMIT),
    viewer: User | None = Depends(get_optional_current_user),
    session: Session = Depends(get_session),
    live_score_proxy: CachedEventProxy | None = Depends(get_live_score_proxy),
) -> FeedPage:
    strategy = strategy_for(viewer)
    posts = strategy.select_posts(session, before_id=before_id, limit=limit)
    items = assemble_post_views(
        session,
        posts,
        viewer_id=viewer.id if viewer is not None else None,
        live_scores=live_score_proxy,
    )
    # A full page (by the underlying query, not by however many views came
    # back after assemble_post_views' defensive author-soft-delete-race
    # drop) is the signal there may be more -- the cursor is always the
    # last *queried* post's id, matching what query_feed_posts' own
    # before_id contract expects on the next call.
    next_before_id = posts[-1].id if len(posts) == limit else None
    return FeedPage(items=items, next_before_id=next_before_id)


@router.get("/thread/{post_id}", response_model=ThreadView)
def get_thread(
    post_id: int,
    viewer: User | None = Depends(get_optional_current_user),
    session: Session = Depends(get_session),
    live_score_proxy: CachedEventProxy | None = Depends(get_live_score_proxy),
) -> ThreadView:
    root_post = session.get(Post, post_id)
    if root_post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")

    replies = replies_to(session, post_id)
    views = assemble_post_views(
        session,
        [root_post, *replies],
        viewer_id=viewer.id if viewer is not None else None,
        live_scores=live_score_proxy,
    )
    views_by_id = {view.id: view for view in views}

    root_view = views_by_id.get(post_id)
    if root_view is None:
        # The root existed at session.get() above but assemble_post_views
        # dropped it (its author was soft-deleted in between) -- same
        # not-found outcome a caller would see either way.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")

    reply_views = [views_by_id[reply.id] for reply in replies if reply.id in views_by_id]
    return ThreadView(root=root_view, replies=reply_views)
