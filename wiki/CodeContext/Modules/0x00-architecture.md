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

`moderation/` and `reporting/` from the GoF reference doc are **not built for v1** — [[wiki/GeneralContext/Architecture/business-rules|Projects]] is explicit that there is no moderation workflow, only the `Report` flag owned by `posts/` (see [[0x03-posts]]).

## Connection rule
No module reaches past its own interface boundary into another module's concrete classes or tables. Cross-module communication happens only through:
- **`PublishPostFacade`** — the single entry point for creating a post (validation → mention resolution against `events/` → confirm attached `media/` items are `Processed` → persistence → fan-out).
- **`PostEventBus`** (EventBridge) — `posts/` publishes `PostCreated`, `PostMentionedEvent`, `PostReported`; `feed/`, `notifications/`, and `search/`'s index refresh subscribe independently. `posts/` has zero knowledge of its subscribers.
- **Typed interfaces** — `SportsDataSource` (events/), `Notification` (notifications/), `FeedRankingStrategy` (feed/).

This is Dependency Inversion (see [[wiki/CodeContext/Standards/design-principles|Design principles]]) enforced at module granularity, matching [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]]'s connection rule.

## AWS topology
Full detail and rationale in [[wiki/CodeContext/Standards/aws-stack|AWS Stack]]; summary of what runs where:
- **Compute**: Lambda (via Mangum-wrapped FastAPI) behind **API Gateway HTTP API**. Ingestion and media-processing jobs are separate Lambdas triggered by EventBridge Scheduler / S3 events, not the request path.
- **Data**: **RDS Postgres** is the system of record for every table in this wiki (`User`, `Follow`, `Team`, `Game`, `Post`, `PostLike`, `EventMention`, `Report`, `Media`, `Notification`, `NotificationPreference`). **DynamoDB** is used narrowly and only for: (1) a short-TTL live-score cache behind `CachedEventProxy`, (2) ingestion idempotency keys. Neither DynamoDB table is a source of truth for anything documented per-module below.
- **Media**: S3 quarantine bucket → GuardDuty Malware Protection scan → Pillow processing Lambda → S3 public bucket → CloudFront. Detail in [[0x04-media]].
- **Auth**: **Cognito** owns credentials, MFA, token issuance, and the password-reset/email-confirmation flows. No custom tables for any of that — see [[0x01-users]].
- **Edge**: CloudFront is the only public entry point (S3 and API Gateway are never exposed directly), per [[wiki/CodeContext/Standards/security|Security]].

## Cross-cutting conventions
- **Primary keys**: bigint identity (`bigserial`/`GENERATED ALWAYS AS IDENTITY`) on every table, not UUID. Nothing in [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] or [[wiki/CodeContext/Standards/security|Security]] calls for globally-unique pre-generated IDs (no multi-region write, no client-generated-ID flow), so a UUID's extra storage/index cost buys nothing here — KISS per [[wiki/CodeContext/Standards/design-principles|Design principles]]. Settled convention, applies to every table in this wiki.
- **Domain events are not `posts/`-exclusive**, only named that way historically. `PostEventBus` (EventBridge) is the app's one domain event bus — `users/` publishes onto it too (e.g. `UserFollowed`), alongside `posts/`'s `PostCreated`/`PostMentionedEvent`/`PostReported`. `notifications/` subscribes the same way regardless of publisher. This keeps the Observer pattern and the "no module reaches past its own interface boundary" connection rule uniform, rather than adding a one-off synchronous call from `users/` into `notifications/`.

## Mutual-FK pattern (Phase 2, posts/ FK-closure unit)
`users/`↔`media/` ended up with a genuine circular table dependency once both deferred FKs closed (`media.uploader_id → users.id`, `users.profile_picture_media_id → media.id`) — not hypothetical, confirmed via `CircularDependencyError` from `Base.metadata.create_all()`, which needs one linear table-creation order. Fix, and the precedent for the next module pair that ends up with mutual FKs: mark the *later*-added FK `ForeignKey(..., use_alter=True, name=<explicit name>)`, deferring that one constraint to a post-create `ALTER TABLE` (the Alembic migration mirrors this as a separate `ADD CONSTRAINT` step, not part of either table's `create_table`). Separately (not the same problem): don't import the target class across a 3-module cycle just because that's this codebase's usual "real FK target" import style (`from app.other.models import Other  # noqa: F401`) — a bare FK string (`ForeignKey("media.id")`) resolves lazily against `Base.metadata` and doesn't require the import at all; only import the class when doing so doesn't close a cycle. See [[0x01-users]]/[[0x04-media]] for the concrete instance.

## Cross-cutting FastAPI DI (Phase 2a)
Phase 0/1 built `events/`, `users/`, and `media/` as pure Python modules — no route ever needed a `Settings` instance or a DB `Session` via FastAPI dependency injection before. Phase 2a (`wiki/GeneralContext/Prompts/phase-2-manager-agent.md`), the first pass to add real routes, needed this plumbing and it didn't exist. It now lives in `app.dependencies` (top-level, not inside any one module — no module owns cross-cutting DI, per the connection rule): `get_settings()` (cached `Settings` instance) and `get_session()` (request-scoped SQLAlchemy `Session`, closed in a `finally` block). Every module's routes depend on these rather than constructing `Settings()`/a `Session` directly; route tests override `get_session` via `app.dependency_overrides`, the same pattern already used for `app.users.dependencies.get_token_verifier`.

## Data seeding order
`events/` has a hard ordering dependency the rest of the app doesn't: **`Team` must be seeded before the first `Game` import runs**, because `Game` rows FK into `Team` by `team_id`. There is no auto-create-team-on-first-seen path — an unrecognized team ID in an API-SPORTS payload is a fail-fast error (per [[wiki/CodeContext/Standards/design-principles|Design principles]] "Fail fast"), not a silently created row. Detail in [[0x02-events]].

## Ingestion & processing pipelines
Both of the following are the same Template Method shape (`AbstractEventIngestionPipeline` in [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]]):
- **Sports data ingestion**: `fetchRawEvents → normalize → dedupe (DynamoDB idempotency table) → matchToMentions → publish`. `events/` never calls the API-SPORTS SDK directly outside the `ApiSportsAdapter`.
- **Media upload**: `validateType → scanForMalware → stripMetadata → generateVariants → publish`. Detail in [[0x04-media]].

