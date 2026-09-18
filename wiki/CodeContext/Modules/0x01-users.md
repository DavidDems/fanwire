# 0x01 — Users

**Agent-facing.** Current-state only — see [[wiki/GeneralContext/index|index]] for how this wiki is organized and [[0x00-architecture]] for module boundaries/connection rule (not repeated here).

`users/` owns two tables: `User` and `Follow`. Both are served by **RDS Postgres**, the system of record for every table in this wiki ([[0x00-architecture]]). Credentials, MFA, and token issuance are **not** part of this module — that's Cognito (see Auth below).

## User

### Schema
| Field | Type | Notes |
|---|---|---|
| `id` | PK | local identity, referenced by FK from `posts/`, `notifications/`, etc. |
| `cognito_sub` | string, unique, not null | links this row to the Cognito identity; **no password column** exists here |
| `username` | string, unique, not null | display handle; also the token `posts/`'s `MentionParser` resolves `@user` against ([[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]] line "Interpreter") |
| `description` | text, nullable | |
| `date_of_birth` | date | PII, see Security below |
| `preferred_team_id` | FK → `Team.id` | owned by `events/`, not redefined here — see [[0x02-events]] |
| `profile_picture_media_id` | FK → `Media.id`, nullable | owned by `media/`, not redefined here — see [[0x04-media]] |
| `created_at` | timestamp, not null | |
| `updated_at` | timestamp, not null | |
| `deleted_at` | timestamp, nullable | soft-delete marker; `null` = active row |

No `email` or `password` column: Cognito is the sole owner of credentials and the registration-confirmation / forgot-password flows ("Cognito ... handles password storage" — [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] Auth section; "Do not roll your own auth" — same section). `cognito_sub` is the only link between the two systems.

