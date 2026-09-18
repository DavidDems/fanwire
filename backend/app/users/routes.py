"""users/ HTTP routes.

Security (wiki/CodeContext/Modules/0x01-users.md Security section): all
writes require a Cognito token verified server-side on every request;
GET /users/{user_id} (viewing another user's account page) is a public
read path, per the guest-feed requirement.

Route order matters: every `/me...` route is declared BEFORE
`/{user_id}` in this file. FastAPI/Starlette matches routes in
registration order against a dynamic path segment regardless of type
annotation (the `int` conversion for `user_id` only rejects "me" *after*
the route already matched), so `/{user_id}` registered first would swallow
`GET /users/me`/`PATCH /users/me`/`GET /users/me/following` as a 422
("me" isn't a valid int) instead of ever reaching the real /me handlers --
see tests/users/test_routes.py's route-ordering regression test.

POST /users is the profile-creation endpoint called right after a Cognito
signup confirms -- it depends on get_current_identity (not get_current_user
-- there's no User row yet, that's the point), and the verified token's
`sub` *is* the cognito_sub used to create the row. This is deliberate
(judgment call from the unit's manager): simpler than a separate Cognito
Post-Confirmation Lambda trigger, keeps everything in the one
Mangum-wrapped app.

GET /users/me 404s exactly when get_current_user does (a verified token
with no matching User row) -- the frontend uses that 404 to route a
freshly-confirmed signup to profile creation.

DELETE /users/me soft-deletes only the *caller's own* profile -- there is
no DELETE /users/{id} for an arbitrary id. Least-privilege: nothing lets
one user soft-delete another's row. `{user_id}` in the follow routes is
always the *target* of the action, never the actor -- who is acting always
comes from get_current_user (the verified token), never a client-supplied
id.

PublicUserOut/MeOut construction: follower_count/following_count aren't
ORM attributes, so these routes build the response schema explicitly from
a User row + app.users.service's count helpers rather than returning a bare
User for `response_model` to convert (the pattern every other route in this
file still uses for its own ORM row). Per this codebase's existing layering
(schemas are only ever imported into routes.py, never service.py -- see
app.posts.facade/app.events.routes for the same split), that assembly lives
here, not in app.users.service.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dependencies import get_event_bus, get_session
from app.eventbus import PostEventBus
from app.users.auth import VerifiedIdentity
from app.users.dependencies import get_current_identity, get_current_user
from app.users.models import User
from app.users.schemas import CreateUserRequest, MeOut, PublicUserOut, UpdateMeRequest
from app.users.service import (
    AlreadyFollowingError,
    InvalidPreferredTeamError,
    InvalidProfilePictureError,
    NotFollowingError,
    SelfFollowError,
    create_user,
    follow,
    followed_user_ids,
    follower_count,
    following_count,
    soft_delete_user,
    unfollow,
    update_profile,
)

router = APIRouter(prefix="/users", tags=["users"])


def _public_out(session: Session, user: User) -> PublicUserOut:
    return PublicUserOut(
        id=user.id,
        username=user.username,
        description=user.description,
        preferred_team_id=user.preferred_team_id,
        profile_picture_media_id=user.profile_picture_media_id,
        created_at=user.created_at,
        follower_count=follower_count(session, user.id),
        following_count=following_count(session, user.id),
    )


def _me_out(session: Session, user: User) -> MeOut:
    return MeOut(**_public_out(session, user).model_dump(), date_of_birth=user.date_of_birth)


@router.post("", status_code=status.HTTP_201_CREATED, response_model=MeOut)
def create_profile(
    body: CreateUserRequest,
    identity: VerifiedIdentity = Depends(get_current_identity),
    session: Session = Depends(get_session),
) -> MeOut:
    try:
        user = create_user(
            session,
            cognito_sub=identity.sub,
            username=body.username,
            date_of_birth=body.date_of_birth,
            description=body.description,
            preferred_team_id=body.preferred_team_id,
        )
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A profile already exists for this account, the username is taken, "
            "or preferred_team_id does not reference an existing team",
        ) from exc
    return _me_out(session, user)


# --- /me routes: declared before /{user_id} — see module docstring --------


@router.get("/me", response_model=MeOut)
def get_me(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> MeOut:
    return _me_out(session, current_user)


@router.patch("/me", response_model=MeOut)
def patch_me(
    body: UpdateMeRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> MeOut:
    try:
        updated = update_profile(
            session,
            current_user.id,
            fields_set=body.model_fields_set,
            description=body.description,
            preferred_team_id=body.preferred_team_id,
            profile_picture_media_id=body.profile_picture_media_id,
        )
    except InvalidPreferredTeamError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc
    except InvalidProfilePictureError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc
    return _me_out(session, updated)


@router.get("/me/following", response_model=list[int])
def get_my_following(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[int]:
    return followed_user_ids(session, current_user.id)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_me(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    soft_delete_user(session, current_user.id)


# --- /{user_id} routes ------------------------------------------------


@router.get("/{user_id}", response_model=PublicUserOut)
def get_profile(user_id: int, session: Session = Depends(get_session)) -> PublicUserOut:
    user = session.scalar(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return _public_out(session, user)


@router.post("/{user_id}/follow", status_code=status.HTTP_204_NO_CONTENT)
def follow_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    event_bus: PostEventBus = Depends(get_event_bus),
) -> None:
    try:
        follow(
            session,
            event_bus=event_bus,
            follower_user_id=current_user.id,
            followed_user_id=user_id,
        )
    except SelfFollowError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except AlreadyFollowingError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.delete("/{user_id}/follow", status_code=status.HTTP_204_NO_CONTENT)
def unfollow_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    try:
        unfollow(session, follower_user_id=current_user.id, followed_user_id=user_id)
    except NotFollowingError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
