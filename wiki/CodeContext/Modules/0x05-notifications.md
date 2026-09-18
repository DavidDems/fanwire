# 0x05 — Notifications

**Agent-facing.** Current-state only — see [[wiki/GeneralContext/index|index]] for how this wiki is organized.

## Business rules (source: [[wiki/GeneralContext/Architecture/business-rules|Projects]])
Per wiki/GeneralContext/Architecture/business-rules.md "Notifications" section, verbatim intent:
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
See [[wiki/CodeContext/Standards/design-principles|Design principles]]:
- **Immutability by default** → "clear notifications" is a `cleared_at` timestamp, not a row delete — matches the soft-delete pattern already used for `User`/`Post`.
- **Single source of truth** → `Notification`/`NotificationPreference` never duplicate the recipient's email address; SES delivery looks it up from `users/` (Cognito-backed) at send time. The email address has exactly one owner.
- **Explicit over implicit** → `type` is a closed enum, not a free-text/stringly-typed field, so `like` staying excluded is enforced by the type, not by convention.
- **YAGNI** / "three similar lines beat a premature abstraction" → justifies *not* building a `NotificationChannel`/`NotificationTransport` (Bridge) hierarchy here — see GoF section below.
- **Fail fast** → an unrecognized `type` or a `reference_id` that doesn't resolve to the expected table for that `type` is a boundary validation error, not silently dropped.

## GoF pattern tie-in (see [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]])

**Factory Method** — `NotificationFactory.create(type)` returns `EmailNotification`, `PushNotification`, or `InAppNotification`. Note this `type` is the **delivery-channel** axis (email/push/in-app), distinct from the `Notification.type` **event** column (follow/reply/repost) in the schema above — don't conflate the two. `notifications/` code paths depend only on the `Notification` interface, never a concrete class, per the connection rule in [[0x00-architecture]].

**Observer** — `notifications/` subscribes to `PostEventBus` (EventBridge; see [[0x00-architecture]]) rather than being called synchronously by any publisher. `reply` and `repost` both arrive as `PostCreated` (a reply/repost is a `Post` with a flag, per [[0x03-posts]]) — `notifications/` distinguishes them from the event payload's flags. `follow` arrives as `UserFollowed`, published by `users/` onto the same bus — per [[0x00-architecture]] Conventions, `PostEventBus` is the app's one domain event bus, not `posts/`-exclusive despite the name; `notifications/` subscribes to it uniformly regardless of publisher.

**Bridge — deliberately not applied.** The GoF doc's `NotificationChannel`/`NotificationTransport` Bridge decouples an alert-content abstraction from a transport implementation so either axis can extend independently. Here the matrix is small and mostly fixed by business rule: exactly three event types (closed, per rules above), and in v1 exactly two real transports — in-app (mandatory, always written) and email (optional, gated by one boolean). There's no independent variation to decouple yet: `Factory Method` already gives channel dispatch (`EmailNotification` vs `InAppNotification`), and every event always produces the in-app row while only the same three events also trigger `EmailNotification`. Introducing a full Bridge hierarchy for a 3×2 matrix that isn't actually varying independently would be speculative per [[wiki/CodeContext/Standards/design-principles|Design principles]] YAGNI. **Revisit Bridge if/when push or SMS is added** (per [[wiki/CodeContext/Standards/aws-stack|AWS Stack]], SNS is already provisioned for push/SMS but not wired to notifications/ business rules yet) — at that point the transport axis genuinely grows and Bridge starts earning its cost.

## AWS mapping (see [[wiki/CodeContext/Standards/aws-stack|AWS Stack]])
- **RDS Postgres** — system of record for `Notification` and `NotificationPreference`, ordinary relational tables (already listed as such in [[0x00-architecture]]'s AWS topology).
- **SES** — transactional email delivery for `EmailNotification`, pay-per-message, no idle cost.
- **EventBridge** — `PostEventBus`; `notifications/` consumes `PostCreated` for reply/repost.
- **SQS with a DLQ** — AWS Stack.md calls out "notification fan-out" by name as a case needing an SQS queue with dead-letter queue between the event bus and the consumer, so a downstream outage (e.g. SES throttling) doesn't drop notifications. `notifications/`'s `PostEventBus` consumer should sit behind such a queue, not process the event inline.

## Security & privacy (see [[wiki/CodeContext/Standards/security|Security]])
- Structured logs must never contain unhashed PII (wiki/CodeContext/Standards/security.md) — recipient/actor **usernames** are already-public profile data and fine to log, but the recipient's **email address** used for SES delivery must not appear in plaintext logs/traces.
- All authZ server-side, per [[wiki/CodeContext/Standards/design-principles|Design principles]] — a user can only read or clear their own `recipient_user_id`'s notifications; never trust a client-supplied user id for either the list or the clear (soft-delete) endpoint.
- No new PII surface: neither table stores an email address — enforces the Single-source-of-truth point above and keeps this module out of GDPR/PII-duplication concerns beyond what `users/` already owns.

## Open decisions to flag
1. **Resolved (Phase 3 build).** `reference_id` is implemented exactly as recommended above: one nullable column on `app.notifications.models.Notification`, no DB-level FK, validated at the application layer (`app.notifications.consumer`). Not revisited as a settled decision — the type-specific-FK alternative wasn't needed.

## Implementation notes (Phase 3 build)

**Naming collision, resolved.** This file's GoF section (and wiki/CodeContext/Standards/gof-patterns.md's reference project) names the Factory Method product interface `Notification`, with concrete classes `EmailNotification`/`PushNotification`/`InAppNotification`. That name collides with the ORM model class above (`app.notifications.models.Notification`), so the actual code uses `NotificationChannel` (interface, `app/notifications/channels.py`) with concrete `EmailNotificationChannel`/`InAppNotificationChannel` — no `PushNotificationChannel`, since nothing in the business rules asks for a third channel (see "Bridge — deliberately not applied" above, which already treats the transport axis as fixed at two for v1).

