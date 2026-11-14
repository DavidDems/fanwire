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

Security: POST /posts, DELETE /posts/{post_id}, the like/unlike routes,
the repost/un-repost routes, and the report route all
require a verified caller (get_current_user) -- author_id/user_id/
reporter_id are always resolved server-side, never trusted from the
client. GET /posts/{post_id} and GET /posts/{post_id}/replies are public
reads, no auth -- matching GET /events/... and GET /users/{id}'s guest-read
precedent (reading a post doesn't require being logged in).

A post its owner deleted (POSTS-004) is "Post not found" to every route
here except DELETE /posts/{post_id} itself, which stays idempotent for the
owner; 403 for anyone else, since the post is public and there is nothing
to hide by answering 404.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dependencies import get_event_bus, get_session
from app.eventbus import PostEventBus
from app.posts.data_link import DataLinkRefused
from app.posts.dependencies import get_publish_post_facade
from app.posts.facade import (
    CreatePostRequest as FacadePostRequest,
)
from app.posts.facade import (
    MediaNotFoundError,
    MediaNotProcessedError,
    PostNotFoundError,
    PublishPostFacade,
)
from app.posts.models import Post
from app.posts.moderation import PostRejected, RateLimitExceeded
from app.posts.schemas import CreatePostRequest, PostOut
from app.posts.service import (
    AlreadyLikedError,
    NotLikedError,
    NotPostOwnerError,
    PlainRepostDeleteError,
    RepostInUseError,
    delete_post,
    like_post,
    replies_to,
    report_post,
    repost_post,
    unlike_post,
    unrepost_post,
    visible_post,
)
from app.users.dependencies import get_current_user
from app.users.models import User

router = APIRouter(prefix="/posts", tags=["posts"])


def _post_not_found() -> HTTPException:
    """The one 404 body for an unknown or deleted post, on every route."""
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")


# Both routes that publish a post answer 429 when the author's rate limit
# (app.posts.moderation.RateLimitCheck) refuses it, 400 for any other
# moderation refusal.
_RATE_LIMITED: dict[int | str, dict[str, object]] = {
    status.HTTP_429_TOO_MANY_REQUESTS: {"description": "Post rate limit exceeded"}
}


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=PostOut,
    responses=_RATE_LIMITED,
)
def create_post(
    body: CreatePostRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    facade: PublishPostFacade = Depends(get_publish_post_facade),
) -> Post:
    """A refused data_link (app.posts.data_link.DataLinkRefused) answers 422
    with its machine code as the detail; a malformed one is Pydantic's own
    422."""
    request = FacadePostRequest(
        author_id=current_user.id,
        text=body.text,
        is_reply=body.is_reply,
        parent_post_id=body.parent_post_id,
        is_repost=body.is_repost,
        original_post_id=body.original_post_id,
        media_ids=body.media_ids,
        data_link=body.data_link.to_link() if body.data_link is not None else None,
    )
    try:
        return facade.publish(request)
    except DataLinkRefused as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=exc.code
        ) from exc
    except RateLimitExceeded as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=exc.reason
        ) from exc
    except PostRejected as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.reason) from exc
    except PostNotFoundError as exc:
        raise _post_not_found() from exc
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
    """404 for an unknown post and for one hidden by app.posts.service's
    visibility rule (deleted, or its author deactivated)."""
    post = visible_post(session, post_id)
    if post is None:
        raise _post_not_found()
    return post


@router.delete(
    "/{post_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        status.HTTP_403_FORBIDDEN: {"description": "Not the caller's post"},
        status.HTTP_404_NOT_FOUND: {"description": "Post not found"},
        status.HTTP_409_CONFLICT: {"description": "A plain repost: use DELETE .../repost"},
    },
)
def delete(
    post_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    """The owner's soft delete (app.posts.service.delete_post): 204, again
    on a repeat; 403 for someone else's post; 409 for a plain repost, which
    DELETE /posts/{original}/repost removes instead."""
    try:
        delete_post(session, user_id=current_user.id, post_id=post_id)
    except PostNotFoundError as exc:
        raise _post_not_found() from exc
    except NotPostOwnerError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except PlainRepostDeleteError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("/{post_id}/replies", response_model=list[PostOut])
def list_replies(post_id: int, session: Session = Depends(get_session)) -> list[Post]:
    """Direct replies only, oldest first (natural thread reading order),
    under the same visibility rule as the thread (app.posts.service.
    replies_to). Returns an empty list both when the post has no replies
    and when the post doesn't exist at all -- those two cases look the same
    here, and that's fine (a caller who needs to know the post itself
    exists already has GET /posts/{post_id} for that)."""
    return replies_to(session, post_id)


@router.post("/{post_id}/like", status_code=status.HTTP_204_NO_CONTENT)
def like(
    post_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    try:
        like_post(session, user_id=current_user.id, post_id=post_id)
    except PostNotFoundError as exc:
        raise _post_not_found() from exc
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
    except PostNotFoundError as exc:
        raise _post_not_found() from exc
    except NotLikedError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post(
    "/{post_id}/repost",
    status_code=status.HTTP_201_CREATED,
    response_model=PostOut,
    responses={
        status.HTTP_200_OK: {"model": PostOut, "description": "Already reposted"},
        **_RATE_LIMITED,
    },
)
def repost(
    post_id: int,
    response: Response,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    facade: PublishPostFacade = Depends(get_publish_post_facade),
) -> Post:
    """The one-click repost: 201 with the caller's new plain repost, or 200
    with the one they already have (idempotent and race-free, see
    app.posts.service.repost_post)."""
    try:
        post, created = repost_post(session, facade, user_id=current_user.id, post_id=post_id)
    except PostNotFoundError as exc:
        raise _post_not_found() from exc
    except RateLimitExceeded as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=exc.reason
        ) from exc
    except PostRejected as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.reason) from exc
    if not created:
        response.status_code = status.HTTP_200_OK
    return post


@router.delete(
    "/{post_id}/repost",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={status.HTTP_409_CONFLICT: {"description": "A repost to remove is in use"}},
)
def unrepost(
    post_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    """The undo: removes the caller's plain reposts of the post. 204
    whether or not there was anything to remove; 409, removing nothing,
    when one of them has a reply (or a repost) of its own."""
    try:
        unrepost_post(session, user_id=current_user.id, post_id=post_id)
    except RepostInUseError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


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
        raise _post_not_found() from exc
