# 0x05 — Notifications

**Agent-facing.** Current-state only — see [[index]] for how this wiki is organized.

## Business rules (source: [[reference/Projects|Projects]])
Per Projects.md "Notifications" section, verbatim intent:
- Create a `Notification` when one of three actions happens: **follow**, **reply**, or **repost** — explicitly **not** like.
- Send an email when someone follows the user, replies to their post, or reposts their post.
- Store notifications and display them in the website (in-app).
- Allow the user to clear notifications — **soft-delete**, not hard-delete.
- Allow the user to block email notifications but **not** the in-app/UI notifications — email opt-out is independent of, and cannot disable, in-app display.

## Schema

### `Notification`
| column | type | notes |
|---|---|---|
| `id` | PK | |
| `recipient_user_id` | FK → `User.id` | whose notification this is; all reads/writes scoped to this |
| `type` | enum(`follow`, `reply`, `repost`) | closed set per business rules — `like` is explicitly excluded, not a 4th value waiting to happen |
| `actor_user_id` | FK → `User.id` | who performed the action (who to display — avatar/name) |
| `reference_id` | see "Open decisions" below | what the notification navigates to when clicked |
| `cleared_at` | timestamp, nullable | soft-delete marker for "clear notifications"; `NULL` = active |
| `created_at` | timestamp | |

`reference_id` semantics by `type` (recommended, not yet enforced at the DB layer — see open decision #2):
- `follow` → the actor's `User.id` (same value as `actor_user_id`; kept for uniform "click target" semantics across all types even though redundant here)
- `reply` → the new reply `Post.id` (per [[0x03-posts]], a reply is a `Post` flagged as a reply)
- `repost` → the new repost `Post.id` (per [[0x03-posts]], a repost is likewise a `Post` with a flag)

### `NotificationPreference`
| column | type | notes |
|---|---|---|
| `user_id` | PK, FK → `User.id` | one row per user |
| `email_notifications_enabled` | boolean, default `true` | the **only** preference flag — there is no in-app equivalent, by business rule in-app notifications cannot be disabled |

## Design principles tie-in
See [[reference/Design principles|Design principles]]:
- **Immutability by default** → "clear notifications" is a `cleared_at` timestamp, not a row delete — matches the soft-delete pattern already used for `User`/`Post`.
- **Single source of truth** → `Notification`/`NotificationPreference` never duplicate the recipient's email address; SES delivery looks it up from `users/` (Cognito-backed) at send time. The email address has exactly one owner.
- **Explicit over implicit** → `type` is a closed enum, not a free-text/stringly-typed field, so `like` staying excluded is enforced by the type, not by convention.
- **YAGNI** / "three similar lines beat a premature abstraction" → justifies *not* building a `NotificationChannel`/`NotificationTransport` (Bridge) hierarchy here — see GoF section below.
- **Fail fast** → an unrecognized `type` or a `reference_id` that doesn't resolve to the expected table for that `type` is a boundary validation error, not silently dropped.

## GoF pattern tie-in (see [[reference/Gang of Four Example|Gang of Four Example]])

**Factory Method** — `NotificationFactory.create(type)` returns `EmailNotification`, `PushNotification`, or `InAppNotification`. Note this `type` is the **delivery-channel** axis (email/push/in-app), distinct from the `Notification.type` **event** column (follow/reply/repost) in the schema above — don't conflate the two. `notifications/` code paths depend only on the `Notification` interface, never a concrete class, per the connection rule in [[0x00-architecture]].

**Observer** — `notifications/` subscribes to `PostEventBus` (EventBridge; see [[0x00-architecture]]) rather than being called synchronously by any publisher. `reply` and `repost` both arrive as `PostCreated` (a reply/repost is a `Post` with a flag, per [[0x03-posts]]) — `notifications/` distinguishes them from the event payload's flags. `follow` arrives as `UserFollowed`, published by `users/` onto the same bus — per [[0x00-architecture]] Conventions, `PostEventBus` is the app's one domain event bus, not `posts/`-exclusive despite the name; `notifications/` subscribes to it uniformly regardless of publisher.

**Bridge — deliberately not applied.** The GoF doc's `NotificationChannel`/`NotificationTransport` Bridge decouples an alert-content abstraction from a transport implementation so either axis can extend independently. Here the matrix is small and mostly fixed by business rule: exactly three event types (closed, per rules above), and in v1 exactly two real transports — in-app (mandatory, always written) and email (optional, gated by one boolean). There's no independent variation to decouple yet: `Factory Method` already gives channel dispatch (`EmailNotification` vs `InAppNotification`), and every event always produces the in-app row while only the same three events also trigger `EmailNotification`. Introducing a full Bridge hierarchy for a 3×2 matrix that isn't actually varying independently would be speculative per [[reference/Design principles|Design principles]] YAGNI. **Revisit Bridge if/when push or SMS is added** (per [[reference/AWS Stack|AWS Stack]], SNS is already provisioned for push/SMS but not wired to notifications/ business rules yet) — at that point the transport axis genuinely grows and Bridge starts earning its cost.

## AWS mapping (see [[reference/AWS Stack|AWS Stack]])
- **RDS Postgres** — system of record for `Notification` and `NotificationPreference`, ordinary relational tables (already listed as such in [[0x00-architecture]]'s AWS topology).
- **SES** — transactional email delivery for `EmailNotification`, pay-per-message, no idle cost.
- **EventBridge** — `PostEventBus`; `notifications/` consumes `PostCreated` for reply/repost.
- **SQS with a DLQ** — AWS Stack.md calls out "notification fan-out" by name as a case needing an SQS queue with dead-letter queue between the event bus and the consumer, so a downstream outage (e.g. SES throttling) doesn't drop notifications. `notifications/`'s `PostEventBus` consumer should sit behind such a queue, not process the event inline.

## Security & privacy (see [[reference/Security|Security]])
- Structured logs must never contain unhashed PII (Security.md) — recipient/actor **usernames** are already-public profile data and fine to log, but the recipient's **email address** used for SES delivery must not appear in plaintext logs/traces.
- All authZ server-side, per [[reference/Design principles|Design principles]] — a user can only read or clear their own `recipient_user_id`'s notifications; never trust a client-supplied user id for either the list or the clear (soft-delete) endpoint.
- No new PII surface: neither table stores an email address — enforces the Single-source-of-truth point above and keeps this module out of GDPR/PII-duplication concerns beyond what `users/` already owns.

## Open decisions to flag
1. **`reference_id` as a single polymorphic column vs. type-specific FKs is a recommendation, not a settled decision.** Recommended: one nullable `reference_id` column, interpreted per `type` (see Schema above), validated at the application layer rather than as a DB-enforced foreign key — simpler schema (KISS), but it sacrifices real referential integrity since Postgres can't FK one column to two different target tables. Alternative if that integrity gap proves unacceptable: split into type-specific nullable FK columns (e.g. a `post_reference_id` for reply/repost, relying on `actor_user_id` alone for follow). Revisit if `posts/` ([[0x03-posts]]) or `users/` ([[0x01-users]]) end up needing stricter guarantees here.
