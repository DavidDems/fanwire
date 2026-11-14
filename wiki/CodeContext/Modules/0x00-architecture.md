---
type: reference
---

# 0x00 — Architecture

**Agent-facing.** Current-state only — see [[wiki/GeneralContext/index|index]] for how this wiki is organized.

## Module boundaries
Per [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]], the codebase is organized as:

```
fanwire/
├── feed/          # timeline assembly, ranking — no owned tables
├── posts/         # Post, PostLike, EventMention, Report
├── media/         # Media, upload pipeline
├── events/        # Team, Game (sports data)
├── users/         # User, Follow
├── notifications/ # Notification, NotificationPreference
└── search/        # no owned tables, indexes other modules' data
```

`moderation/` and `reporting/` from the GoF reference doc are **not built for v1** — [[wiki/GeneralContext/Architecture/business-rules|Projects]] is explicit that there is no moderation workflow, only the `Report` flag owned by `posts/` (see [[0x03d-posts-reports]]).

## Connection rule
No module reaches past its own interface boundary into another module's concrete classes or tables. Cross-module communication happens only through:
- **`PublishPostFacade`** — the single entry point for creating a post (validation → mention resolution against `events/` → confirm attached `media/` items are `Processed` → persistence → fan-out).
- **`PostEventBus`** (EventBridge) — `posts/` publishes `PostCreated` and `PostReported`; `notifications/` subscribes (the `NotificationRule`, `PostCreated` and `UserFollowed`), and `feed/` and `search/` subscribe to nothing. `posts/` has zero knowledge of its subscribers.
- **Typed interfaces** — `SportsDataSource` (events/), `Notification` (notifications/), `FeedRankingStrategy` (feed/).

This is Dependency Inversion (see [[wiki/CodeContext/Standards/design-principles|Design principles]]) enforced at module granularity, matching [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]]'s connection rule.

## AWS topology
Full detail and rationale in [[wiki/CodeContext/Standards/aws-stack|AWS Stack]]; summary of what runs where:
- **Compute**: Lambda (via Mangum-wrapped FastAPI) behind **API Gateway HTTP API**. Media processing is a separate Lambda triggered by GuardDuty scan-result events (via SQS), not the request path. A third function, the notifications consumer, reads `PostEventBus` events via SQS, and a fourth, `Migration`, runs Alembic when a human invokes it. All four run the same image. NBA data is loaded from a dataset, not ingested ([[0x02b-events-loading]]). See [[0x00a-architecture-infra]] "Infra (CDK) — implementation notes".
- **Data**: **RDS Postgres** is the system of record for every table in this wiki (`User`, `Follow`, `Team`, `Game`, `Player`, `PlayerGameStats`, `Post`, `PostLike`, `EventMention`, `Report`, `Media`, `Notification`, `NotificationPreference`). **DynamoDB** has no caller: its two tables (a live-score cache and ingestion idempotency keys, both unused) exist in `Fanwire-Data` with their exports kept alive until a later infra unit deletes them. Neither is a source of truth for anything documented per-module.
- **Media**: S3 quarantine bucket → GuardDuty Malware Protection scan → Pillow processing Lambda → S3 public bucket → CloudFront. Detail in [[0x04-media]].
- **Auth**: **Cognito** owns credentials, MFA, token issuance, and the password-reset/email-confirmation flows. No custom tables for any of that — see [[0x01-users]].
- **Edge**: CloudFront is the only public entry point (S3 and API Gateway are never exposed directly), per [[wiki/CodeContext/Standards/security|Security]].

## Cross-cutting conventions
- **Primary keys**: bigint identity (`bigserial`/`GENERATED ALWAYS AS IDENTITY`) on every table, not UUID. Nothing in [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] or [[wiki/CodeContext/Standards/security|Security]] calls for globally-unique pre-generated IDs (no multi-region write, no client-generated-ID flow), so a UUID's extra storage/index cost buys nothing here — KISS per [[wiki/CodeContext/Standards/design-principles|Design principles]]. Settled convention, applies to every table in this wiki.
- **Domain events are not `posts/`-exclusive**, despite the name. `PostEventBus` (EventBridge) is the app's one domain event bus — `users/` publishes onto it too (e.g. `UserFollowed`), alongside `posts/`'s `PostCreated`/`PostReported`. `notifications/` subscribes the same way regardless of publisher. This keeps the Observer pattern and the "no module reaches past its own interface boundary" connection rule uniform, rather than adding a one-off synchronous call from `users/` into `notifications/`.

## PostEventBus implementation (Phase 2, posts/ facade unit; real adapter Phase 4)
`app.eventbus.PostEventBus` (Observer) is implemented — deliberately at the top level (`app/eventbus.py`), not inside `app/posts/`, despite the name: `users/` publishes `UserFollowed` onto the same bus `posts/` publishes `PostCreated`/`PostReported` onto, and neither module should have to reach into the other's package to use it (same top-level-not-module-owned reasoning as `app.dependencies`). `PostEventBus.publish()` forwards to an injected `EventPublisher` interface (Dependency Inversion, same shape as `media/`'s `MalwareScanner`).

