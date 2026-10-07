# Incident Runbook

**Status: revisited 2026-09-30, after all eight stacks were deployed.** The
first version was written pre-CDK and was deliberately generic. This one
names the real credentials, entry points and data stores, and gives a concrete
containment sequence for each. Physical resource names are CloudFormation-
generated and change if a resource is replaced, so every step names the
**stack and logical id** and gives the lookup command. The physical names in
the inventory at the bottom were correct on 2026-09-30.

Every command is a single line of PowerShell (`TODO/README.md`), run with the
`fanwire-workload` SSO profile after `aws sso login --profile fanwire-workload`.

## Trigger

Act on GuardDuty findings of **Medium or High** severity only. Low-severity findings are informational/noisy
by design in GuardDuty and are not actioned under this runbook (revisit this threshold once real traffic
exists and a baseline of "normal" Low findings is established).

Detection is still **manual**: no SNS/EventBridge alerting is wired up, so findings are only seen by
periodically checking the GuardDuty console in `fanwire-log-archive` (delegated admin). A push notification
(EventBridge → SNS → email) is a planned follow-up, not yet built.

**A malware verdict on an upload is not an incident.** GuardDuty Malware Protection returning
`THREATS_FOUND` for a quarantine object is the media pipeline working: `app.media.lambda_handler` moves that
`Media` row to `Rejected` and deletes the object without reading it, and the quarantine bucket policy denies
`GetObject` on anything not tagged `NO_THREATS_FOUND`. Act only if the same account uploads repeatedly, or if
something other than GuardDuty's role read an untagged object — and that second case is currently
undetectable, because CloudTrail records no S3 data events (Known gaps, below).

## Priority order of suspicion

1. **Your own SSO session** (`AdministratorAccess` permission set in `fanwire-workload`). Routine deploys
   no longer use it: since 2026-10-05 they run through `.github/workflows/deploy.yml` as
   `GitHubActionsDeployRole`, which can only assume the CDK bootstrap roles. But it is still the
   credential a human uses for anything by hand, and it is admin. Anything it can do, an attacker
   holding it can. (`cdk-hnb659fds-cfn-exec-role-*` is no longer admin: it holds the scoped
   `FanwireCdkCfnExecPolicy` since 2026-10-02.)
2. **`cdk-hnb659fds-cfn-exec-role-*`** (both regions). Only CloudFormation can assume it, so a finding on it
   means a stack operation did something unexpected — find which stack, and who started the operation.
3. **The application roles in `Fanwire-App`** — one per function: `ApiRole`, `IngestionRole`, `MediaRole`,
   `NotificationsRole`, `MigrationRole`, and the origin-verify authorizer's. These run internet-facing code.
   The API role is the most exposed: it serves every request, presigns quarantine uploads and calls
   `PutEvents` on `PostEventBus`.
4. **`GitHubActionsDeployRole`.** Holds only `sts:AssumeRole` on the CDK bootstrap roles, trusts only `main`
   of `DavidDems/fanwire`, and **no workflow assumes it**. Any use of it at all is suspicious.
