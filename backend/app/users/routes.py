"""users/ HTTP routes.

Not wired into app.main yet -- a later unit wires all three modules'
routers (events/users/media) in together.

Security (wiki/CodeContext/Modules/0x01-users.md Security section): all
writes require a Cognito token verified server-side on every request;
GET /users/{user_id} (viewing another user's account page) is a public
read path, per the guest-feed requirement.

POST /users is the profile-creation endpoint called right after a Cognito
signup confirms -- it depends on get_current_identity (not get_current_user
-- there's no User row yet, that's the point), and the verified token's
`sub` *is* the cognito_sub used to create the row. This is deliberate
(judgment call from the unit's manager): simpler than a separate Cognito
Post-Confirmation Lambda trigger, keeps everything in the one
Mangum-wrapped app.

DELETE /users/me soft-deletes only the *caller's own* profile -- there is
no DELETE /users/{id} for an arbitrary id. Least-privilege: nothing lets
one user soft-delete another's row. `{user_id}` in the follow routes is
always the *target* of the action, never the actor -- who is acting always
comes from get_current_user (the verified token), never a client-supplied
id.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dependencies import get_session
from app.users.auth import VerifiedIdentity
from app.users.dependencies import get_current_identity, get_current_user
from app.users.models import User
from app.users.schemas import CreateUserRequest, UserOut
from app.users.service import (
    AlreadyFollowingError,
    NotFollowingError,
    SelfFollowError,
    create_user,
    follow,
    soft_delete_user,
    unfollow,
)

router = APIRouter(prefix="/users", tags=["users"])


@router.post("", status_code=status.HTTP_201_CREATED, response_model=UserOut)
def create_profile(
    body: CreateUserRequest,
    identity: VerifiedIdentity = Depends(get_current_identity),
    session: Session = Depends(get_session),
) -> User:
    try:
        return create_user(
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


@router.get("/{user_id}", response_model=UserOut)
def get_profile(user_id: int, session: Session = Depends(get_session)) -> User:
    user = session.scalar(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_me(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    soft_delete_user(session, current_user.id)


@router.post("/{user_id}/follow", status_code=status.HTTP_204_NO_CONTENT)
def follow_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    try:
        follow(session, follower_user_id=current_user.id, followed_user_id=user_id)
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
