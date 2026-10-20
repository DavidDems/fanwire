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

Detection of GuardDuty findings is still **manual**: findings are only seen by periodically checking the
GuardDuty console in `fanwire-log-archive` (delegated admin). The CloudWatch alarms (Alarms, below) email
on operational failures, not on findings. A push notification for findings (EventBridge → SNS → email) is a
planned follow-up, not yet built.

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

## Roll back a deploy

`deploy.yml` ends with **Smoke check the live site**: `/api/health`, `/api/feed?limit=1` (the first that
reaches the database) and the SPA root, through `https://fanwire.daviddems.com`, retried for about two
minutes. A red smoke check means the stacks deployed and the site does not answer as it should.

1. **Rule out the migration first.** If the commit adds an Alembic revision, the new code may be waiting for
   its schema. Invoke the Migration function (`build-deployment.md` → "Automated deploy"), then re-run the
   failed run's job from its page. If it goes green, it was never a bad deploy.
2. **Otherwise, re-run the last good deploy.** A `workflow_dispatch` can't target an old commit. The
   `production` environment admits `main` only, so a dispatch either deploys `main`'s head again or is refused.
   Re-running an earlier *run* keeps that run's commit and its `main` ref, which the environment admits. List
   the recent green runs, then re-run the newest one older than the bad merge. It waits for the environment's
   reviewer like any deploy.

   ```powershell
   gh run list --workflow deploy.yml --status success --limit 5 --json databaseId,headSha,createdAt,displayTitle
   ```
   ```powershell
   gh run rerun PASTE_RUN_ID
   ```
3. **Revert on `main` straight away.** The next merge deploys `main`'s head, bad commit included. Open a PR that
   reverts the bad merge (`git revert -m 1 PASTE_MERGE_SHA` on a new branch) and merge it.

**What a rollback does not undo:** a migration that already ran. Alembic revisions are not reversed by an old
image, so the old code runs against the new schema. That is safe for an additive revision (a new table,
column or index), which is the only kind this repo writes. GitHub keeps a run re-runnable for 30 days; past
that, the revert in step 3 is the only way back.

## Restore the database

RDS keeps 7 days of automated backups (`Fanwire-Data`, `backupRetention`). A backup nobody has restored
proves nothing, so this is a drill: restore the latest point to a **temporary** instance, count rows, delete
it. Production is never touched. The restored instance is the same `db.t4g.micro`, encrypted with the same
CMK, in the same data subnets.

**Cost: one `db.t4g.micro` and 20 GiB of gp3 for about an hour, a few US cents.** Delete it when you're
done: a forgotten one costs about USD $15 a month.

**Rehearsed: never yet.** After the drill, fill in this table:

| Date | Restore point | Restore started → available | Time to restore | Rows (users / posts / games) | Head revision |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

The database is in data subnets with no route out, and its security group admits the Lambda SG only. The
drill reaches the copy through a Session Manager port forward on the NAT instance. The copy gets its own
temporary security group, so production's database stays closed throughout. The NAT security group gets a
temporary egress rule. That is drift on `Fanwire-Network` until step 13 removes it.

Every command below is one line of PowerShell in **one** window, except the port forward, which blocks and
gets a second. Run them in order. Steps 1–3 only read.