5. **The NAT instance role** (`Fanwire-Network`, Session Manager only) and service roles (GuardDuty's
   `MalwareProtectionRole` in `Fanwire-Storage`, Config, the ingestion scheduler's). Lowest priority;
   narrowly scoped by definition.

## Response steps

1. **Note the finding.** Record the GuardDuty finding ID, affected account, resource and timestamp before
   touching anything. CloudTrail in the Object-Locked `log-archive` bucket is already durable; the finding
   record and the resource's live state are not.
2. **Do not delete the flagged resource and do not disable CloudTrail.** Preserve evidence first.
3. **Contain the narrowest thing that stops the harm** — the sequences below, most targeted first.
4. **Check CloudTrail** (in `log-archive`, or `aws cloudtrail lookup-events` in `fanwire-workload` for the
   last 90 days of management events) for what the credential did around the finding, scoped to its ARN.
5. **Rotate what it could plausibly have reached**, based on what CloudTrail shows — not everything.
6. **Write a short post-incident note** in the repo: what fired, real or false positive, what changed.

## Containment sequences

Each step is reversible and says how. **Every manual change below is CloudFormation drift**: the next
`cdk deploy` of that stack silently undoes it. After an incident, either freeze deploys until the fix is in
CDK, or put the fix in CDK first. `aws cloudformation detect-stack-drift` shows what is still hand-changed.

**Find a resource's physical name** from the logical ids this file uses:

```powershell
aws cloudformation describe-stack-resources --stack-name Fanwire-App --region ca-central-1 --profile fanwire-workload --query "StackResources[].{id:LogicalResourceId,physical:PhysicalResourceId}" --output table
```

**A. Stop one function** (compromised or runaway). Reserved concurrency 0 rejects every invocation;
SQS-triggered functions leave their messages on the queue, so nothing is lost. Undo with
`aws lambda delete-function-concurrency`.

```powershell
aws lambda put-function-concurrency --function-name PASTE_FUNCTION_NAME --reserved-concurrent-executions 0 --region ca-central-1 --profile fanwire-workload
```

**B. Take the API offline** (everything under `/api/*`; the SPA itself keeps serving). Throttles the HTTP
API's `$default` stage to zero, so every call gets `429`. Undo by redeploying `Fanwire-App`, which restores
the stage's 50/100 limits.

```powershell
aws apigatewayv2 update-stage --api-id PASTE_API_ID --stage-name '$default' --default-route-settings ThrottlingBurstLimit=0,ThrottlingRateLimit=0 --region ca-central-1 --profile fanwire-workload
```

**C. Revoke a role's live sessions.** IAM console → Roles → the role → *Revoke sessions* → *Revoke active
sessions*. It attaches an inline deny on tokens issued before now; new sessions still work, so pair it with
closing whatever leaked the credential. A console step on purpose: the CLI equivalent is a policy document
containing a timestamp, which is not a one-line command.

**D. Lock out an app user.** Signs them out everywhere, then stops them signing back in. Undo with
`admin-enable-user`.

```powershell
aws cognito-idp admin-user-global-sign-out --user-pool-id ca-central-1_eSfPUMRq8 --username PASTE_COGNITO_SUB --region ca-central-1 --profile fanwire-workload
```
```powershell
aws cognito-idp admin-disable-user --user-pool-id ca-central-1_eSfPUMRq8 --username PASTE_COGNITO_SUB --region ca-central-1 --profile fanwire-workload
```

**E. Rotate a secret.** Three exist, all in `Fanwire-Data`:
- `OriginVerify` — the header CloudFront adds so the HTTP API rejects direct calls. CloudFront sends the value
  it was deployed with, so after rotating, redeploy `Fanwire-Cdn`; until then `/api/*` is unreachable.
- `ApiSportsKey` — the API-SPORTS key, ingestion role only. Rotate at api-sports.io, then
  `aws secretsmanager put-secret-value`.
- The RDS master secret. **Rotating it breaks every function**: `DATABASE_URL` is assembled from it at deploy
  time (a known gap in `wiki/CodeContext/Modules/0x00-architecture.md`), so redeploy `Fanwire-App` right after.

**F. A compromised deploy credential** (priority 1–2). Sign out the SSO session in IAM Identity Center
(management account → Identity Center → Users → your user → *Active sessions*). Then check CloudTrail for
`cloudformation:*`, `iam:*` and `sts:AssumeRole` by that principal: a deploy credential's damage is whatever
it created, and a new role or a widened trust policy outlives the session.

## Inventory, as deployed 2026-09-30

| What | Stack | Physical name / id |
|---|---|---|
| Site | `Fanwire-Cdn` | `https://fanwire.daviddems.com`, distribution `E2AXWWXMA8YAE8` (`d3fb0uyhisvzkz.cloudfront.net`) |
| WAF WebACL | `Fanwire-Edge` (us-east-1) | `WebAcl` |
| HTTP API | `Fanwire-App` | `HttpApi`; direct calls are rejected by the origin-verify authorizer |
| User pool | `Fanwire-Auth` | `ca-central-1_eSfPUMRq8`, SPA client `1vskugrl60gggpt0lmib4ka85j` |
| Functions in the VPC | `Fanwire-App` | `Fanwire-App-ApiF70053CD-2Tk08zpbR2SF`, `…-Ingestion47A52C70-k9xWtxsk1mVB`, `…-MediaA721A567-Bdk47xIuDfyN`, `…-Notifications87298708-v54icb6ecRBv`, `…-MigrationC13A4580-HztWrvm4AZrl` |
| Function outside it | `Fanwire-App` | `Fanwire-App-OriginVerifyAuthorizer3033B641-pSfPc8T00z9g` |
| Network | `Fanwire-Network` | `vpc-0259c7c65d0a58371`; app subnets `subnet-0e68161ab23330f65`, `subnet-028cef17a50cc7fbb`; Lambda SG `sg-0c98e281c22be6d0c`; one NAT instance |
| Database | `Fanwire-Data` | `Postgres` (RDS), CMK-encrypted, data subnets only |
| Tables | `Fanwire-Data` | `IdempotencyTable`, `LiveScoreCacheTable` |
| Key | `Fanwire-Data` | `Key` — the one CMK (RDS, S3 media, DynamoDB, SQS, Secrets Manager) |
| Buckets | `Fanwire-Storage` | quarantine `fanwire-storage-quarantinebucketfdbda180-wbd8njkzttkf`; `PublicMediaBucket`; `FrontendBucket` |
| Malware scan | `Fanwire-Storage` | GuardDuty Malware Protection plan `e0d078028fa35d2cdba2`, `ACTIVE` on `uploads/` |
| Queues | `Fanwire-Messaging` | notifications, media scan results, ingestion retry — each with a DLQ (e.g. `Fanwire-Messaging-NotificationDlq467FCAE6-nWWbotTUIAPC`) |
| Event bus | `Fanwire-Messaging` | `PostEventBus` |

## Known gaps

- Automated alerting (SNS/EventBridge) — planned, not built.
- **No S3 data events in CloudTrail** (management events only), so object-level reads and writes are not
  recorded. Cheap at this volume; not enabled.
- **No dead-letter-queue alarm.** A message in any DLQ is invisible until someone checks the depth.
- Security Hub — optional at this budget per `wiki/CodeContext/Standards/security.md`, not part of this runbook.
