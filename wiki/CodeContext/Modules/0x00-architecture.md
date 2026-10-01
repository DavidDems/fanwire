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

## PostEventBus implementation (Phase 2, posts/ facade unit; real adapter Phase 4)
`app.eventbus.PostEventBus` (Observer) is implemented — deliberately at the top level (`app/eventbus.py`), not inside `app/posts/`, despite the name: `users/` publishes `UserFollowed` onto the same bus `posts/` publishes `PostCreated`/`PostMentionedEvent`/`PostReported` onto, and neither module should have to reach into the other's package to use it (same top-level-not-module-owned reasoning as `app.dependencies`, Phase 2a). `PostEventBus.publish()` forwards to an injected `EventPublisher` interface (Dependency Inversion, same shape as `media/`'s `MalwareScanner`).

**Real `EventPublisher` adapter implemented (Phase 4 Lambda-handlers unit): `app.eventbus.EventBridgePublisher`** — boto3 `events.put_events` against a fixed EventBridge bus (an already-constructed client is injected, this class never resolves credentials/region itself), targeting `EventBusName=<Settings.post_event_bus_name>`. Fails fast (`EventBridgePublishError`) when the response reports `FailedEntryCount > 0`, since `PutEvents` returns HTTP 200 even on a partially-failed publish. `app.dependencies.get_event_bus()` now wires this in once `Settings.post_event_bus_name` (`POST_EVENT_BUS_NAME`, infra's real bus name) is set, falling back to `InMemoryEventPublisher` otherwise (local dev/tests, or any phase before that env var exists) — same "real adapter once the name is known" shape used elsewhere in this pass (`DynamoDbLiveScoreCache`, `SesEmailSender`). `Source`/`DetailType` are still decided by the caller (`PostEventBus.SOURCE == "fanwire"`, unchanged) — `messaging-stack.ts`'s `NotificationRule` filters only on `detailType` (`["PostCreated", "UserFollowed"]`), never `source`, so that string already matches the rule; confirmed rather than changed, no infra edit was needed for this adapter to be delivered.

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
CDK app in `infra/` (TypeScript). **Deployed 2026-09-29/30** (all eight stacks — see "First deploy, 2026-09-29" and "Phase 3, 2026-09-30" below); CI still only synthesizes and tests. Env from `cdk.json` context: account `294321867941`, region `ca-central-1`, `edgeRegion` `us-east-1`, `domainName` (default `fanwire.daviddems.com`, `-c domainName=` for none), optional `hostedZoneId`/`hostedZoneName`. One further key, `deployFrontend`, is deliberately **not** in `cdk.json` — "off by default" is implemented by its absence, and it is supplied per-invocation as `-c deployFrontend=true` (see the `INFRA-002` entry under Known gaps). Three domain modes, each covered by tests: no domain (distribution on `*.cloudfront.net`, no cert); domain without zone (ACM cert with DNS validation, the CNAME added by hand, and the edge stack's deploy **waits** until it is; no alias records); domain + zone (cert validated in the zone, A/AAAA aliases). No `fromLookup` anywhere, and AZs are pinned to `a`/`b`, so synth needs no credentials.

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

**Egress (human decision 2026-09-18, [[wiki/CodeContext/Standards/aws-stack|AWS Stack]])**: one `t4g.nano` NAT *instance* (CDK `NatProvider.instanceV2`, Amazon Linux 2023 arm64) in the first public subnet. Both AZs' app subnets route `0.0.0.0/0` to it, and the data subnets have no route out. It has no key pair and requires IMDSv2. Its SG admits only TCP 443 from the Lambda SG and egresses only 443. Its role holds only the Session Manager agent statement. S3 and DynamoDB use the free gateway endpoints. **No interface endpoints**: every other AWS API the Lambdas call (EventBridge `PutEvents`, Secrets Manager, SES, Cognito `AdminGetUser`) goes out through the NAT instance. SQS polling and KMS decrypts happen on the AWS side, so the functions never call those APIs themselves. **Bootstrap**: the instance runs `NAT_BOOTSTRAP` (`infra/lib/network-stack.ts`), not CDK's default user data. The default ran `yum install iptables-services`, which the OOM killer ended on the 512 MB nano, so the first deployed instance never wrote a MASQUERADE rule and forwarded nothing (see "Phase 3" below). Ours adds 1 GB of swap before `dnf`, finds the interface with `ip route` (AL2023 has no `route`), persists the rule with `iptables.init save` (no `/usr/sbin/service` either), and runs under `set -euxo pipefail`, so the console log (`aws ec2 get-console-output`) shows each command and where it stopped. The instance's logical id carries a hash of the script: cloud-init runs user data only on first boot, and without the hash a script change would stop-start the old instance and never run.
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

**Frontend ↔ API contract**: the SPA calls `VITE_API_BASE_URL=/api` (same origin). FastAPI routes have no prefix (`/users`, `/posts`, `/feed`, `/health`, …). CloudFront's `/api/*` behaviour runs a viewer-request CloudFront Function that strips the leading `/api` (`/api/users/me` → `/users/me`). An origin path can only prepend, and a base-path mapping needs a custom domain on the API. That behaviour uses CachingDisabled plus the `AllViewerExceptHostHeader` origin request policy, which forwards `Authorization`, cookies and query strings, and all methods are allowed. The default behaviour (frontend bucket) uses a second function that rewrites extension-less paths to `/index.html`. There are deliberately no distribution-wide error pages, which would turn the API's own 403/404 JSON into HTML. `/media/*` serves the public-media bucket, whose keys are `media/{id}/…`, matching `app.media.pipeline`. Frontend build values come from the stack outputs: `VITE_API_BASE_URL` = `ApiBaseUrl` (`/api`), `VITE_COGNITO_USER_POOL_ID` = `UserPoolId`, `VITE_COGNITO_CLIENT_ID` = `UserPoolClientId`, `VITE_COGNITO_REGION` = `CognitoRegion`, and `VITE_MEDIA_BASE_URL` = the site origin (`SiteUrl`, not `/media` — the keys already carry the `media/` prefix). The SPA must send the Cognito **ID token**: the backend verifier checks `aud` = client id.

**Media trigger**: the GuardDuty *scan-result* event, not raw `ObjectCreated`. The default-bus rule matches `aws.guardduty` / `GuardDuty Malware Protection Object Scan Result` / quarantine bucket and feeds the media queue (+ DLQ), which triggers the media function. Processing therefore never races the scan. The plan also tags objects, and the quarantine bucket policy denies `GetObject` to every principal except GuardDuty's role until an object is tagged `NO_THREATS_FOUND`. No CDK bucket-notification custom resource is involved: GuardDuty manages its own EventBridge wiring.

**IAM gate** (`infra/test/iam-policy.test.ts`, runs in CI): walks every policy document in every stack in all three domain modes, including CDK-generated ones. It fails on any `*` in an Action or Resource, any NotAction/NotResource, any Allow to Principal `*`, any AWS managed policy, and any IAM user or group. Every exception is listed below, and the test fails if an entry stops matching anything (`IAM_GATE_REPORT=1` lists each match):
- `kms-key-policy-self`: `Resource: "*"` inside the CMK's key policy, which means "this key".
- `s3-object-arns`: `<specific bucket ARN>/*` or `/<prefix>/*` for object-level S3 actions.
- `tls-only-deny`: `s3:*` / `sqs:*` in Deny statements conditioned on `aws:SecureTransport=false`.
- `lambda-vpc-eni`: the six ENI actions from AWS's `AWSLambdaVPCAccessExecutionRole`, written inline with `Resource "*"` (Describe* has no resource-level support, and Lambda validates the rest against `*`). **Reviewed 2026-09-30 against the deployed topology** (the human's ACCEPT was conditional on it):
  - *Is the VPC attachment avoidable for any function?* No. All five VPC-attached functions (Api, Ingestion, Media, Notifications, Migration) open a database session, and RDS is only reachable in-VPC. The two functions that touch no database — the origin-verify authorizer and the CDK `BucketDeployment` handler — already run outside the VPC (`VpcConfig` null, confirmed live).
  - *Is `Resource "*"` the floor?* Yes. AWS's Lambda guide (*Giving Lambda functions access to resources in an Amazon VPC* → *Required IAM permissions*) says a custom policy must add all six "and allow them on all resources (`"Resource": "*"`)". Resource-scoping them is not supported, and getting it wrong fails at `CreateFunction`.
  - *What the same page recommends instead,* and the one real improvement left: the six actions are also usable by the function's own code. A `Deny` on them conditioned on `lambda:SourceFunctionArn` — a key present only on calls the function code makes — keeps the Lambda service able to manage ENIs while the code cannot. Not implemented; recorded as a follow-up in `TODO/02` §2. An `ArnLike` on `arn:aws:lambda:<region>:<account>:function:Fanwire-App-*` would cover all five without the policy→function dependency cycle a per-function ARN would create.
- `nat-instance-session-manager`: `ssm:UpdateInstanceInformation` + the four `ssmmessages:` channel actions, `Resource "*"` (AWS's documented Session Manager minimum).
- `guardduty-managed-eventbridge-rule`: `rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*`, GuardDuty's own managed rule name prefix.
- `cdk-cross-region-export-parameters`: `parameter/cdk/exports/*` (writer) and `parameter/cdk/exports/Fanwire-Cdn/*` (reader), from `crossRegionReferences`.
- `cdk-custom-resource-basic-execution`: `AWSLambdaBasicExecutionRole` on those two CDK cross-region custom-resource provider roles. They are the only managed policy and the only custom-resource Lambdas in the app.

Grants are never used. `grant*()` emits wildcard actions such as `kms:GenerateDataKey*`, so every role has hand-written statements. Constructs that would append grants to the CMK's policy (Secret, Queue, Bucket, Table) receive an imported `Key.fromKeyArn` handle instead.

**Known gaps**:
- `DATABASE_URL` is assembled from secret dynamic references, so the password sits in each function's environment. It is encrypted with the CMK, but anyone allowed `lambda:GetFunctionConfiguration` plus `kms:Decrypt` can read it, and secret rotation would break it. **Still deferred** (confirmed, Phase 4 Lambda-handlers unit): reading DB credentials from Secrets Manager at cold start instead of assembling `DATABASE_URL` from a dynamic reference is real future work, not done in this pass — `app.dependencies`/`app.settings` still take a single `database_url` connection string as-is.
- CloudFront access logging and WAF logging are off, to save cost.
- The HTTP API has stage throttling only. HTTP APIs have no usage plans, so per-user rate limiting is app-level.
- Nothing here creates an SES identity. Notifications get `ses:SendEmail` on `identity/<domainName>` only when a domain is configured, and Cognito uses its default email sender. `app.notifications.email.SesEmailSender` (Phase 4 Lambda-handlers unit) is built to match: it skips sending (no raise, no PII logged) whenever `NOTIFICATION_FROM_ADDRESS` is unset, which is every environment until a domain exists.
- With no custom domain, CloudFront's default certificate can't enforce `TLSv1.2_2021` for viewers.
- ~~**Nothing uploads the frontend to its bucket.**~~ — **closed** (`INFRA-002`): `CdnStack` now builds a `BucketDeployment` of `frontend/dist` into `frontendBucket`, with a CloudFront invalidation of `/*` so a redeploy isn't masked by the cache. It is **opt-in** and off by default, because `frontend/dist` is a gitignored build output and `Source.asset()` resolves at synth time — an unconditional deployment would take credential-free CI synth red. Deploying the SPA is therefore `npm run build` in `frontend/`, then `npx cdk deploy -c deployFrontend=true` from `infra/`. `loadConfig` reads the flag as a boolean and accepts both a real boolean and the string `"true"`, since the CDK CLI passes `-c key=value` through as a string; a boolean-only reader would make that exact command silently do nothing. Note the ordering constraint in the `FRONTEND-001` entry below still applies: the bundle has to be built against the deployed pool ids before it is worth uploading.
  - The deployment's Lambda-backed custom resource is the one place in this app where wildcard IAM actions are unavoidable: `aws-s3-deployment` applies `grantRead`/`grantReadWrite` to whatever role it is handed, so a hand-written narrow role does not suppress them. Three `ALLOW_LIST` entries in `infra/test/iam-policy.test.ts` cover them (staging-bucket read, the two grant action sets, and `cloudfront:CreateInvalidation`, which has no resource-level permissions), each pinning its action set *exactly* so a widened grant fails the build. The gate now synthesizes all three domain modes twice, with the flag off and on — with it off, as CI runs, none of these policies exist at all.
- **There is no frontend-only deploy.** `CdnStack` takes `AppStack`'s HTTP API as an origin, and `AppStack` depends on `Network`, `Data`, `Auth`, `Storage` and `Messaging`. The first `cdk deploy` therefore brings up all eight stacks — VPC, NAT instance, RDS, Cognito, queues and five Lambdas — with the full monthly cost and 30–45 minutes of wall clock, not just a static site.
- ~~**The frontend has no configuration mechanism.**~~ — **closed** (`FRONTEND-001`): `frontend/src/config.ts` is the one reader of `import.meta.env`, validates at module load and throws naming every missing variable ([[0x08-frontend]]). What remains true is the *ordering*: the production user pool and SPA client ids exist only after `Fanwire-Auth` deploys, while Vite bakes `VITE_*` in at build time, so it is deploy → read outputs → build → upload. `docker/frontend.Dockerfile`'s `build` stage now takes all five as build args and fails if any is empty, so a bundle can no longer be produced against a missing value. `frontend/.env.local` (untracked) serves local dev only — a test run reads `vite.config.ts`'s `test.env` instead, and never that file.
- ~~**No production migration runner exists yet.**~~ — **closed** (`INFRA-003`): `app.migrate.handler` runs `alembic upgrade head` through Alembic's Python API and returns the head revision; `AppStack`'s `Migration` function is a fifth `cmd` override on the **same** `DockerImageAsset` as the other four, so the code that migrates the schema is byte-for-byte the code that runs against it. Reserved concurrency 1 (two concurrent upgrades against one database is a lock fight), 600s timeout, same VPC/app subnets/security group as the api function so it can reach RDS, and no IAM beyond what every backend function already gets — `DATABASE_URL` is a deploy-time dynamic reference, not a runtime Secrets Manager call.
  - **Nothing invokes it**, deliberately: no EventBridge rule, no schedule, no event source mapping, no CloudFormation custom resource. DDL inside a stack update makes every deploy a schema change, makes rollback ambiguous, and puts `alembic upgrade head` inside CloudFormation's timeout and failure semantics. The cost of the manual step is one documented command; the cost of the automatic one is a class of outage. `infra/test/app-stack.test.ts` sweeps every stack for an invoker so a later "improvement" fails the build rather than shipping quietly.
  - **The deploy order is therefore `cdk deploy` → invoke `Migration` once → the API works.** Until it is invoked, RDS has no tables and the other four Lambdas fail against it.
  - On failure the handler raises, so the invocation is recorded as failed rather than green. It never emits `DATABASE_URL`: the exception is raised `from None` — Lambda renders the whole `__cause__` chain to CloudWatch, and SQLAlchemy/psycopg put the connect string in their messages — carrying a redacted rendering of the original error instead, so the error type, host and database survive and the credential does not.
  - **Only one migration at a time is a Postgres session-level advisory lock** (`pg_try_advisory_lock`, `app.migrate.MIGRATION_LOCK_KEY`), taken before any DDL and held for the whole upgrade. It is *not* `reservedConcurrentExecutions` on the Lambda — that is asserted **absent**, and `infra/test/app-stack.test.ts` fails the build if it comes back. Two reasons: a reservation couples the template to an account-level quota (see the deploy note below), and it only ever constrained that one Lambda, while `alembic upgrade head` also runs from the `dev` image's `CMD` and from any shell holding a `DATABASE_URL`. The lock binds every caller. `try_` rather than the blocking form, so a second migration fails fast with `MigrationLockUnavailable` instead of sitting in a timeout.
- **`backend/alembic/env.py:25` passes `database_url` to `set_main_option` unescaped**, so a password containing `%` raises `ValueError` with the whole URL in the message. Found while building `INFRA-003`, which fixes it for its own path (`app.migrate._escape_for_configparser`); `env.py` was outside that task's allowed paths and is unchanged. Inside the migration handler this is a crash and **not** a leak, because `env.py` is imported within `alembic.command.upgrade` and therefore inside the handler's redaction. Outside it — `docker compose exec backend-dev alembic upgrade head`, and the `dev` stage's `CMD` — there is no redaction, so a `%` password would put a plaintext credential in the container log. The RDS-generated password currently excludes `%` (`GenerateSecretString.ExcludeCharacters`), so this is latent rather than live; a hand-rotated password is not bound by that.
- ~~**The account's Lambda concurrency limit is the new-account default of 10.**~~ — **closed 2026-09-30**: AWS approved a raise to **1000**. The app no longer shares 10 concurrent executions across the API function, four consumers and the authorizer, so the throttling ceiling is gone. Re-check with `aws lambda get-account-settings` before trusting this line.
  - While it was 10 it also made `reservedConcurrentExecutions` unusable anywhere in the account — AWS caps a reservation at the limit minus 100 (the mandatory unreserved floor), so `10 - 100` is negative and no function could reserve anything. That is what rolled the first deploy back.
  - **The raise does not bring the reservation back, deliberately.** At 1000 a reservation is now *possible*, but the second reason for removing it is unaffected by any quota: it couples the template to an account-level limit, so the same stack would be undeployable in a fresh sandbox, a new region, or a reviewer's own account that still has the default. And it was always the weaker guarantee — it constrained only that one Lambda, while `alembic upgrade head` also runs from the `dev` image's `CMD` and from any shell holding a `DATABASE_URL`. The advisory lock in `app.migrate` binds every caller and needs no quota. `infra/test/app-stack.test.ts` asserts the reservation absent so re-adding one fails the build.

### First deploy, 2026-09-29 — what actually happened
Recorded because it is the only evidence that any of the above is real, and because the failure is a class, not an incident.

Six of eight stacks reached `CREATE_COMPLETE` on the first attempt: `Fanwire-Network`, `Data`, `Auth`, `Storage`, `Messaging` in `ca-central-1` and `Fanwire-Edge` in `us-east-1`. `Fanwire-App` went to `ROLLBACK_COMPLETE` and `Fanwire-Cdn` was never attempted.

The single failing resource was the `Migration` function, on `reservedConcurrentExecutions: 1`:

```
CREATE_FAILED AWS::Lambda::Function Migration
"Resource of type 'AWS::Lambda::Function' with identifier 'MigrationC13A4580'
 is not updatable with parameters provided." (HandlerErrorCode: NotUpdatable)
```

Everything else in the stack reported `Resource creation cancelled` — CloudFormation aborting siblings, not independent failures. Note what the message does *not* say: it names neither concurrency nor a quota, and `NotUpdatable` on a `CREATE` is actively misleading. The diagnosis came from `get-account-settings`, not from the error.

**Resolved on the second attempt.** With the reservation removed and the guarantee moved into a Postgres advisory lock, all eight stacks reached `CREATE_COMPLETE`. `Fanwire-Cdn` took 268s; the whole run 645s — well under the 30–45 minutes estimated above, because six stacks were already up and skipped in 0s.

What the deploy **empirically proved**, as distinct from what synth asserted:

| Verified | By |
|---|---|
| ACM certificate, Route 53 aliases, OAC, the SPA-fallback function | `https://fanwire.daviddems.com` resolving and serving over TLS from the distribution |
| CloudFront `/api/*` → prefix-strip function → origin-verify authorizer → API Gateway → Mangum → FastAPI | `GET /api/health` returning `{"status":"ok"}` |
| The `Migration` function, its VPC route to RDS, the advisory lock, and every migration | invoking it once: `{"revision": "f4a1c9d2b6e7"}`, matching the head in `alembic/versions` |

Careful with that middle row: `app.main.health_check` returns a static dict and touches no database, so a green `/api/health` proves the request path and **not** the schema. The migration's returned revision is what proves the schema, and it is separate evidence. A route that actually reads a table is what would prove both at once.

**An empty frontend bucket serves `403 AccessDenied`, not `404`.** Between Phase 1 and Phase 3 the site returns:

```xml
<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>
```

That is correct and expected, and it is worth writing down because it reads like a broken deploy. The OAC bucket policy grants `s3:GetObject` and deliberately **not** `s3:ListBucket`, so S3 will not confirm whether a missing key exists and answers 403 rather than 404. Reaching that XML at all means DNS, TLS, the certificate and OAC are all working — the only thing missing is an object. It disappears when Phase 3 uploads `dist/`.

**Operator trap, cost one wasted deploy.** The second attempt was first run against the *wrong branch*: `git switch <branch>` fails when that branch is already checked out in another worktree, and PowerShell's `;` does not stop on error, so `npm ci` and `cdk deploy` ran on unfixed `main` and reproduced the original failure exactly. This repo uses worktrees heavily, so verify the branch and the synthesized property before a deploy rather than trusting a chained command to have switched.

**The lesson, which generalizes past this bug:** 164 infra tests and a green `cdk synth` prove the template is *well-formed*, not that the account will *accept* it. A synth-only gate cannot see account quotas, service limits or regional availability, so every acceptance criterion naming a concrete numeric AWS property carries this risk. The same blind spot exists one level down in the test suite: mutation-testing the replacement advisory lock with one that acquires nothing left all 11 *mocked* tests green, and only the `testcontainers` test caught it.

### Phase 3, 2026-09-30 — the SPA is live, and egress never worked

`frontend/dist` was built in Docker against the stack outputs and deployed with `cdk deploy Fanwire-Cdn --exclusively -c deployFrontend=true` (98 s). The site serves, and Cognito sign-up, verification and login all work against the production pool. `VITE_MEDIA_BASE_URL` is the site origin (`https://fanwire.daviddems.com`), **not** `/media`: public keys already start with `media/`, and `/media/*` forwards the path unchanged, so a `/media` base produces `/media/media/…`.

Every authenticated route then returned 500: `urllib.error.URLError: [Errno 99] Cannot assign requested address` from `app.users.jwks`. Python reports the *last* address it tried, and a VPC Lambda has no IPv6, so Errno 99 means the IPv4 attempt had already failed. The NAT instance's console log showed why: `yum install iptables-services` was `Killed`, and every iptables line after it was `command not found`. Phases 1 and 2 could not see this, since the migration and `/api/health` never leave the VPC. It is the same lesson as the reservation: a synth-only gate cannot see what happens at boot, and the first route that actually needs egress is the one that proves it.

### Post-deploy checks, 2026-09-30

Each item from the post-deploy checklist was checked by the observable that would fail if it were not done, not by a status read alone (`wiki/GeneralContext/Prompts/05-post-deploy.md`).

| Item | Observable | Result |
|---|---|---|
| GuardDuty Malware Protection | an image attached to a post through the live site, then rendered in the feed | ✅ Plan `e0d078028fa35d2cdba2` is `ACTIVE` on the quarantine bucket's `uploads/` prefix, and the whole chain ran: upload → scan + tag → default-bus rule → media queue → media Lambda → public bucket → CloudFront. The scan-result event shape matched what `app.media.lambda_handler` reads, and the tag-conditioned bucket-policy deny did not block the pipeline — both had been flagged as unverifiable before a deploy. |
| ACM certificate and aliases | `https://fanwire.daviddems.com` serving the SPA over TLS | ✅ (Phase 3) |
| SES | `GetEmailIdentity fanwire.daviddems.com`, then a real follow | ❌ **No identity exists**, and the account is sandboxed (`ProductionAccessEnabled: false`). Worse than a no-op: `NOTIFICATION_FROM_ADDRESS` *is* set whenever a domain is configured, so every send raised, the notifications consumer failed the SQS record after committing the row, and each redelivery committed another. One follow produced two identical notifications 2 min 56 s apart — the queue's 180 s visibility timeout. Fixed in two PRs: email failure no longer fails the record, and the identity is created in CDK with its DKIM records. Production access remains a human request. |
| Deployed IAM = gated IAM | CloudFormation drift detection on all eight stacks | ✅ Seven stacks `IN_SYNC`. `Fanwire-App` reported `DRIFTED` on exactly one property, and it is benign: `DefaultStage`'s `AccessLogSettings.DestinationArn`. CDK writes the log group's ARN with CloudWatch Logs' trailing `:*`, and API Gateway stores it without, so both name the same group — a normalization, not a hand change, and redeploying does not clear it. No role, policy, bucket policy or key policy drifted. Drift detection compares those with the very template `iam-policy.test.ts` gated, so this is the proof that the gate's verdict describes what runs. Re-run it after each deploy, and expect this one stage diff. |
| `lambda-vpc-eni` | each function's live `VpcConfig` vs what its code touches | ✅ Reviewed — see the waiver entry above. |

Also observed: composing with media takes two clicks — upload, wait for the scan, then *Attach* — which works but is clumsy. A UX follow-up, not a defect.

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
- **Permissions policy attached 2026-09-22** (`CdkBootstrapAssumeRole`), after the human IAM review. It grants exactly one action — `sts:AssumeRole` — on the eight CDK bootstrap roles (four per region, `ca-central-1` and `us-east-1`). CI holds **no service permissions at all**; it can only step into the roles `cdk bootstrap` created. The policy is committed at `infra/iam/github-actions-deploy-role-policy.json` so it is reviewable as a diff rather than as console JSON.
- The alternative — enumerating every service the stacks touch — was rejected deliberately: that policy is hundreds of actions wide, changes with every stack change, and is too large to actually read, which is the failure the IAM gate exists to prevent.
- **Nothing assumes this role yet.** No workflow references it, and `cdk deploy` remains out of scope repo-wide. It exists so a later, separately-reviewed deploy workflow has something correct to assume.

**DNS (Route 53)** — the domain is live as of 2026-09-22.
- Registrar: **GoDaddy**, domain `daviddems.com`. The apex and its nameservers stay there.
- Hosted zone `Z04139742PYZYKIOGHWGR` in `fanwire-workload` for the **subdomain** `fanwire.daviddems.com` only. Four NS records at the registrar delegate that label to Route 53; nothing else on `daviddems.com` is affected. Verified resolving from a public resolver.
- Chosen over moving the whole domain because the blast radius is one label rather than all DNS for the domain, and undoing it is "delete four NS records". The trade-off accepted: DNS is administered in two places, and any other subdomain stays manual at the registrar.
- `infra/cdk.json` names the zone (`domainName`, `hostedZoneId`, `hostedZoneName`), which puts the app in its intended **"domain + zone"** mode — ACM validates against the zone automatically instead of waiting for a hand-added CNAME.
- The earlier default `fanwire.daviddems.ca` is gone; that domain lapsed and was taken by its old registrar.

**CDK bootstrap** — both regions, 2026-09-22, default qualifier `hnb659fds`.
- `CDKToolkit` in `ca-central-1` and `us-east-1` (the second because CloudFront's cert must live there). Ten `cdk-hnb659fds-*` roles exist.
- ⚠️ **`cdk-hnb659fds-cfn-exec-role-*` holds `AdministratorAccess`**, the bootstrap default, and this is the real privilege in the deployment design. It is **not** what `infra/test/iam-policy.test.ts` inspects — that walks this app's stacks, not the bootstrap stack. It is defensible (only CloudFormation can use it, CI reaches it only via the deploy role, and the OIDC trust limits that to `main` of this repo) but it is admin, and it was accepted knowingly rather than discovered. Narrowing it is `wiki/GeneralContext/Prompts/07-deploy-role-scoping.md`, which holds the service inventory taken from the synthesized templates on 2026-09-30.

**CloudTrail**
- Trail `fanwire-workload-trail` in `fanwire-workload`: multi-region, log file validation on, management events (read + write) only.
- Delivers to S3 bucket `fanwire-cloudtrail-801132668027-ca-central-1-an` in `fanwire-log-archive`: Object Lock on (Governance mode, 90-day default retention), all public access blocked.

**GuardDuty**
- Delegated administrator: `fanwire-log-archive` (`801132668027`); Organizations trusted access enabled; auto-enable for new Organizations accounts on.
- `fanwire-workload` and the management account added as member accounts, by invitation.
- **Confirmed Enabled 2026-09-22**, checked from inside `fanwire-workload` itself. The delegated-admin account list reads empty from `fanwire-log-archive` because listing Organizations members needs permissions `PowerUserAccess` deliberately excludes — that exclusion is the point of that permission set, not a misconfiguration.
- Two consequences: membership is **by invitation**, so a future fourth account will not self-enroll; and **Malware Protection for S3 is a separate feature** from GuardDuty core. The latter is what `media/` actually depends on — an upload never leaves `Quarantined` without a scan verdict — and it can only be enabled against a bucket that exists, so it belongs to the first deploy. **Done by CDK, not by hand:** `Fanwire-Storage` creates the plan, and it was verified working end to end on 2026-09-30 (plan `e0d078028fa35d2cdba2`, `ACTIVE`; see "Post-deploy checks" above).

**AWS Config** — enabled in `fanwire-workload` only (not `log-archive` or management).
- Recording strategy: all resource types, no overrides — global IAM resource types included, recorded in `ca-central-1`.
- Recording mode: continuous.
- Delivery bucket: `fanwire-config-294321867941` in `fanwire-workload`.
- IAM role: AWS Config service-linked role (default).
- No Config Rules defined yet — recorder only, no compliance evaluation running.

**AWS Budgets** — one cost budget on the management account (rolls up the full consolidated org bill once member accounts have spend): $20/month, alerts at 80% and 100% of actual, emailed to `daviddemers92@gmail.com`. No automated actions configured.

**Outstanding**
- `cdk-hnb659fds-cfn-exec-role-*` still holds `AdministratorAccess` (above) — `07-deploy-role-scoping.md`.
- GuardDuty member-account propagation not yet reverified.
- No AWS Config Rules defined.
- No alerting: GuardDuty findings and DLQ depth are both checked by hand (`wiki/GeneralContext/Architecture/incident-runbook.md`, revisited 2026-09-30 with the deployed resources named, "Known gaps").
- Security Hub not enabled (optional at this budget, per [[wiki/CodeContext/Standards/security|Security]]).
