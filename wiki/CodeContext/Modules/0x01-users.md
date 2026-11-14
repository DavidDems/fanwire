---
type: reference
---

# 0x01 — Users

**Agent-facing.** Current-state only — see [[wiki/GeneralContext/index|index]] for how this wiki is organized and [[0x00-architecture]] for module boundaries/connection rule (not repeated here).

`users/` owns `User`, `Follow`, `AccountAuthority`, `AccountOperation` and `AccountDeletionObject` in **RDS Postgres** ([[0x00-architecture]]). Cognito owns credentials, MFA and token issuance; application authority survives profile removal ([[0x01a-users-schema]], [[0x01b-users-auth]]).

## User

### Security
- **`date_of_birth` is never shown on a public profile** (the human's decision, [[wiki/GeneralContext/Decisions/0021-date-of-birth-hidden-minimum-16|ADR 0021]]). It is held in this module's `User` row (RDS) after registration and returned only on the caller's own authenticated read/write paths (`POST /users`, `GET /users/me`, `PATCH /users/me`), never on `GET /users/{user_id}` or any other user-facing response. The `PublicUserOut`/`MeOut` schema split implements it ([[0x01c-users-routes]] "PII fix").
- "Viewing other users' account pages" is a read path and, per the guest-feed requirement in [[wiki/GeneralContext/Architecture/business-rules|Projects]], is expected to be reachable without authentication — only writes are gated.
- Token verification, write authZ and the account dependency paths: [[0x01b-users-auth]] "Security".

### `users/`'s public read interface (for `feed/`, `search/`, etc.)
Per the Connection rule, other modules never query the `User`/`Follow` tables directly — they call these typed functions in `app.users.service` instead:
- `followed_user_ids(session, user_id) -> list[int]` — the ids `user_id` follows. Reused by `GET /users/me/following`.
- `get_public_profiles(session, user_ids: Collection[int]) -> dict[int, PublicProfile]` — batch lookup; `PublicProfile` is a frozen dataclass (`id, username, profile_picture_media_id, profile_avatar_key, profile_picture_key`). The key is exposed only for a processed profile picture. Soft-deleted users are silently excluded from the result (never surfaced past this module).
- `account_created_at(session, user_id) -> datetime | None` (`POSTS-003`) — the account's creation time, `None` for an unknown or soft-deleted user (the same exclusion rule). `posts/`' spam scorer reads an author's account age through it, injected as a callable by `app.posts.dependencies`.
- `search_users(session, query, *, limit, offset) -> list[User]` — prefix full-text search over `User.search_vector`, excluding soft-deleted users, backing `GET /search/accounts`; see [[0x07-search]] for the tsquery-building/injection-safety detail.
- `app.users.dependencies.get_optional_current_user`: absent header, missing profile, inactive or deleting/deleted authority becomes guest `None`; malformed/invalid tokens remain 401. Authority lookup failures return 503, never guest access on unknown security state ([[0x01b-users-auth]]).

### Open decisions
None open.
- **Email**: `User` stores no email; the address is resolved from Cognito at send time (`AdminGetUser`, [[0x05-notifications]]).
- **DOB**: collected at profile creation: `POST /users`'s `CreateUserRequest` requires `date_of_birth` (minimum age 16, [[0x01c-users-routes]]).

## Parts

- [[0x01a-users-schema]]: profile/lifecycle tables, retained deletion work, the `profile_picture_media_id` FK, design, pattern and AWS notes
- [[0x01b-users-auth]]: account verification and recovery, token verification and write security, the account dependency paths
- [[0x01c-users-routes]]: the `/users` API routes, the PII fix and the load-test verifier
- [[0x01d-users-follow]]: the `Follow` table, its rules and its `UserFollowed` event