## Security posture (account/project-level)
Per-entity security requirements live in each module's own file. Project-wide items that don't belong to any one module, per [[wiki/CodeContext/Standards/security|Security]]:
- CloudFront + AWS WAF (Managed Rule Groups + rate-based rule) is the only public entry point; Shield Standard is automatic, Shield Advanced is explicitly not justified at this scale.
- Every Lambda/service gets its own least-privilege IAM role — no shared "app role."

### AWS account state (current, verified)

**Organizations** — primary region `ca-central-1` across all three accounts; CloudFront's ACM cert is the one exception, always issued in `us-east-1` regardless.
- Management account: `daviddemers92@gmail.com` (alias `DavidDems`). Root MFA on (authenticator app), no root access keys, root not used day-to-day.
- `fanwire-workload` — account ID `294321867941`, email `daviddemers92+fanwire-workload@gmail.com`. Where the app runs; CDK deploys here.
- `fanwire-log-archive` — account ID `801132668027`, email `daviddemers92+fanwire-logarchive@gmail.com`. Logs/backups only, holds nothing `workload` can reach or delete.

**Human access (IAM Identity Center)** — SSO start URL `https://d-9d6748d7e4.awsapps.com/start`. No IAM users or long-lived access keys exist for human use in any account.
- Permission set `AdministratorAccess` → `fanwire-workload`.
- Permission set `PowerUserAccess` → `fanwire-log-archive` (excludes IAM/Organizations management, so a human SSO session there can't create a backdoor IAM role).

**CI access (OIDC)** — in `fanwire-workload`:
- OIDC identity provider `token.actions.githubusercontent.com` registered.
- Role `GitHubActionsDeployRole`, trust policy restricted to `repo:DavidDems/fanwire:ref:refs/heads/main` (audience `sts.amazonaws.com`) — only a workflow run from `main` in this exact repo can assume it.
- No permissions policy attached yet. CI cannot deploy or touch anything through this role until its permissions are scoped deliberately, once the CDK stacks exist and a human has reviewed the generated IAM policy (immediately before the first `cdk deploy` — see [[wiki/GeneralContext/Prompts/first-pass-manager-agent|first-pass-manager-agent]] Phase 6).

**CloudTrail**
- Trail `fanwire-workload-trail` in `fanwire-workload`: multi-region, log file validation on, management events (read + write) only.
- Delivers to S3 bucket `fanwire-cloudtrail-801132668027-ca-central-1-an` in `fanwire-log-archive`: Object Lock on (Governance mode, 90-day default retention), all public access blocked.

**GuardDuty**
- Delegated administrator: `fanwire-log-archive` (`801132668027`); Organizations trusted access enabled; auto-enable for new Organizations accounts on.
- `fanwire-workload` and the management account added as member accounts. Org-account-list propagation into the delegated-admin view was still settling as of this setup pass — re-confirm `fanwire-workload` shows GuardDuty status **Enabled** before treating this control as live.

**AWS Config** — enabled in `fanwire-workload` only (not `log-archive` or management).
- Recording strategy: all resource types, no overrides — global IAM resource types included, recorded in `ca-central-1`.
- Recording mode: continuous.
- Delivery bucket: `fanwire-config-294321867941` in `fanwire-workload`.
- IAM role: AWS Config service-linked role (default).
- No Config Rules defined yet — recorder only, no compliance evaluation running.

**AWS Budgets** — one cost budget on the management account (rolls up the full consolidated org bill once member accounts have spend): $20/month, alerts at 80% and 100% of actual, emailed to `daviddemers92@gmail.com`. No automated actions configured.

**Outstanding**
- `GitHubActionsDeployRole` has no permissions — blocks any real `cdk deploy`, by design, until Phase 6 stacks exist and get reviewed.
- GuardDuty member-account propagation not yet reverified.
- No AWS Config Rules defined.
- Incident runbook written but interim (`wiki/GeneralContext/Architecture/incident-runbook.md`, per [[wiki/CodeContext/Standards/security|Security]] "Detection & response") — deliberately generic pending Phase 6 CDK stacks; revisit then.
- Security Hub not enabled (optional at this budget, per [[wiki/CodeContext/Standards/security|Security]]).