### Design principles tie-ins
- **Single source of truth** ([[wiki/CodeContext/Standards/design-principles|Design principles]]): Cognito owns the credential/identity state; `User` is a local profile projection keyed by `cognito_sub`, never a copy of password/verification state.
- **Fail fast** / **Validate at boundaries only** ([[wiki/CodeContext/Standards/design-principles|Design principles]]): "preventing any action that requires a data write to unregistered users" is enforced by verifying the Cognito token at the API boundary on every write request — an invalid/missing token throws immediately, it is never checked deeper in the call stack.
- **Immutability by default** ([[wiki/CodeContext/Standards/design-principles|Design principles]]): "soft-deleting user data" is implemented as `deleted_at`, not a row delete — existing rows (and anything FK'd to `User.id` from `posts/`, `notifications/`, etc.) are never mutated away.
- **Explicit over implicit** ([[wiki/CodeContext/Standards/design-principles|Design principles]]): `deleted_at` as a nullable timestamp (not a bare `is_deleted` boolean) makes *when* a row was deactivated explicit rather than inferred.

### GoF tie-in
No creational/structural/behavioral pattern owns `User` itself. The one real connection: `username` is the literal input the Interpreter-pattern `MentionParser` (`posts/`) parses `@user` tokens against ([[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]]) — `users/` just needs to guarantee uniqueness, it doesn't implement the parser.

### AWS ownership
- **RDS Postgres** — system of record for the `User` row ([[0x00-architecture]]).
- **Cognito** — system of record for credentials, MFA, token issuance, registration-confirmation email, and forgot-password ([[wiki/CodeContext/Standards/aws-stack|AWS Stack]] Auth section; [[0x00-architecture]] "Auth").
- **SES**, indirectly — Cognito sends the confirmation/reset emails; `users/` does not call SES directly for this flow ([[wiki/CodeContext/Standards/aws-stack|AWS Stack]] Messaging section describes SES for transactional email generally).

### Security
- `date_of_birth` is PII: encrypted at rest via the RDS instance's customer-managed KMS key ("customer-managed KMS key ... for anything containing customer data" — [[wiki/CodeContext/Standards/security|Security]] Data protection), and never written to structured logs unhashed ("Structured logs must never contain secrets or unhashed PII" — [[wiki/CodeContext/Standards/security|Security]]).
- All writes (profile update, soft-delete, follow/unfollow) require a Cognito token verified server-side on every request — "never trusted based on client claims alone" ([[wiki/CodeContext/Standards/security|Security]] Application-layer section). Client-side "am I logged in" checks are UX only, never the boundary ([[wiki/CodeContext/Standards/design-principles|Design principles]] Security baseline).
- "Viewing other users' account pages" is a read path and, per the guest-feed requirement in [[wiki/GeneralContext/Architecture/business-rules|Projects]], is expected to be reachable without authentication — only writes are gated.
- Profile picture upload itself is not this module's concern — it goes through `media/`'s quarantine/scan/processing pipeline; `users/` only stores the resulting `Media.id` once it reaches a servable state ([[0x04-media]]).
- Cognito issues RS256 (RSA)-signed JWTs; server-side verification (`python-jose[cryptography]`, [[wiki/CodeContext/Standards/build-deployment|Build & Deployment]]) never exercises the ECDSA signing/verification path. `pip-audit` in CI ignores `PYSEC-2026-1325` (a timing side-channel in `ecdsa`, pulled in transitively by `python-jose`, no fix version available upstream) on that basis — accepted risk, not a gap in the "block merge on a hit" rule in [[wiki/CodeContext/Standards/security|Security]]. Re-verify this reasoning before adding any code path that verifies/signs with an EC key.
- `profile_picture_media_id` is currently a plain column with no enforced FK constraint (not even nullable-FK) — `media/`'s `Media` table doesn't exist yet in this branch. This is a real, self-created gap introduced by the `users/` implementation pass, not a redefinition of `media/`'s ownership: the constraint gets added once `media/`'s `Media` table lands (the next Phase 1 unit).

### API routes (Phase 2a)
Phase 1 built `User`/`Follow`/Cognito verification as pure Python with no FastAPI routes; Phase 2a (`wiki/GeneralContext/Prompts/phase-2-manager-agent.md`) closed that. Routes live in `app.users.routes` (`APIRouter(prefix="/users")`):
- `POST /users` — profile creation, called right after a Cognito signup confirms. Protected by `get_current_identity`; the verified token's `sub` *is* the `cognito_sub` the row is created for (judgment call — simpler than a separate Cognito Post-Confirmation Lambda trigger, keeps everything in the one Mangum-wrapped app). 409 on a duplicate `cognito_sub`/`username`/bad `preferred_team_id` — `create_user`'s existing "let the DB constraint surface as IntegrityError" design (no pre-check, avoids TOCTOU) means all three collapse into one generic 409 rather than field-specific errors; revisit if a future consumer needs to distinguish them (would require inspecting the driver-specific `psycopg` constraint-name diagnostic, not done anywhere else in this codebase).
- `GET /users/{user_id}` — public, no auth, per "viewing other users' account pages" above.
- `DELETE /users/me` — soft-deletes the caller's **own** profile only. There is no `DELETE /users/{id}` for an arbitrary id — least privilege; nothing lets one user soft-delete another's row.
- `POST /users/{user_id}/follow` / `DELETE /users/{user_id}/follow` — protected; the acting user is always resolved server-side from the verified token (`get_current_user`, a new dependency resolving `cognito_sub` → the local `User` row, 404 if no profile exists yet for an otherwise-valid token), never from a client-supplied "who is following" field. `{user_id}` in the path is always the *target*.
- Real `CognitoTokenVerifier` is now wired behind `get_token_verifier` (JWKS fetched from Cognito's well-known endpoint via `app.users.jwks.JWKSProvider`, TTL-cached; `audience`/`issuer`/`region` come from new `Settings` fields `cognito_app_client_id`/`cognito_user_pool_id`/`cognito_region`). Route tests still override `get_token_verifier` with `FakeTokenVerifier`, unchanged from Phase 1.

### Open decisions
- **Email duplication**: Cognito owns email, but nothing in [[wiki/GeneralContext/Architecture/business-rules|Projects]] or [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] says whether `User` also stores a denormalized copy of the email (for admin queries, notification fan-out lookups, etc.) or whether every read fetches it from Cognito on demand. Needs a decision before schema is finalized.
- **DOB required at signup vs. later profile step**: [[wiki/GeneralContext/Architecture/business-rules|Projects]] only lists "storing user data (DOB, ...)" as a data point to store, not when it's collected. Not specified whether Cognito signup collects it or it's a required post-registration profile field.

## Follow

### Schema
| Field | Type | Notes |
|---|---|---|
| `follower_user_id` | FK → `User.id`, not null | the user doing the following |
| `followed_user_id` | FK → `User.id`, not null | the user being followed |
| `created_at` | timestamp, not null | |

Composite unique constraint on `(follower_user_id, followed_user_id)` — a user can follow another at most once. A check constraint (`follower_user_id <> followed_user_id`) prevents self-follow. No `deleted_at`: unfollow is a real row delete, not a soft-delete.

### Design principles tie-ins
- **KISS** / **Single source of truth** ([[wiki/CodeContext/Standards/design-principles|Design principles]]): [[wiki/GeneralContext/Architecture/business-rules|Projects]]'s "Accounts" bullets separate "soft-deleting user data" from "storing follow/followed relationships" — soft-delete is specified for `User` data, not for `Follow`. The current follow set *is* the truth for who-follows-whom; there's no stated requirement to retain follow history, so a hard delete on unfollow is the simplest design that meets the actual requirement.
- **Fail fast** ([[wiki/CodeContext/Standards/design-principles|Design principles]]): unfollowing a relationship that doesn't exist, or following while unregistered, is rejected at the boundary rather than silently no-op'd.

### GoF tie-in
None owns `Follow` directly. It is plain join-table state, not a pattern participant.

### AWS ownership
**RDS Postgres**, same table set as `User` — no separate datastore ([[0x00-architecture]] Data section).

### Security
- Same server-side authZ requirement as `User` writes: follow/unfollow requires a verified Cognito token; "any action that requires a data write" from an unregistered user is blocked at the boundary, per [[wiki/GeneralContext/Architecture/business-rules|Projects]] and [[wiki/CodeContext/Standards/security|Security]] Application-layer section.
- No PII on this table — `follower_user_id`/`followed_user_id` are internal FKs, not exposed identifiers beyond what `User.username` already exposes on profile pages.

### Open decisions
None remaining for `Follow`. Notification wiring is settled: `users/` publishes a `UserFollowed` event onto `PostEventBus` (the app's one domain event bus, not `posts/`-exclusive despite the name) — see [[0x00-architecture]] Conventions and [[0x05-notifications]].
