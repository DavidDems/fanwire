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
- **Compute**: Lambda (via Mangum-wrapped FastAPI) behind **API Gateway HTTP API**. Ingestion and media-processing jobs are separate Lambdas triggered by EventBridge Scheduler / GuardDuty scan-result events (via SQS), not the request path. A fourth function, the notifications consumer, reads `PostEventBus` events via SQS. All four run the same image (see "Infra (CDK) — implementation notes" below).
- **Data**: **RDS Postgres** is the system of record for every table in this wiki (`User`, `Follow`, `Team`, `Game`, `Post`, `PostLike`, `EventMention`, `Report`, `Media`, `Notification`, `NotificationPreference`). **DynamoDB** is used narrowly and only for: (1) a short-TTL live-score cache behind `CachedEventProxy`, (2) ingestion idempotency keys. Neither DynamoDB table is a source of truth for anything documented per-module below.
- **Media**: S3 quarantine bucket → GuardDuty Malware Protection scan → Pillow processing Lambda → S3 public bucket → CloudFront. Detail in [[0x04-media]].
- **Auth**: **Cognito** owns credentials, MFA, token issuance, and the password-reset/email-confirmation flows. No custom tables for any of that — see [[0x01-users]].
- **Edge**: CloudFront is the only public entry point (S3 and API Gateway are never exposed directly), per [[wiki/CodeContext/Standards/security|Security]].

## Cross-cutting conventions
- **Primary keys**: bigint identity (`bigserial`/`GENERATED ALWAYS AS IDENTITY`) on every table, not UUID. Nothing in [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] or [[wiki/CodeContext/Standards/security|Security]] calls for globally-unique pre-generated IDs (no multi-region write, no client-generated-ID flow), so a UUID's extra storage/index cost buys nothing here — KISS per [[wiki/CodeContext/Standards/design-principles|Design principles]]. Settled convention, applies to every table in this wiki.
- **Domain events are not `posts/`-exclusive**, only named that way historically. `PostEventBus` (EventBridge) is the app's one domain event bus — `users/` publishes onto it too (e.g. `UserFollowed`), alongside `posts/`'s `PostCreated`/`PostMentionedEvent`/`PostReported`. `notifications/` subscribes the same way regardless of publisher. This keeps the Observer pattern and the "no module reaches past its own interface boundary" connection rule uniform, rather than adding a one-off synchronous call from `users/` into `notifications/`.

