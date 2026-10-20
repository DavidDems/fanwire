# USERS-003 — account status and the three dependency paths

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

Stage 1 of `wiki/GeneralContext/Prompts/18-posts-lifecycle-and-data-links.md`
(the human's feature set, `Architecture/human-decisions.md` §9). Accounts
already soft-delete (`User.deleted_at`, `DELETE /users/me`), but a deactivated
account answers exactly like one that never made a profile: `get_current_user`
filters `deleted_at IS NULL` and 404s. The client reads that 404 as "go to
profile creation", and there is no way back. This unit gives deactivation a
visible state and a recovery route. The frontend for both is `FRONTEND-012`.

## The design

Three dependency paths, all in `app/users/dependencies.py`:

| Path | Dependency | Anonymous | Deactivated | Active |
|---|---|---|---|---|
| Public read | `get_optional_current_user` (unchanged) | `None` | `None` (guest) | the user |
| Active account (every write, private reads) | `get_current_user` | 401 | **403 `account_deactivated`** | the user |
| Own account (recover, deactivate) | `get_own_account` (new) | 401 | the user | the user |

- **One signal for deactivation: `403 {"detail": "account_deactivated"}`.**
  A machine code, not a sentence, because the client branches on it. Every
  active-path route answers it, so a tab that was signed in when the account
  was deactivated somewhere else learns it on its next write. `GET /users/me`
  stays on the active path and so answers it too: that is how the client
  learns, after sign-in, to show the recovery screen instead of profile
  creation. **No `MeOut` field is added**: a new required response field
  would break every typed `MeOut` fixture in the frontend's tests, which this
  unit may not touch.
- **`POST /users/me/recover`** on `get_own_account`: clears `deleted_at`,
  returns `MeOut`. Idempotent. A recovery service function in
  `app.users.service` next to `soft_delete_user`.
- **`DELETE /users/me` moves to `get_own_account`** so a repeat is a 204
  no-op that keeps the first timestamp ("repeated delete and recover are
  safe"). `soft_delete_user` currently fails fast with `UserNotFoundError` on
  an already-deleted row; make the repeat a no-op instead.
- **Checked on every request.** Already true (the dependency queries the row
  each time), so a token issued before deactivation can't outlive it. The
  criteria pin it with one unchanged token across the whole sequence.
- **Cognito is untouched.** Sign-in must keep working, or recovery couldn't be
  authenticated.

## The route-walking test

The "every write" rule is enforced by a test, not by review: walk
`app.routes`, keep `fastapi.routing.APIRoute`s, and for each method other than
GET/HEAD, collect the callables in `route.dependant` recursively
(`dependant.dependencies[*].call`). Fail on any route whose tree lacks
`get_current_user` unless it is on the three-entry allowlist. Name each
allowlist entry with its reason, and fail on a stale one. Put it at
`backend/tests/test_route_auth.py`. `POST /users` is allowlisted because it
creates the account, on `get_current_identity`.

## Traps

- **Existing tests that assert 404 for a deleted caller** on a write route
  now get 403. Change those assertions in the test commit, and only those:
  `grep -rn deleted_at backend/tests/` is the start of the list.
- `get_optional_current_user` already returns `None` for a deactivated
  account. Pin it with a test; don't rewrite it.
- The route order rule in `app/users/routes.py`'s docstring: `/me/recover`
  goes with the other `/me` routes, before `/{user_id}`.
- `notifications/`, `media/` and `posts/` routes need no change: they already
  depend on `get_current_user`. They are forbidden paths for that reason.

## Not in this task

Any frontend screen (`FRONTEND-012`), post soft delete (`POSTS-004`, which
adds the "recovery never restores an individually deleted post" test once
`Post.deleted_at` exists), Cognito account changes, and hard deletion.
