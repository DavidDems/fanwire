---
type: runbook
---

# Incident Runbook: response

Part of the [Incident Runbook](incident-runbook.md). Every command is one line
of PowerShell with the `fanwire-workload` profile.

## Trigger

Act on GuardDuty findings of **Medium or High** severity only. Low-severity findings are informational/noisy
by design in GuardDuty and are not actioned under this runbook (revisit this threshold once real traffic
exists and a baseline of "normal" Low findings is established).

Detection of GuardDuty findings is **manual**: findings are only seen by periodically checking the
GuardDuty console in `fanwire-log-archive` (delegated admin). The CloudWatch alarms
([Inventory](incident-runbook-inventory.md), "Alarms") email on operational failures, not on findings. A
push notification for findings (EventBridge → SNS → email) is not built.

**A malware verdict on an upload is not an incident.** GuardDuty Malware Protection returning
`THREATS_FOUND` for a quarantine object is the media pipeline working: `app.media.lambda_handler` moves that
`Media` row to `Rejected` and deletes the object without reading it, and the quarantine bucket policy denies
`GetObject` on anything not tagged `NO_THREATS_FOUND`. Act only if the same account uploads repeatedly, or if
something other than GuardDuty's role read an untagged object — and that second case is undetectable,
because CloudTrail records no S3 data events ([Inventory](incident-runbook-inventory.md), "Known gaps").

## Priority order of suspicion

1. **Your own SSO session** (`AdministratorAccess` permission set in `fanwire-workload`). Routine deploys
   don't use it: they run through `.github/workflows/deploy.yml` as `GitHubActionsDeployRole`, which can
   only assume the CDK bootstrap roles. But it is the credential a human uses for anything by hand, and it
   is admin. Anything it can do, an attacker holding it can. (`cdk-hnb659fds-cfn-exec-role-*` is not
   admin: it holds the scoped `FanwireCdkCfnExecPolicy`.)
2. **`cdk-hnb659fds-cfn-exec-role-*`** (both regions). Only CloudFormation can assume it, so a finding on it
   means a stack operation did something unexpected — find which stack, and who started the operation.
3. **The application roles in `Fanwire-App`** — one per function: `ApiRole`, `MediaRole`,
   `NotificationsRole`, `AccountDeletionRole`, `MigrationRole`, `SportsDataLoadRole`, and the
   origin-verify authorizer's `OriginVerifyRole`. These run internet-facing code. The API role is the most
   exposed: it serves every request, presigns quarantine uploads and calls `PutEvents` on `PostEventBus`.
4. **`GitHubActionsDeployRole`.** Holds only `sts:AssumeRole` on the CDK bootstrap roles. Only a job in this
   repository's `production` environment can assume it (`infra/iam/github-actions-deploy-role-trust-policy.json`),
   and `deploy.yml` is the workflow that does. A use that does not match a `deploy.yml` run is suspicious.
5. **The NAT instance role** (`Fanwire-Network`, Session Manager only) and service roles (GuardDuty's
   `MalwareProtectionRole` in `Fanwire-Storage`, `Fanwire-Auth`'s `PreSignUpRole`, Config). Lowest
   priority; narrowly scoped by definition.

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

**Find a resource's physical name** from the logical ids this runbook uses:

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
- `ApiSportsKey` — the retired API-SPORTS key, which no function reads
  (`wiki/CodeContext/Standards/aws-stack.md`). If it leaks, revoke it at api-sports.io.
- The RDS master secret. **Rotating it breaks every function**: `DATABASE_URL` is assembled from it at deploy
  time (a known gap in `wiki/CodeContext/Modules/0x00b-architecture-iam-gaps.md`), so redeploy `Fanwire-App` right after.

**F. A compromised deploy credential** (priority 1–2). Sign out the SSO session in IAM Identity Center
(management account → Identity Center → Users → your user → *Active sessions*). Then check CloudTrail for
`cloudformation:*`, `iam:*` and `sts:AssumeRole` by that principal: a deploy credential's damage is whatever
it created, and a new role or a widened trust policy outlives the session.
