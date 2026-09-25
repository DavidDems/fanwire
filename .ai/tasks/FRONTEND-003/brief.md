# FRONTEND-003 — profile and follow

Depends on `FRONTEND-002` being on `main`.

## The rule this unit is most likely to break

**Date of birth is private.** It renders on the user's own profile and in
settings. It renders nowhere on a public profile view.

This is not a display preference. The backend's public user response was fixed
once already for leaking it, and the frontend is the second place the same leak
can happen — by rendering a shared `<ProfileHeader>` that takes a whole user
object and shows every field it finds. Write the test that asserts the public
view contains no date of birth, and let it constrain the component design.

## Optimistic update, and what "rollback" means

Follow and unfollow update the button and the follower count **before** the
request returns, and restore both if it fails. react-query's mutation lifecycle
does this; a hand-rolled `useState` next to a `useEffect` does not, and produces
a count that drifts out of sync with the cache after the second interaction.

"Restores the previous state" means the count too, not just the button. Those
are the two things a user sees change.

## Partial updates

`PATCH /users/me` is a patch. Send the fields the user actually changed and omit
the rest — do not send `null` for an untouched field, which reads as "clear
this" rather than "leave it".

## Profile picture

The upload widget belongs to `FRONTEND-004`. If that unit has landed, reuse its
widget. If it has not, **ship without the picture control** and say so in the PR
and in the wiki entry. Do not build a second uploader here — a duplicate media
upload path is exactly the kind of thing the connection rule exists to stop, and
it would then need deleting rather than merging.

## Anonymous visitors

A public profile is readable without a token. The follow control still renders,
and prompts sign-in when used. It must not fire an unauthenticated
`POST /users/{id}/follow` and show the user a 401.
