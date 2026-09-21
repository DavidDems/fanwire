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
| `search_vector` | `TSVECTOR`, generated/persisted, GIN-indexed | `to_tsvector('simple', username \|\| ' ' \|\| coalesce(description, ''))` — backs `search/`'s account search, see [[0x07-search]] |

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
- **Settled decision (human, 2026-09-18, `wiki/GeneralContext/Prompts/phase-4-manager-agent.md` "Decisions"):** `date_of_birth` is never shown on a public profile — it is held in our DB (RDS, this module's `User` row) after registration and returned only on the caller's own authenticated read/write paths (`POST /users`, `GET /users/me`, `PATCH /users/me` — see API routes below), never on `GET /users/{user_id}` or any other user-facing response. This ratifies the PII-fix schema split (`PublicUserOut`/`MeOut`) already implemented in the `phase-3-users-me` unit below — no further code change required.
- All writes (profile update, soft-delete, follow/unfollow) require a Cognito token verified server-side on every request — "never trusted based on client claims alone" ([[wiki/CodeContext/Standards/security|Security]] Application-layer section). Client-side "am I logged in" checks are UX only, never the boundary ([[wiki/CodeContext/Standards/design-principles|Design principles]] Security baseline).
- "Viewing other users' account pages" is a read path and, per the guest-feed requirement in [[wiki/GeneralContext/Architecture/business-rules|Projects]], is expected to be reachable without authentication — only writes are gated.
- Profile picture upload itself is not this module's concern — it goes through `media/`'s quarantine/scan/processing pipeline; `users/` only stores the resulting `Media.id` once it reaches a servable state ([[0x04-media]]).
- Cognito issues RS256 (RSA)-signed JWTs; server-side verification (`python-jose[cryptography]`, [[wiki/CodeContext/Standards/build-deployment|Build & Deployment]]) never exercises the ECDSA signing/verification path. `pip-audit` in CI ignores `PYSEC-2026-1325` (a timing side-channel in `ecdsa`, pulled in transitively by `python-jose`, no fix version available upstream) on that basis — accepted risk, not a gap in the "block merge on a hit" rule in [[wiki/CodeContext/Standards/security|Security]]. Re-verify this reasoning before adding any code path that verifies/signs with an EC key.
- **Fixed (Phase 4, `phase-4-dev-hardening`, found by the infra agent reading the installed `python-jose` 3.5.0 source):** `CognitoTokenVerifier.verify` passed `audience=` to `jose.jwt.decode`, but jose's own `_validate_aud` (`jose/jwt.py`) returns immediately with no error whenever the `"aud"` claim is absent from the token — the `audience=` argument only ever matters when `aud` is already present. Cognito **access** tokens carry `client_id`, not `aud`, so an access token for this pool was passing verification even though the SPA contract ([[wiki/GeneralContext/Architecture/dev-auth-setup|Dev auth setup]] "Contract notes") is that the SPA sends **ID tokens** only. Fixed by requiring `claims["token_use"] == "id"` and a present `aud` claim after jose's own checks succeed, else raising `InvalidTokenError` — see `app.users.auth.CognitoTokenVerifier.verify` and its tests in `backend/tests/users/test_auth.py` (`test_verify_rejects_access_token_shaped_token`, `test_verify_rejects_token_with_no_token_use_claim`).
- ~~`profile_picture_media_id` is currently a plain column with no enforced FK~~ — **closed** (`posts/` FK-closure unit, Phase 2): `profile_picture_media_id` is now a real `ForeignKey("media.id")`. Two structural findings from closing it, both real precedents for the next module pair that ends up with mutual FKs, not one-offs:
  - **`app.users.models` deliberately does NOT import `app.media.models.Media`**, unlike every other "real FK target" import in this codebase (`Team`, `User` elsewhere). `app.media.models` imports `app.posts.models` (for its own `post_id` FK) and `app.posts.models` imports `app.users.models` (for `author_id` etc.) — an eager `Media` import here would close a real 3-module Python import cycle (`users → media → posts → users`), confirmed via `ImportError: cannot import name 'User' from partially initialized module 'app.users.models'`. The FK works correctly as a bare `"media.id"` string — SQLAlchemy resolves it lazily against `Base.metadata`, and every real entry point (Alembic, test fixtures) already imports `app.media.models` before any mapper/DDL work runs.
  - **`users`↔`media` is also a circular *table* dependency** (`media.uploader_id → users.id` pre-existing, now plus `users.profile_picture_media_id → media.id`), independent of the Python import graph — `Base.metadata.create_all()` can't find a single linear table-creation order across a two-table FK cycle (confirmed: `CircularDependencyError`). Fixed with `ForeignKey("media.id", use_alter=True, name="fk_users_profile_picture_media_id_media")`, deferring that one constraint to a post-create `ALTER TABLE` (the Alembic migration does the same as a separate `ADD CONSTRAINT` step).

### API routes (Phase 2a, extended Phase 3 `phase-3-users-me`)
Phase 1 built `User`/`Follow`/Cognito verification as pure Python with no FastAPI routes; Phase 2a (`wiki/GeneralContext/Prompts/phase-2-manager-agent.md`) closed that. Routes live in `app.users.routes` (`APIRouter(prefix="/users")`). Every `/me...` route is declared **before** `/{user_id}` in the file — FastAPI/Starlette matches a dynamic path segment regardless of type annotation, so `/{user_id}` registered first would swallow `GET /users/me` as a 422 ("me" fails `int` conversion) instead of ever reaching the real handler; see the regression test in `tests/users/test_routes.py`.

**PII fix**: `GET /users/{user_id}` used to return the one `UserOut` schema, which included `date_of_birth` — PII (see Security above) leaking to any unauthenticated caller who could guess/enumerate a user id. Fixed by splitting the response schema in `app.users.schemas`:
- `PublicUserOut` — `id, username, description, preferred_team_id, profile_picture_media_id, created_at, follower_count, following_count`. No `date_of_birth`. Returned by `GET /users/{user_id}`.
- `MeOut` — `PublicUserOut` plus `date_of_birth`. Returned only on paths that prove the caller is that profile's own owner: `POST /users`, `GET /users/me`, `PATCH /users/me`.
- `follower_count`/`following_count` aren't ORM attributes (no denormalized counter columns — YAGNI, computed via simple count queries in `app.users.service.follower_count`/`following_count`, both excluding soft-deleted counterparts), so routes.py builds the response schema explicitly from a `User` row rather than handing FastAPI a bare ORM instance to convert via `response_model`.
- `tests/users/test_routes.py::test_get_profile_does_not_leak_date_of_birth` is the regression test asserting the fix.

Routes:
- `POST /users` — profile creation, called right after a Cognito signup confirms. Protected by `get_current_identity`; the verified token's `sub` *is* the `cognito_sub` the row is created for (judgment call — simpler than a separate Cognito Post-Confirmation Lambda trigger, keeps everything in the one Mangum-wrapped app). 409 on a duplicate `cognito_sub`/`username`/bad `preferred_team_id` — `create_user`'s existing "let the DB constraint surface as IntegrityError" design (no pre-check, avoids TOCTOU) means all three collapse into one generic 409 rather than field-specific errors; revisit if a future consumer needs to distinguish them (would require inspecting the driver-specific `psycopg` constraint-name diagnostic, not done anywhere else in this codebase). Returns `MeOut`.
- `GET /users/me` — the caller's own full profile (`MeOut`), resolved via `get_current_user`. 404s exactly when `get_current_user` does: a verified token with no matching `User` row yet — the frontend uses this 404 to route a freshly-confirmed signup to profile creation.
- `PATCH /users/me` — partial update, body `UpdateMeRequest` (`description`, `preferred_team_id`, `profile_picture_media_id`, all optional). Uses Pydantic `model_fields_set` semantics: a field absent from the body is left untouched, a field present with an explicit `null` clears it. `username`/`date_of_birth` are not fields on the request model at all — neither is editable via this endpoint. Validation, all enforced in `app.users.service.update_profile` (route stays thin):
  - `description` — max 500 chars, enforced by `Field(max_length=500)` on the schema (a 422 from Pydantic itself, before the service function runs).
  - `preferred_team_id` — must reference an existing `Team` row, else `InvalidPreferredTeamError` → **422** (judgment call: not 409, since `POST /users`'s 409 is a byproduct of not pre-checking; here the same explicit pre-check is required anyway for `profile_picture_media_id`, so both validation failures use the one status code rather than splitting across two).
  - `profile_picture_media_id` — must reference a `Media` row whose `uploader_id` is the caller and whose `status` is `MediaStatus.PROCESSED`, else `InvalidProfilePictureError` → 422. This is `users/`'s one narrow, documented cross-module read of `Media` (`app.users.service` imports `app.media.models.{Media, MediaStatus}` directly) — the same precedent as `posts/`'s `PublishPostFacade` (`app.posts.facade`), which does the identical check before attaching Media to a Post. `users/` never mutates `Media.status`, only reads it.
  - `update_profile(session, user_id, *, fields_set, ...)` takes `user_id` and re-fetches the row within the given session (like `soft_delete_user`), not a `User` instance — a `User` loaded in a different session (e.g. a test overriding `get_current_user` with a detached instance) can't be safely mutated-and-committed through an unrelated session.
- `GET /users/me/following` — `list[int]` of the ids the caller follows, for the frontend's follow-button state. Thin wrapper over `app.users.service.followed_user_ids`.
- `DELETE /users/me` — soft-deletes the caller's **own** profile only. There is no `DELETE /users/{id}` for an arbitrary id — least privilege; nothing lets one user soft-delete another's row.
- `GET /users/{user_id}` — public, no auth, per "viewing other users' account pages" above. Returns `PublicUserOut` (no DOB — see PII fix above).
- `POST /users/{user_id}/follow` / `DELETE /users/{user_id}/follow` — protected; the acting user is always resolved server-side from the verified token (`get_current_user`, a dependency resolving `cognito_sub` → the local `User` row, 404 if no profile exists yet for an otherwise-valid token), never from a client-supplied "who is following" field. `{user_id}` in the path is always the *target*.
- Real `CognitoTokenVerifier` is wired behind `get_token_verifier` (JWKS fetched from Cognito's well-known endpoint via `app.users.jwks.JWKSProvider`, TTL-cached; `audience`/`issuer`/`region` come from `Settings` fields `cognito_app_client_id`/`cognito_user_pool_id`/`cognito_region`). Route tests still override `get_token_verifier` with `FakeTokenVerifier`.

### `users/`'s public read interface (for `feed/`, `search/`, etc.)
Per the Connection rule, other modules never query the `User`/`Follow` tables directly — they call these typed functions in `app.users.service` instead:
- `followed_user_ids(session, user_id) -> list[int]` — the ids `user_id` follows. Reused by `GET /users/me/following`.
- `get_public_profiles(session, user_ids: Collection[int]) -> dict[int, PublicProfile]` — batch lookup; `PublicProfile` is a frozen dataclass (`id, username, profile_picture_media_id`). Soft-deleted users are silently excluded from the result (never surfaced past this module).
- `search_users(session, query, *, limit, offset) -> list[User]` (Phase 3, `search/` unit) — prefix full-text search over `User.search_vector`, excluding soft-deleted users, backing `GET /search/accounts`; see [[0x07-search]] for the tsquery-building/injection-safety detail.
- `app.users.dependencies.get_optional_current_user` — a FastAPI dependency for `feed/`'s guest-vs-authenticated read path (next unit): no `Authorization` header → `None` (guest); a present-but-invalid/malformed token → **401**, never a silent downgrade to guest; a valid token with no matching `User` row → `None`. Duplicates `get_current_identity`'s header-parsing rather than reusing it directly, since `get_current_identity` always raises on a missing header and there's no way to get `None` back for that one case without changing its behavior for every existing caller.

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
None remaining for `Follow`. Notification wiring is settled and now implemented (Phase 2, `posts/` facade unit — `PostEventBus` didn't exist before then): `app.users.service.follow()` publishes `UserFollowed` onto `app.eventbus.PostEventBus` (the app's one domain event bus, not `posts/`-exclusive despite the name — see [[0x00-architecture]] and [[0x03-posts]]) after a successful follow, never on `SelfFollowError`/`AlreadyFollowingError`. `follow()` now takes `event_bus: PostEventBus` as a required parameter; `app.users.routes.follow_user` supplies it via the new `app.dependencies.get_event_bus`.
