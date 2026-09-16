# 0x00 — Architecture

**Agent-facing.** Current-state only — see [[index]] for how this wiki is organized.

## Module boundaries
Per [[reference/Gang of Four Example|Gang of Four Example]], the codebase is organized as:

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

`moderation/` and `reporting/` from the GoF reference doc are **not built for v1** — [[reference/Projects|Projects]] is explicit that there is no moderation workflow, only the `Report` flag owned by `posts/` (see [[0x03-posts]]).

## Connection rule
No module reaches past its own interface boundary into another module's concrete classes or tables. Cross-module communication happens only through:
- **`PublishPostFacade`** — the single entry point for creating a post (validation → mention resolution against `events/` → confirm attached `media/` items are `Processed` → persistence → fan-out).
- **`PostEventBus`** (EventBridge) — `posts/` publishes `PostCreated`, `PostMentionedEvent`, `PostReported`; `feed/`, `notifications/`, and `search/`'s index refresh subscribe independently. `posts/` has zero knowledge of its subscribers.
- **Typed interfaces** — `SportsDataSource` (events/), `Notification` (notifications/), `FeedRankingStrategy` (feed/).

This is Dependency Inversion (see [[reference/Design principles|Design principles]]) enforced at module granularity, matching [[reference/Gang of Four Example|Gang of Four Example]]'s connection rule.

## AWS topology
Full detail and rationale in [[reference/AWS Stack|AWS Stack]]; summary of what runs where:
- **Compute**: Lambda (via Mangum-wrapped FastAPI) behind **API Gateway HTTP API**. Ingestion and media-processing jobs are separate Lambdas triggered by EventBridge Scheduler / S3 events, not the request path.
- **Data**: **RDS Postgres** is the system of record for every table in this wiki (`User`, `Follow`, `Team`, `Game`, `Post`, `PostLike`, `EventMention`, `Report`, `Media`, `Notification`, `NotificationPreference`). **DynamoDB** is used narrowly and only for: (1) a short-TTL live-score cache behind `CachedEventProxy`, (2) ingestion idempotency keys. Neither DynamoDB table is a source of truth for anything documented per-module below.
- **Media**: S3 quarantine bucket → GuardDuty Malware Protection scan → Pillow processing Lambda → S3 public bucket → CloudFront. Detail in [[0x04-media]].
- **Auth**: **Cognito** owns credentials, MFA, token issuance, and the password-reset/email-confirmation flows. No custom tables for any of that — see [[0x01-users]].
- **Edge**: CloudFront is the only public entry point (S3 and API Gateway are never exposed directly), per [[reference/Security|Security]].

## Cross-cutting conventions
- **Primary keys**: bigint identity (`bigserial`/`GENERATED ALWAYS AS IDENTITY`) on every table, not UUID. Nothing in [[reference/AWS Stack|AWS Stack]] or [[reference/Security|Security]] calls for globally-unique pre-generated IDs (no multi-region write, no client-generated-ID flow), so a UUID's extra storage/index cost buys nothing here — KISS per [[reference/Design principles|Design principles]]. Settled convention, applies to every table in this wiki.
- **Domain events are not `posts/`-exclusive**, only named that way historically. `PostEventBus` (EventBridge) is the app's one domain event bus — `users/` publishes onto it too (e.g. `UserFollowed`), alongside `posts/`'s `PostCreated`/`PostMentionedEvent`/`PostReported`. `notifications/` subscribes the same way regardless of publisher. This keeps the Observer pattern and the "no module reaches past its own interface boundary" connection rule uniform, rather than adding a one-off synchronous call from `users/` into `notifications/`.

## Data seeding order
`events/` has a hard ordering dependency the rest of the app doesn't: **`Team` must be seeded before the first `Game` import runs**, because `Game` rows FK into `Team` by `team_id`. There is no auto-create-team-on-first-seen path — an unrecognized team ID in an API-SPORTS payload is a fail-fast error (per [[reference/Design principles|Design principles]] "Fail fast"), not a silently created row. Detail in [[0x02-events]].

## Ingestion & processing pipelines
Both of the following are the same Template Method shape (`AbstractEventIngestionPipeline` in [[reference/Gang of Four Example|Gang of Four Example]]):
- **Sports data ingestion**: `fetchRawEvents → normalize → dedupe (DynamoDB idempotency table) → matchToMentions → publish`. `events/` never calls the API-SPORTS SDK directly outside the `ApiSportsAdapter`.
- **Media upload**: `validateType → scanForMalware → stripMetadata → generateVariants → publish`. Detail in [[0x04-media]].

## Security posture (account/project-level)
Per-entity security requirements live in each module's own file. Project-wide items that don't belong to any one module, per [[reference/Security|Security]]:
- AWS Organizations, two accounts (`workload`, `log-archive`); logs/backups live where a compromised workload account can't delete them.
- CloudFront + AWS WAF (Managed Rule Groups + rate-based rule) is the only public entry point; Shield Standard is automatic, Shield Advanced is explicitly not justified at this scale.
- GuardDuty and CloudTrail (multi-region, Object Lock) enabled in every account from day one.
- Every Lambda/service gets its own least-privilege IAM role — no shared "app role."
