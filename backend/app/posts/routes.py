"""posts/ HTTP routes -- the last unit of the posts/ module and of the
whole Phase 2 mandate.

Not wired into app.main yet by this module -- see app.main for the
include_router call that closes that gap.

Two same-named `CreatePostRequest` classes exist: the Pydantic one in
app.posts.schemas (the request body) and the dataclass one in
app.posts.facade (what PublishPostFacade actually consumes). Imported here
under distinct names -- `CreatePostRequest` (schemas, the body) and
`FacadePostRequest` (facade, what gets passed to `facade.publish`) -- to
stay unambiguous.

Security: POST /posts, the like/unlike routes, and the report route all
require a verified caller (get_current_user) -- author_id/user_id/
reporter_id are always resolved server-side, never trusted from the
client. GET /posts/{post_id} and GET /posts/{post_id}/replies are public
reads, no auth -- matching GET /events/... and GET /users/{id}'s guest-read
precedent (reading a post doesn't require being logged in).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dependencies import get_event_bus, get_session
from app.eventbus import PostEventBus
from app.posts.dependencies import get_publish_post_facade
from app.posts.facade import (
    CreatePostRequest as FacadePostRequest,
)
from app.posts.facade import (
    MediaNotFoundError,
    MediaNotProcessedError,
    PublishPostFacade,
)
from app.posts.models import Post
from app.posts.moderation import PostRejected
from app.posts.schemas import CreatePostRequest, PostOut
from app.posts.service import (
    AlreadyLikedError,
    NotLikedError,
    PostNotFoundError,
    like_post,
    report_post,
    unlike_post,
)
from app.users.dependencies import get_current_user
from app.users.models import User

router = APIRouter(prefix="/posts", tags=["posts"])


@router.post("", status_code=status.HTTP_201_CREATED, response_model=PostOut)
def create_post(
    body: CreatePostRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    facade: PublishPostFacade = Depends(get_publish_post_facade),
) -> Post:
    request = FacadePostRequest(
        author_id=current_user.id,
        text=body.text,
        is_reply=body.is_reply,
        parent_post_id=body.parent_post_id,
        is_repost=body.is_repost,
        original_post_id=body.original_post_id,
        media_ids=body.media_ids,
    )
    try:
        return facade.publish(request)
    except PostRejected as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.reason) from exc
    except MediaNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except MediaNotProcessedError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid post -- check parent_post_id/original_post_id and "
            "is_reply/is_repost combinations",
        ) from exc


@router.get("/{post_id}", response_model=PostOut)
def get_post(post_id: int, session: Session = Depends(get_session)) -> Post:
    post = session.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    return post


@router.get("/{post_id}/replies", response_model=list[PostOut])
def list_replies(post_id: int, session: Session = Depends(get_session)) -> list[Post]:
    """Direct replies only, oldest first (natural thread reading order).
    Returns an empty list both when the post has no replies and when the
    post doesn't exist at all -- those two cases look the same here, and
    that's fine (a caller who needs to know the post itself exists already
    has GET /posts/{post_id} for that)."""
    stmt = (
        select(Post)
        .where(Post.parent_post_id == post_id)
        .order_by(Post.created_at.asc())
    )
    return list(session.scalars(stmt).all())


@router.post("/{post_id}/like", status_code=status.HTTP_204_NO_CONTENT)
def like(
    post_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    try:
        like_post(session, user_id=current_user.id, post_id=post_id)
    except AlreadyLikedError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.delete("/{post_id}/like", status_code=status.HTTP_204_NO_CONTENT)
def unlike(
    post_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    try:
        unlike_post(session, user_id=current_user.id, post_id=post_id)
    except NotLikedError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/{post_id}/report", status_code=status.HTTP_204_NO_CONTENT)
def report(
    post_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    event_bus: PostEventBus = Depends(get_event_bus),
) -> None:
    # Idempotent per report_post's own contract -- 204 whether this was the
    # first report or a repeat; the caller can't (and doesn't need to)
    # distinguish the two from the response.
    try:
        report_post(session, event_bus, post_id=post_id, reporter_id=current_user.id)
    except PostNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