**Real `EventPublisher` adapter: `app.eventbus.EventBridgePublisher`** — boto3 `events.put_events` against a fixed EventBridge bus (an already-constructed client is injected, this class never resolves credentials/region itself), targeting `EventBusName=<Settings.post_event_bus_name>`. Fails fast (`EventBridgePublishError`) when the response reports `FailedEntryCount > 0`, since `PutEvents` returns HTTP 200 even on a partially-failed publish. `app.dependencies.get_event_bus()` wires this in once `Settings.post_event_bus_name` (`POST_EVENT_BUS_NAME`, infra's real bus name) is set, falling back to `InMemoryEventPublisher` otherwise (local dev/tests) — the same "real adapter once the name is known" shape as `SesEmailSender`. `Source`/`DetailType` are decided by the caller (`PostEventBus.SOURCE == "fanwire"`) — `messaging-stack.ts`'s `NotificationRule` filters only on `detailType` (`["PostCreated", "UserFollowed"]`), never `source`, so the rule matches whatever the source string is.

**Third `EventPublisher`, for the local stack only (`NOTIFICATIONS-001`): `app.notifications.local_dispatch.LocalDispatchPublisher`.** `get_event_bus()` wires it when `Settings.post_event_bus_name` is empty and `Settings.environment` is exactly `development`; any other value with no bus name keeps `InMemoryEventPublisher`. It calls `app.notifications.consumer.handle_domain_event` in process, with its own session from the injected `open_session`, and a failure never reaches the publisher's caller. It lives in `notifications/`, not `app/eventbus.py`, which stays free of module imports, and `get_event_bus()` is the only place that knows both sides. **Fail closed:** `Settings` refuses `ENVIRONMENT=development` beside a non-empty `POST_EVENT_BUS_NAME` or `AWS_LAMBDA_FUNCTION_NAME`, and `infra/test/local-dispatch-env.test.ts` pins that no Lambda function sets it, so a deployed function missing its bus name either behaves as before or refuses to start. Details in [[0x05-notifications]] "Local dispatch".

## Mutual-FK pattern (Phase 2, posts/ FK-closure unit)
`users/`↔`media/` have a genuine circular table dependency (`media.uploader_id → users.id`, `users.profile_picture_media_id → media.id`): without the fix, `Base.metadata.create_all()`, which needs one linear table-creation order, raises `CircularDependencyError`. Fix, and the precedent for the next module pair that ends up with mutual FKs: mark the *later*-added FK `ForeignKey(..., use_alter=True, name=<explicit name>)`, deferring that one constraint to a post-create `ALTER TABLE` (the Alembic migration mirrors this as a separate `ADD CONSTRAINT` step, not part of either table's `create_table`). Separately (not the same problem): don't import the target class across a 3-module cycle just because that's this codebase's usual "real FK target" import style (`from app.other.models import Other  # noqa: F401`) — a bare FK string (`ForeignKey("media.id")`) resolves lazily against `Base.metadata` and doesn't require the import at all; only import the class when doing so doesn't close a cycle. See [[0x01a-users-schema]]/[[0x04-media]] for the concrete instance.

## Cross-cutting FastAPI DI (Phase 2a)
The request plumbing every route shares lives in `app.dependencies` (top-level, not inside any one module — no module owns cross-cutting DI, per the connection rule): `get_settings()` (cached `Settings` instance) and `get_session()` (request-scoped SQLAlchemy `Session`, closed in a `finally` block). Every module's routes depend on these rather than constructing `Settings()`/a `Session` directly; route tests override `get_session` via `app.dependency_overrides`, the same pattern already used for `app.users.dependencies.get_token_verifier`.

## Data seeding order
`events/` has a hard ordering dependency the rest of the app doesn't: **`Team` must be seeded before the first `Game` import runs**, because `Game` rows FK into `Team` by `team_id`. There is no auto-create-team-on-first-seen path — an unrecognized team ID in the NBA dataset's games and box scores is a fail-fast error (per [[wiki/CodeContext/Standards/design-principles|Design principles]] "Fail fast"), not a silently created row; so is a box-score player missing from the dataset's player list. The NBA dataset loader (`app.events.nba_history`) seeds `Team` from its fixed list of the 30 franchises, and `Player` from `Players.csv`, in the same transaction as its games, before them. Detail in [[0x02b-events-loading]].

## Ingestion & processing pipelines
- **Sports data**: loaded from the NBA dataset's CSV files by `events/`'s loader, one transaction per run ([[0x02b-events-loading]]).
- **Media upload** (Template Method, [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]]): `validateType → scanForMalware → stripMetadata → generateVariants → publish`. Detail in [[0x04-media]].


## Security posture (account/project-level)
Per-entity security requirements live in each module's own file. Project-wide items that don't belong to any one module, per [[wiki/CodeContext/Standards/security|Security]]:
- CloudFront + AWS WAF (Managed Rule Groups + rate-based rule) is the only public entry point; Shield Standard is automatic, Shield Advanced is explicitly not justified at this scale.
- Every Lambda/service gets its own least-privilege IAM role — no shared "app role."

Account state (Organizations, access, DNS, bootstrap, CloudTrail, GuardDuty, Config, Budgets) is [[0x00c-architecture-aws-account]]; the IAM gate and the known gaps are [[0x00b-architecture-iam-gaps]].

## Parts

The infra and account sections live in one part file each:

- [[0x00a-architecture-infra]]: the CDK app: config and domain modes, the stack split, alarms, egress and the NAT instance, API origin protection, the frontend ↔ API contract and the media trigger
- [[0x00b-architecture-iam-gaps]]: the IAM gate and its allow-list, and the known gaps (secrets in env, SES identity, the opt-in SPA upload, the manual migration runner, Lambda concurrency)
- [[0x00c-architecture-aws-account]]: AWS account state: Organizations, human and CI access, DNS, CDK bootstrap and the role boundary, CloudTrail, GuardDuty, Config, Budgets and what is outstanding