**`PostCreated` payload gap, resolved.** This file's Observer section says the subscriber "distinguishes reply/repost from the event payload's flags." As actually built, `app.posts.facade.PublishPostFacade`'s `PostCreated` detail dict is only `{"post_id", "author_id"}` — no `is_reply`/`is_repost`/`parent_post_id`/`original_post_id`. Rather than modify `posts/facade.py` to add those fields, `app.notifications.consumer.handle_domain_event` re-fetches the `Post` row by `post_id` (`session.get(Post, post_id)`) to read those flags, and — for a reply/repost — fetches the parent/original `Post` row the same way to get its `author_id` (the recipient). This is a direct, read-only lookup into `posts/`'s `Post` table, the same kind of narrow documented exception as `PublishPostFacade`'s own read of `media/`'s `Media` rows.

**Self-notification skip.** Not stated in the business rules above, but a self-reply/self-repost (recipient == actor) is skipped — no `Notification` row is created. Mirrors `users/`'s existing no-self-follow rule. `UserFollowed` never hits this branch since `users/` already disallows self-follow at the source.

**Consumer is now live-wired (Phase 4 Lambda-handlers unit).** `app.notifications.lambda_handler.handler` (infra's `Notifications` function, command `app.notifications.lambda_handler.handler`) is the real trigger `handle_domain_event` was missing: the notification SQS queue (batch size 10, `reportBatchItemFailures: true`), fed by `messaging-stack.ts`'s `NotificationRule` (`detailType: ["PostCreated", "UserFollowed"]` on `PostEventBus` — filters on detail-type only, so it fires regardless of which module published). Each record's `body` is that EventBridge event, JSON-encoded; the handler unwraps `detail-type`/`detail` and calls `handle_domain_event` unchanged. Per-record failures are reported via `batchItemFailures` rather than raised, so one bad record (batch size 10) doesn't block the rest. `app.eventbus.PostEventBus`'s real backing (`EventBridgePublisher`, see [[0x00-architecture]] "PostEventBus implementation") now actually reaches this queue once `POST_EVENT_BUS_NAME` is configured.

**`EmailSender` interface — real adapter implemented (Phase 4 Lambda-handlers unit).** `app.notifications.email.SesEmailSender` resolves the recipient's real email via Cognito `AdminGetUser(Username=<recipient_cognito_sub>)` at send time — never from anything this module stores, consistent with "No new PII surface" above — then sends via SES `send_email` from `Settings.notification_from_address`. **Disabled-until-a-from-address-exists behaviour**: infra only sets `NOTIFICATION_FROM_ADDRESS` (and grants `ses:SendEmail`) once `config.domainName` is configured, i.e. in every environment today that value is unset. `SesEmailSender.send()` treats that as "email disabled" — it logs (no PII: no email address, no cognito sub in the log line) and returns without calling AWS at all. `app.notifications.lambda_handler` always constructs a real `SesEmailSender` regardless — the class itself decides whether to actually send, so in-app notification creation in `handle_domain_event` is never gated on it. `RecordingEmailSender` remains the test double for unit tests that don't need a real Cognito/SES round-trip.

**Cognito `Username`-as-`sub` note (test-writing gotcha, not a production concern).** `infra/lib/auth-stack.ts`'s user pool has `signInAliases: {email: true}` with no `usernameAttributes` override — CDK's default for that shape auto-generates each user's Cognito `Username` as a random UUID that IS their `sub` (email is only a sign-in alias, never the `Username` itself). `AdminGetUser(Username=sub)` therefore works as a literal match in real Cognito, not an alias lookup. `moto`'s `cognito-idp` mock only matches a literal `Username` (it doesn't model AWS's alias-vs-`sub` distinction at all), so tests must create the moto user with `Username=<the sub value>` directly — which is exactly production behaviour for this pool shape, not a workaround around a moto gap.
