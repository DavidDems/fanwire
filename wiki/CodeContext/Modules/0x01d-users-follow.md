---
type: reference
---

# 0x01d — Users: Follow

**Agent-facing.** Part of [[0x01-users]] (index, DOB privacy and the public read path, the public read interface and open decisions).

## Follow

### Schema
| Field | Type | Notes |
|---|---|---|
| `follower_user_id` | FK → `User.id`, not null | the user doing the following |
| `followed_user_id` | FK → `User.id`, not null | the user being followed |
| `created_at` | timestamp, not null | |

Composite unique constraint on `(follower_user_id, followed_user_id)` — a user can follow another at most once. A check constraint (`follower_user_id <> followed_user_id`) prevents self-follow. No `deleted_at`: unfollow is a real row delete, not a soft-delete. Routes: [[0x01c-users-routes]].

### Design principles tie-ins
- **KISS** / **Single source of truth** ([[wiki/CodeContext/Standards/design-principles|Design principles]]): [[wiki/GeneralContext/Architecture/business-rules|Projects]]'s "Accounts" bullets separate "soft-deleting user data" from "storing follow/followed relationships" — soft-delete is specified for `User` data, not for `Follow`. The current follow set *is* the truth for who-follows-whom; there's no stated requirement to retain follow history, so a hard delete on unfollow is the simplest design that meets the actual requirement.
- **Fail fast** ([[wiki/CodeContext/Standards/design-principles|Design principles]]): unfollowing a relationship that doesn't exist, or following while unregistered, is rejected at the boundary rather than silently no-op'd.

### GoF tie-in
None owns `Follow` directly. It is plain join-table state, not a pattern participant.

### AWS ownership
**RDS Postgres**, same table set as `User` — no separate datastore ([[0x00-architecture]] Data section).

### Security
- Same server-side authZ requirement as `User` writes ([[0x01b-users-auth]] "Security"): follow/unfollow requires a verified Cognito token; "any action that requires a data write" from an unregistered user is blocked at the boundary, per [[wiki/GeneralContext/Architecture/business-rules|Projects]] and [[wiki/CodeContext/Standards/security|Security]] Application-layer section.
- Follow/unfollow fence both actor and affected identity through `users.lifecycle.fence_users`, acquiring the complete sorted owner set and retaining locks through commit; a request authenticated before deletion cannot recreate the relationship. Authority contract: [[0x01a-users-schema]].
- No PII on this table — `follower_user_id`/`followed_user_id` are internal FKs, not exposed identifiers beyond what `User.username` already exposes on profile pages.

### Open decisions
None remaining for `Follow`. Notification wiring: `app.users.service.follow()` publishes `UserFollowed` onto `app.eventbus.PostEventBus` (the app's one domain event bus, not `posts/`-exclusive despite the name — see [[0x00-architecture]] and [[0x03-posts]]) after a successful follow, never on `SelfFollowError`/`AlreadyFollowingError`. `follow()` takes `event_bus: PostEventBus` as a required parameter; `app.users.routes.follow_user` supplies it via `app.dependencies.get_event_bus`.