## PostEventBus implementation (Phase 2, posts/ facade unit)
`app.eventbus.PostEventBus` (Observer) is implemented — deliberately at the top level (`app/eventbus.py`), not inside `app/posts/`, despite the name: `users/` publishes `UserFollowed` onto the same bus `posts/` publishes `PostCreated`/`PostMentionedEvent`/`PostReported` onto, and neither module should have to reach into the other's package to use it (same top-level-not-module-owned reasoning as `app.dependencies`, Phase 2a). `PostEventBus.publish()` forwards to an injected `EventPublisher` interface (Dependency Inversion, same shape as `media/`'s `MalwareScanner`). **No real `EventPublisher` (EventBridge `PutEvents`) adapter exists yet** — `app.dependencies.get_event_bus()`'s default production wiring is `PostEventBus(InMemoryEventPublisher())`, meaning every event published today goes nowhere outside the process. Consistent with Phase 2's known blockers (`notifications/`/`feed/`/`search/` don't exist until Phase 3 — nothing to deliver to yet) but worth re-confirming once Phase 3 gives `PostEventBus` its first real subscriber, which is the natural trigger to build a real adapter.

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

## Infra (CDK) — implementation notes
CDK app in `infra/` (TypeScript). **Synthesized and tested, never deployed.** Env from `cdk.json` context: account `294321867941`, region `ca-central-1`, `edgeRegion` `us-east-1`, `domainName` (default `fanwire.daviddems.ca`, `-c domainName=` for none), optional `hostedZoneId`/`hostedZoneName`. Three domain modes, each covered by tests: no domain (distribution on `*.cloudfront.net`, no cert); domain without zone (ACM cert with DNS validation, the CNAME added by hand, and the edge stack's deploy **waits** until it is; no alias records); domain + zone (cert validated in the zone, A/AAAA aliases). No `fromLookup` anywhere, and AZs are pinned to `a`/`b`, so synth needs no credentials.

**Stack split** (dependency order):
| Stack | Region | Contents | Why separate |
|---|---|---|---|
| `Fanwire-Edge` | us-east-1 | WAF WebACL (CLOUDFRONT: rate limit 1000/5 min/IP, Core, Known Bad Inputs, SQLi), ACM cert | AWS only accepts CloudFront certs/WebACLs from us-east-1 |
| `Fanwire-Network` | ca-central-1 | VPC (public/app/data subnets × 2 AZs), one NAT instance, S3 + DynamoDB gateway endpoints, Lambda/DB security groups | Changes almost never; everything VPC-bound depends on it |
| `Fanwire-Data` | ca-central-1 | the one CMK (rotation on), RDS Postgres `db.t4g.micro`, DynamoDB idempotency + live-score cache tables, secrets (DB creds, API-SPORTS key placeholder, CloudFront origin-verify value) | Stateful; an app deploy should never touch or risk replacing it |
| `Fanwire-Auth` | ca-central-1 | Cognito user pool + SPA client | No dependencies; prod pool (dev uses a hand-made pool, [[wiki/GeneralContext/Architecture/dev-auth-setup\|dev-auth-setup]]) |
| `Fanwire-Storage` | ca-central-1 | quarantine / public-media / frontend buckets, GuardDuty Malware Protection plan + role | Stateful; consumed by messaging, app and CDN |
| `Fanwire-Messaging` | ca-central-1 | `PostEventBus`, notification / ingestion-retry / media-scan-result queues each with a DLQ, the two EventBridge rules | Async plumbing independent of function code |
| `Fanwire-App` | ca-central-1 | the single image asset, api / ingestion / media / notifications functions, origin-verify authorizer, HTTP API, Scheduler, event source mappings | The part that changes on every backend release |
| `Fanwire-Cdn` | ca-central-1 | CloudFront distribution, OAC, the two CloudFront Functions, frontend + public-media bucket policies, Route 53 aliases | Needs the HTTP API id, so it comes after App |

The frontend and public-media bucket policies live in `Fanwire-Cdn`, not `Fanwire-Storage`: they must name the distribution ARN, and the distribution depends on App, which depends on Storage, so a Storage-owned policy would create a cycle. For the same reason the CMK's policy lets CloudFront decrypt for `distribution/*` in this account and EventBridge for `rule/*` in this account/region, rather than the exact ARNs.

**Egress (human decision 2026-09-18, [[wiki/CodeContext/Standards/aws-stack|AWS Stack]])**: one `t4g.nano` NAT *instance* (CDK `NatProvider.instanceV2`, Amazon Linux 2023 arm64) in the first public subnet. Both AZs' app subnets route `0.0.0.0/0` to it, and the data subnets have no route out. It has no key pair and requires IMDSv2. Its SG admits only TCP 443 from the Lambda SG and egresses only 443. Its role holds only the Session Manager agent statement. S3 and DynamoDB use the free gateway endpoints. **No interface endpoints**: every other AWS API the Lambdas call (EventBridge `PutEvents`, Secrets Manager, SES, Cognito `AdminGetUser`) goes out through the NAT instance. SQS polling and KMS decrypts happen on the AWS side, so the functions never call those APIs themselves.
| Endpoint | ~$/mo (1 AZ) | Would serve | Decision |
|---|---|---|---|
| S3 gateway | 0 | presign/put/get media | kept |
| DynamoDB gateway | 0 | idempotency, cache | kept |
| Secrets Manager | ~7.5 | ingestion cold start | not kept, reached through the NAT instance |
| EventBridge (`events`) | ~7.5 | api/ingestion `PutEvents` | not kept, reached through the NAT instance |
| SES (`email`) | ~7.5 | notifications | not kept, reached through the NAT instance |
| Cognito (`cognito-idp`) | ~7.5 | `AdminGetUser` (the JWKS fetch needs the internet regardless) | not kept, reached through the NAT instance |

The trade-off: the NAT instance is a single point of failure for all of these. If it's down, cached JWKS keep auth working for up to an hour, and ingestion/notifications retry via SQS.

**API origin protection**: HTTP APIs support neither resource policies nor WAF, and the execute-api endpoint can't be disabled because CloudFront needs it. So every route has a REQUEST Lambda authorizer (`OriginVerifyAuthorizer`, inline Python, outside the VPC) with identity source `$request.header.x-origin-verify`. A request without the header gets 401 from API Gateway before any function runs. The authorizer compares the header in constant time with the `OriginVerify` secret, which it reads at cold start, and caches each result for 5 minutes. CloudFront adds the header on `/api/*` from a `{{resolve:secretsmanager:…}}` dynamic reference, so the value appears in neither git nor the synthesized template. Rotating the secret needs a redeploy of `Fanwire-Cdn`, and old authorizer containers keep the previous value until they recycle.

**Frontend ↔ API contract**: the SPA calls `VITE_API_BASE_URL=/api` (same origin). FastAPI routes have no prefix (`/users`, `/posts`, `/feed`, `/health`, …). CloudFront's `/api/*` behaviour runs a viewer-request CloudFront Function that strips the leading `/api` (`/api/users/me` → `/users/me`). An origin path can only prepend, and a base-path mapping needs a custom domain on the API. That behaviour uses CachingDisabled plus the `AllViewerExceptHostHeader` origin request policy, which forwards `Authorization`, cookies and query strings, and all methods are allowed. The default behaviour (frontend bucket) uses a second function that rewrites extension-less paths to `/index.html`. There are deliberately no distribution-wide error pages, which would turn the API's own 403/404 JSON into HTML. `/media/*` serves the public-media bucket, whose keys are `media/{id}/…`, matching `app.media.pipeline`. Frontend build values come from the stack outputs: `VITE_API_BASE_URL` = `ApiBaseUrl` (`/api`), `VITE_COGNITO_USER_POOL_ID` = `UserPoolId`, `VITE_COGNITO_CLIENT_ID` = `UserPoolClientId`, `VITE_COGNITO_REGION` = `CognitoRegion`. The SPA must send the Cognito **ID token**: the backend verifier checks `aud` = client id.

**Media trigger**: the GuardDuty *scan-result* event, not raw `ObjectCreated`. The default-bus rule matches `aws.guardduty` / `GuardDuty Malware Protection Object Scan Result` / quarantine bucket and feeds the media queue (+ DLQ), which triggers the media function. Processing therefore never races the scan. The plan also tags objects, and the quarantine bucket policy denies `GetObject` to every principal except GuardDuty's role until an object is tagged `NO_THREATS_FOUND`. No CDK bucket-notification custom resource is involved: GuardDuty manages its own EventBridge wiring.

**IAM gate** (`infra/test/iam-policy.test.ts`, runs in CI): walks every policy document in every stack in all three domain modes, including CDK-generated ones. It fails on any `*` in an Action or Resource, any NotAction/NotResource, any Allow to Principal `*`, any AWS managed policy, and any IAM user or group. Every exception is listed below, and the test fails if an entry stops matching anything (`IAM_GATE_REPORT=1` lists each match):
- `kms-key-policy-self`: `Resource: "*"` inside the CMK's key policy, which means "this key".
- `s3-object-arns`: `<specific bucket ARN>/*` or `/<prefix>/*` for object-level S3 actions.
- `tls-only-deny`: `s3:*` / `sqs:*` in Deny statements conditioned on `aws:SecureTransport=false`.
- `lambda-vpc-eni`: the six ENI actions from AWS's `AWSLambdaVPCAccessExecutionRole`, written inline with `Resource "*"` (Describe* has no resource-level support, and Lambda validates the rest against `*`).
- `nat-instance-session-manager`: `ssm:UpdateInstanceInformation` + the four `ssmmessages:` channel actions, `Resource "*"` (AWS's documented Session Manager minimum).
- `guardduty-managed-eventbridge-rule`: `rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*`, GuardDuty's own managed rule name prefix.
- `cdk-cross-region-export-parameters`: `parameter/cdk/exports/*` (writer) and `parameter/cdk/exports/Fanwire-Cdn/*` (reader), from `crossRegionReferences`.
- `cdk-custom-resource-basic-execution`: `AWSLambdaBasicExecutionRole` on those two CDK cross-region custom-resource provider roles. They are the only managed policy and the only custom-resource Lambdas in the app.

Grants are never used. `grant*()` emits wildcard actions such as `kms:GenerateDataKey*`, so every role has hand-written statements. Constructs that would append grants to the CMK's policy (Secret, Queue, Bucket, Table) receive an imported `Key.fromKeyArn` handle instead.

**Known gaps**:
- `DATABASE_URL` is assembled from secret dynamic references, so the password sits in each function's environment. It is encrypted with the CMK, but anyone allowed `lambda:GetFunctionConfiguration` plus `kms:Decrypt` can read it, and secret rotation would break it.
- CloudFront access logging and WAF logging are off, to save cost.
- The HTTP API has stage throttling only. HTTP APIs have no usage plans, so per-user rate limiting is app-level.
- Nothing here creates an SES identity. Notifications get `ses:SendEmail` on `identity/<domainName>` only when a domain is configured, and Cognito uses its default email sender.
- With no custom domain, CloudFront's default certificate can't enforce `TLSv1.2_2021` for viewers.

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
