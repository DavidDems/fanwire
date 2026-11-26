---
type: reference
---

# 0x01a — Users: schema

**Agent-facing.** Part of [[0x01-users]] (index, DOB privacy, the public read interface and open decisions).

## User

### Schema
| Field | Type | Notes |
|---|---|---|
| `id` | PK | local identity, referenced by FK from `posts/`, `notifications/`, etc. |
| `cognito_sub` | string, unique, not null | links this row to the Cognito identity; **no password column** exists here |
| `username` | string, unique, not null | display handle, stored and shown as typed (ADR 0010); unique regardless of case too, through `ux_users_username_lower` on `lower(username)` (`USERS-011`, ADR 0042) |
| `description` | text, nullable | |
| `date_of_birth` | date | PII, see [[0x01b-users-auth]] "Security" and [[0x01-users]] "Security" |
| `preferred_team_id` | FK → `Team.id` | owned by `events/`, not redefined here — see [[0x02-events]] |
| `profile_picture_media_id` | FK → `Media.id`, nullable | owned by `media/`, not redefined here — see [[0x04-media]] |
| `avatar_inner_color` | text, nullable | `USERS-005`: an inner key of the team palette (`AvatarInnerColor` in `app.users.schemas`); `null` is no fill |
| `avatar_outer_color` | text, nullable | `USERS-005`: an outer key of the team palette (`AvatarOuterColor`); `null` is no ring. Both `null` is the default initials |
| `created_at` | timestamp, not null | |
| `updated_at` | timestamp, not null | |
| `deleted_at` | timestamp, nullable | soft-delete marker; `null` = active row |
| `search_vector` | `TSVECTOR`, generated/persisted, GIN-indexed | `to_tsvector('simple', username \|\| ' ' \|\| coalesce(description, ''))` — backs `search/`'s account search, see [[0x07-search]] |

No `email` or `password` column: Cognito is the sole owner of credentials and the registration-confirmation / forgot-password flows ("Cognito ... handles password storage" — [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] Auth section; "Do not roll your own auth" — same section). `cognito_sub` is the only link between the two systems.

**The `profile_picture_media_id` FK.** It is a real `ForeignKey("media.id", use_alter=True, name="fk_users_profile_picture_media_id_media")`; its companion is `Media.post_id` ([[0x04-media]]). Two structural findings, precedents for the next module pair that ends up with mutual FKs:
- **`app.users.models` deliberately does NOT import `app.media.models.Media`**, unlike every other "real FK target" import in this codebase (`Team`, `User` elsewhere). `app.media.models` imports `app.posts.models` (for its own `post_id` FK) and `app.posts.models` imports `app.users.models` (for `author_id` etc.) — an eager `Media` import here would close a real 3-module Python import cycle (`users → media → posts → users`, `ImportError: cannot import name 'User' from partially initialized module 'app.users.models'`). The FK works as a bare `"media.id"` string — SQLAlchemy resolves it lazily against `Base.metadata`, and every real entry point (Alembic, test fixtures) imports `app.media.models` before any mapper/DDL work runs.
- **`users`↔`media` is also a circular *table* dependency** (`media.uploader_id → users.id` plus `users.profile_picture_media_id → media.id`), independent of the Python import graph — `Base.metadata.create_all()` can't find a single linear table-creation order across a two-table FK cycle (`CircularDependencyError`). `use_alter=True` defers that one constraint to a post-create `ALTER TABLE` (the Alembic migration does the same as a separate `ADD CONSTRAINT` step).

## Durable account lifecycle
`users/lifecycle.py` owns the public authority/fencing interface; other modules do not read its tables. `AccountAuthority` has a unique trusted issuer/pool plus immutable sub, bigint identity and monotonic generation. `deleting`/`deleted` is irreversible. Deactivation/recovery atomically maintain `User.deleted_at` visibility and completed `AccountOperation` transition records.

One deletion operation and immutable exact-key `AccountDeletionObject` manifest survive profile removal. Epoch-fenced claims commit a future due marker before RPCs; crashes, duplicate scans and stale results cannot complete another worker's stage. The shared `app.account_deletion` runner advances exact-key S3 cleanup, module-owned local removal in one transaction, then exact-sub Cognito deletion. Local user/post associations are cleared with local removal. The five-minute `account_deletion_handler` scan bounds work, SDK/database waits and live runtime, with retry backoff; leases permit retries, never authority restoration. Terminal manifests remain scheduled for late-object cleanup, without changing completed HTTP status.

The additive migration backfills extant profiles only in the configured trusted namespace; a profile created later is adopted on its first fence. Acceptance defaults off, and while it is off `DELETE /users/me/data` answers 503 for everyone; disabling it preserves existing fences and reconciliation. Activation requires separately reviewed schema/cutover/drain, legacy-adoption evidence and live retention/bucket checks. Provider-confirmed post-cutover creation can establish new-profile eligibility; login time cannot classify historical missing profiles. Active code needs `ACCOUNT_LIFECYCLE_CUTOVER_AT`: a Cognito identity with no profile created before it cannot create one. The gates and their state: [account-lifecycle-activation](../../GeneralContext/Architecture/account-lifecycle-activation.md). [ADR 0009](../../GeneralContext/Decisions/0009-account-lifecycle-evidence.md) owns the evidence and linked proof/deployment gates. A 204 proves logical deletion/current-key cleanup, not instantaneous CDN/backup erasure. HTTP contract: [[0x01c-users-routes]].

### Design principles tie-ins
- **Single source of truth** ([[wiki/CodeContext/Standards/design-principles|Design principles]]): Cognito owns the credential/identity state; `User` is a local profile projection keyed by `cognito_sub`, never a copy of password/verification state.
- **Fail fast** / **Validate at boundaries only** ([[wiki/CodeContext/Standards/design-principles|Design principles]]): verify Cognito tokens at the API boundary; transaction fences separately serialize authorized writes against account-state changes.
- **Immutability by default** ([[wiki/CodeContext/Standards/design-principles|Design principles]]): ordinary deactivation uses `deleted_at`; permanent removal is the explicit exception ([[0x01c-users-routes]] `DELETE /users/me/data`).
- **Explicit over implicit** ([[wiki/CodeContext/Standards/design-principles|Design principles]]): `deleted_at` as a nullable timestamp (not a bare `is_deleted` boolean) makes *when* a row was deactivated explicit rather than inferred.

### GoF tie-in
None owns `User`.

### AWS ownership
- **RDS Postgres** — system of record for the `User` row ([[0x00-architecture]]).
- **Cognito** — system of record for credentials, MFA, token issuance, registration-confirmation email, and forgot-password ([[wiki/CodeContext/Standards/aws-stack|AWS Stack]] Auth section; [[0x00-architecture]] "Auth").
- **Cognito's default email sender**, not SES, sends the confirmation and reset codes (`UserPoolEmail.withCognito()` in `infra/lib/auth-stack.ts`); `users/` sends none of them. Reset is native ForgotPassword/ConfirmForgotPassword from the browser (`AUTH-001`, [[0x01b-users-auth]]).