1. `aws sso login --profile fanwire-workload`, then check the plugin the port forward needs:
   `session-manager-plugin --version` (install it from AWS's docs if that fails).
2. The source instance, its subnet group and the latest restorable time:
   ```powershell
   aws rds describe-db-instances --region ca-central-1 --profile fanwire-workload --query "DBInstances[].{id:DBInstanceIdentifier,subnets:DBSubnetGroup.DBSubnetGroupName,latest:LatestRestorableTime}" --output table
   ```
3. The NAT instance and its security group:
   ```powershell
   aws ec2 describe-instances --region ca-central-1 --profile fanwire-workload --filters "Name=tag:aws:cloudformation:stack-name,Values=Fanwire-Network" "Name=instance-state-name,Values=running" --query "Reservations[].Instances[].{id:InstanceId,sg:SecurityGroups[0].GroupId}" --output table
   ```
4. A temporary security group for the copy. `$sg` holds its id for the steps below:
   ```powershell
   $sg = aws ec2 create-security-group --region ca-central-1 --profile fanwire-workload --vpc-id vpc-0259c7c65d0a58371 --group-name fanwire-restore-drill --description "Temporary: database restore drill. Delete after." --query GroupId --output text; $sg
   ```
5. Let the NAT instance in (on the temporary group only):
   ```powershell
   aws ec2 authorize-security-group-ingress --region ca-central-1 --profile fanwire-workload --group-id $sg --protocol tcp --port 5432 --source-group PASTE_NAT_SG
   ```
6. Let the NAT instance out to it:
   ```powershell
   aws ec2 authorize-security-group-egress --region ca-central-1 --profile fanwire-workload --group-id PASTE_NAT_SG --ip-permissions "IpProtocol=tcp,FromPort=5432,ToPort=5432,UserIdGroupPairs=[{GroupId=$sg}]"
   ```
7. **Start the clock and restore.** Note the time this prints:
   ```powershell
   Get-Date -Format o; aws rds restore-db-instance-to-point-in-time --region ca-central-1 --profile fanwire-workload --source-db-instance-identifier PASTE_SOURCE_ID --target-db-instance-identifier fanwire-restore-drill --use-latest-restorable-time --db-instance-class db.t4g.micro --db-subnet-group-name PASTE_SUBNET_GROUP --vpc-security-group-ids $sg --no-multi-az --no-publicly-accessible --no-deletion-protection --query "DBInstance.DBInstanceStatus" --output text
   ```
8. **Wait, and stop the clock.** The waiter gives up after 30 minutes. If it prints `Max attempts exceeded`,
   run the line again. The second time it prints is the end of the restore:
   ```powershell
   aws rds wait db-instance-available --region ca-central-1 --profile fanwire-workload --db-instance-identifier fanwire-restore-drill; Get-Date -Format o
   ```
9. The copy's endpoint:
   ```powershell
   aws rds describe-db-instances --region ca-central-1 --profile fanwire-workload --db-instance-identifier fanwire-restore-drill --query "DBInstances[0].Endpoint.Address" --output text
   ```
10. **In a second window**, forward local port 15432 to the copy. Leave it running:
    ```powershell
    aws ssm start-session --region ca-central-1 --profile fanwire-workload --target PASTE_NAT_INSTANCE_ID --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters "host=PASTE_ENDPOINT,portNumber=5432,localPortNumber=15432"
    ```
11. Back in the first window, put the master password in this window's environment without printing it. The
    secret is `Fanwire-Data`'s `FanwireDataPostgresSecret…`. The restored copy has the same password as production:
    ```powershell
    $env:PGPASSWORD = (aws secretsmanager get-secret-value --region ca-central-1 --profile fanwire-workload --secret-id (aws cloudformation describe-stack-resources --region ca-central-1 --profile fanwire-workload --stack-name Fanwire-Data --query "StackResources[?ResourceType=='AWS::SecretsManager::Secret' && contains(LogicalResourceId, 'PostgresSecret')].PhysicalResourceId | [0]" --output text) --query SecretString --output text | ConvertFrom-Json).password
    ```
12. **Count rows** with the Postgres client in Docker (no local install needed). Non-zero counts and a head
    revision equal to the newest file in `backend/alembic/versions/` mean the restore holds real data:
    ```powershell
    docker run --rm -e PGPASSWORD postgres:16 psql -h host.docker.internal -p 15432 -U fanwire_admin -d fanwire -c "select (select count(*) from users) as users, (select count(*) from posts) as posts, (select count(*) from games) as games, (select version_num from alembic_version) as head;"
    ```
13. **Clean up, in this order.** Stop the port forward with Ctrl+C in the second window. Then forget the password,
    delete the copy (the identifier is the copy's, never the source's; production also has deletion
    protection), wait for it to go, and remove both network changes:
    ```powershell
    Remove-Item Env:PGPASSWORD
    ```
    ```powershell
    aws rds delete-db-instance --region ca-central-1 --profile fanwire-workload --db-instance-identifier fanwire-restore-drill --skip-final-snapshot --delete-automated-backups
    ```
    ```powershell
    aws rds wait db-instance-deleted --region ca-central-1 --profile fanwire-workload --db-instance-identifier fanwire-restore-drill
    ```
    ```powershell
    aws ec2 revoke-security-group-egress --region ca-central-1 --profile fanwire-workload --group-id PASTE_NAT_SG --ip-permissions "IpProtocol=tcp,FromPort=5432,ToPort=5432,UserIdGroupPairs=[{GroupId=$sg}]"
    ```
    ```powershell
    aws ec2 delete-security-group --region ca-central-1 --profile fanwire-workload --group-id $sg
    ```
14. **Check nothing is left.** The first command should list the production instance only, and the second should list nothing:
    ```powershell
    aws rds describe-db-instances --region ca-central-1 --profile fanwire-workload --query "DBInstances[].DBInstanceIdentifier" --output text
    ```
    ```powershell
    aws ec2 describe-security-groups --region ca-central-1 --profile fanwire-workload --filters "Name=group-name,Values=fanwire-restore-drill" --query "SecurityGroups[].GroupId" --output text
    ```
15. Fill in the table above: the date, the restore point (step 2's `latest`), the two times from steps 7 and 8
    and the difference between them, the counts and the head revision from step 12.

**If the port forward fails** (`TargetNotConnected`, or the session opens and psql times out): the NAT
instance's SSM agent must be online (`aws ssm describe-instance-information --region ca-central-1 --profile fanwire-workload --output table`), and steps 5 and 6 must both be in place. You can skip the row count and still record the
time-to-restore. That is the number this drill is mainly for. Clean up as in step 13 either way.

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
| Alarm topic | `Fanwire-Messaging` | `AlarmTopic`; ARN in `Fanwire-App`'s `AlarmTopicArn` output |

## Alarms

Since `INFRA-004` (#182, deployed 2026-10-20), 21 CloudWatch alarms send ALARM and OK to one SNS
topic. The topic's ARN is `Fanwire-App`'s `AlarmTopicArn` output. The human subscribed an email by hand
on 2026-10-20 and proved it with `set-alarm-state`. The address is never committed. Thresholds and
reasons: `wiki/CodeContext/Modules/0x00-architecture.md` "Alarms". An alarm emails on a change of
state, not every period, so one email can stand for a long outage. An OK email means it recovered.

| Alarm | First look |
|---|---|
| A DLQ depth > 0 (Messaging) | Read the message without deleting it: `aws sqs receive-message --profile fanwire-workload --region ca-central-1 --queue-url (aws sqs get-queue-url --profile fanwire-workload --region ca-central-1 --queue-name PASTE_DLQ_NAME --query QueueUrl --output text) --visibility-timeout 0`. Then read the consumer's log group for the error. |
| API 5xx, or p95/p99 latency | The `Api` function's log group, then RDS. A deploy just before it means "Roll back a deploy", above. |
| A function's Errors or Throttles | That function's log group (`aws logs tail /aws/lambda/PASTE_FUNCTION_NAME --profile fanwire-workload --region ca-central-1 --since 30m`). Throttles at this volume mean a concurrency limit, not load. |
| RDS CPU, free storage or connections | RDS console → `Fanwire-Data` `Postgres` → Monitoring. Free storage below 2 GiB means growing the allocated storage is a reviewed CDK change. |

## Known gaps

- **GuardDuty findings raise no alarm.** They are still checked by hand (Trigger, above). Routing them to
  the alarm topic means an EventBridge rule on GuardDuty findings in the delegated-admin account, which is
  not built.
- **No S3 data events in CloudTrail** (management events only), so object-level reads and writes are not
  recorded. Cheap at this volume; not enabled.
- Security Hub — optional at this budget per `wiki/CodeContext/Standards/security.md`, not part of this runbook.
