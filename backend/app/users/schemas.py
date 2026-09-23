"""Pydantic request/response models for users/ routes.

`PublicUserOut`/`MeOut` build directly from `app.users.models.User` ORM
instances for their shared column fields (`from_attributes=True`), but
`follower_count`/`following_count` aren't ORM attributes -- routes.py
constructs these explicitly (via `app.users.service.follower_count`/
`following_count`) rather than handing FastAPI a bare `User` row for
`response_model` to convert, same as every other schema in this codebase
that needs a computed field FastAPI's `from_attributes` can't supply on its
own.

See wiki/CodeContext/Modules/0x01-users.md for the schema these mirror.

Deliberately no `cognito_sub` on either model -- it's an internal identity-
linking detail, never a public profile field.

PII fix (wiki/CodeContext/Standards/security.md "Data protection" /
0x01-users.md Security section): `date_of_birth` used to live on one
`UserOut` returned by both the public `GET /users/{id}` and the
authenticated `POST /users`, leaking DOB to anyone who could guess/enumerate
a user id. Split into `PublicUserOut` (no DOB, used by the public read path)
and `MeOut` (adds DOB, only ever returned to the profile's own owner via
`POST /users`, `GET /users/me`, `PATCH /users/me`). See
tests/users/test_routes.py's regression test asserting `date_of_birth` is
absent from the public response.
"""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

MINIMUM_AGE_YEARS = 16


class CreateUserRequest(BaseModel):
    username: str
    date_of_birth: date
    description: str | None = None
    preferred_team_id: int | None = None

    @field_validator("date_of_birth")
    @classmethod
    def _validate_minimum_age(cls, value: date) -> date:
        """Reject a date_of_birth that isn't strictly in the past, or that
        makes the person younger than MINIMUM_AGE_YEARS whole years old
        today. Whole-years is computed by shifting the birth date forward
        by MINIMUM_AGE_YEARS and comparing to today, rather than subtracting
        floats, so a Feb 29 birth date compares correctly against a non-leap
        "today" (see wiki/CodeContext/Modules/0x01-users.md)."""
        today = date.today()
        if value >= today:
            raise ValueError("date_of_birth must be in the past")
        try:
            earliest_valid_dob = today.replace(year=today.year - MINIMUM_AGE_YEARS)
        except ValueError:
            earliest_valid_dob = today.replace(
                month=3, day=1, year=today.year - MINIMUM_AGE_YEARS
            )
        if value > earliest_valid_dob:
            raise ValueError(f"must be at least {MINIMUM_AGE_YEARS} years old")
        return value


class PublicUserOut(BaseModel):
    """Everything safe to return on the public, unauthenticated
    `GET /users/{id}` profile-page read path -- "viewing other users'
    account pages" is a public read path per wiki/CodeContext/Modules/
    0x01-users.md Security section. No `date_of_birth` here -- see MeOut.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    description: str | None
    preferred_team_id: int | None
    profile_picture_media_id: int | None
    created_at: datetime
    follower_count: int
    following_count: int


class MeOut(PublicUserOut):
    """Everything in PublicUserOut plus `date_of_birth` (PII) -- only ever
    returned on a path that proves the caller is that profile's own owner
    (`POST /users`, `GET /users/me`, `PATCH /users/me`), never on a path
    another user can reach."""

    date_of_birth: date


class UpdateMeRequest(BaseModel):
    """`PATCH /users/me` body. Uses `model_fields_set` semantics (see
    `app.users.service.update_profile`'s `fields_set` parameter): a field
    absent from the request body is left untouched; a field present with an
    explicit `null` clears it. `username`/`date_of_birth` are deliberately
    not fields on this model -- neither is editable via this endpoint.
    """

    description: str | None = Field(default=None, max_length=500)
    preferred_team_id: int | None = None
    profile_picture_media_id: int | None = None
