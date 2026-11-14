# INFRA-005: delete the API-SPORTS infra

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

`Prompts/06` decision 3 retired API-SPORTS. `EVENTS-003` (fanwire-archive#142, deployed 2026-10-14)
removed every consumer but kept the resources and their exports, because the deployed
App still imported them and a deploy updates Data and Messaging first. App no longer
imports them, so they can go. `Prompts/06` "What's next" item 2 is this unit.

No data is at stake: `EVENTS-003`'s spec says the path never ran against real data, the
live database was loaded from the dataset, and neither table is the system of record
(`aws-stack.md`). Nothing falls back to it. The scheduled refresh, `EVENTS-008`, uses
Kaggle.

## Exactly what is removed

Read from `cdk synth` on `fanwire-archive@4795f19`. Eight resources and seven outputs.

| Stack | Logical id | Type | Deletion policy |
|---|---|---|---|
| `Fanwire-Data` | `IdempotencyTable22A5A209` | `AWS::DynamoDB::Table` | **Retain** |
| `Fanwire-Data` | `ApiSportsKey4432EB4A` | `AWS::SecretsManager::Secret` | **Retain** |
| `Fanwire-Data` | `LiveScoreCacheTable277AE7C2` | `AWS::DynamoDB::Table` | Delete |
| `Fanwire-Messaging` | `IngestionRetryQueueD528F9A2` | `AWS::SQS::Queue` | Delete |
| `Fanwire-Messaging` | `IngestionRetryDlqAD1363B6` | `AWS::SQS::Queue` | Delete |
| `Fanwire-Messaging` | `IngestionRetryQueuePolicy60151471` | `AWS::SQS::QueuePolicy` | default |
| `Fanwire-Messaging` | `IngestionRetryDlqPolicy72728599` | `AWS::SQS::QueuePolicy` | default |
| `Fanwire-Messaging` | `IngestionRetryDlqDepthAlarm7CDD189B` | `AWS::CloudWatch::Alarm` | default |

Outputs, each exported as `<stack>:<output id>`:

- `Fanwire-Data`: `ExportsOutputFnGetAttIdempotencyTable22A5A209Arn796E3A97`,
  `ExportsOutputFnGetAttLiveScoreCacheTable277AE7C2Arn3F1E2DD3`,
  `ExportsOutputRefApiSportsKey4432EB4A2C8D0DDC`,
  `ExportsOutputRefIdempotencyTable22A5A209F6C0179A`,
  `ExportsOutputRefLiveScoreCacheTable277AE7C28479FE72`.
- `Fanwire-Messaging`: `ExportsOutputFnGetAttIngestionRetryQueueD528F9A2Arn07FDF528`,
  `ExportsOutputFnGetAttIngestionRetryDlqAD1363B6Arn3F8A5660`.

Code that goes with them: the three properties and five `exportValue` calls in
`data-stack.ts`, the `dynamodb` import if nothing else needs it, the two properties,
two `exportValue` calls and `CONSUMER_TIMEOUTS.ingestion` in `messaging-stack.ts`.
`app-stack.ts` and `network-stack.ts` change in comments only, so check their templates
did not move. `queueWithDlq` keeps its signature: two callers remain.

## What was checked to still read them

On `fanwire-archive@4795f19`, and to repeat before the PR, since it can change:

- **Templates:** no resource elsewhere refers to these, and no `Fn::ImportValue` names
  them in any stack.
- **Lambda code, env vars:** `backend/app` has no DynamoDB client and no
  `IDEMPOTENCY_`, `LIVE_SCORE` or `API_SPORTS` setting. `backend/tests/events/test_api_sports_retired.py`
  guards that and stays.
- **IAM and schedules:** no statement or event source mapping names them.
  `app-stack.test.ts` has sweeps saying so; keep them.
- **`infra/test/cfn-exec-policy.test.ts`:** one-way. It requires what templates use to
  be granted and does not fail on a grant no template uses, so removing the last
  DynamoDB resource does not fail it. Leave `TYPE_TO_IAM`'s `DynamoDB` entry.
- **`infra/iam/`:** no change, so no policy rollout blocks the deploy. `deploy.yml`
  compares the live versions with these files. **Do not drop `dynamodb:*` here:**
  CloudFormation needs it to delete the live-score table during this very deploy.
- **Tests to invert:** `data-stack.test.ts` (the DynamoDB block, "three CMK-encrypted
  secrets", the block keeping the exports), `messaging-stack.test.ts` (the three-purpose
  loop and the block keeping the exports), `alarms.test.ts` (count 21 to 20, and any DLQ
  list). `app-stack.test.ts`'s header comment says they stay, so correct it.

## The export trap, one last time

The deploy updates Data and Messaging before App, and CloudFormation refuses to delete
an export still imported. App's live template should import none of these seven since
`EVENTS-003` deployed, but a synth cannot prove what is live. So the human runs
`list-imports` on all seven before approving. Each must answer that the export is not
imported.

## RETAIN: what the PR must hand the human

Retained resources stay in the account with **no link left to the stack**, so
`describe-stack-resource` stops answering for them once the deploy has run. Capture the
physical ids first. All of it goes in the PR as an ordered list of single-line
PowerShell commands, region `ca-central-1`, using
`aws cloudformation describe-stack-resource --stack-name Fanwire-Data --logical-resource-id <id>`,
then `aws dynamodb delete-table` and `aws secretsmanager delete-secret`. Secrets Manager
keeps a deleted secret for its recovery window by default, which is fine here. If a real
key was ever stored, the human may also revoke it at api-sports.io; that is theirs, not
this unit's. Nothing in the unit runs `aws`.

## Before/after diff

From `infra/`, `npm run synth` on the base commit and on the branch, each into its own
output folder, then diff `cdk.out/*.template.json` per stack. Do not use `cdk diff`: it
needs AWS credentials and compares against the live stack. Eight stacks: expected
identical are Network, Auth, Storage, Edge, Cdn and App.

Do not reword the CMK's `description`, though it still says DynamoDB: it is a key update
for no gain, and the retained table stays encrypted by that key until the human deletes
it. The `Fanwire-Data` stack description in `app.ts` may lose "DynamoDB tables", since a
description changes no resource.

## Traps

- **Never run `cdk deploy`.** The deploy is `deploy.yml`, behind the human's approval.
- `npx cdk` only works from `infra/` (`deploy-traps.md`).
- `cfn-exec-policy.test.ts`, `iam-policy.test.ts` and `permissions-boundary.test.ts` synth
  every domain mode. Run the whole `npm test`.
- Don't touch the `DynamoDB` gateway endpoint in `network-stack.ts`: it is free, and
  removing it changes route tables on the same deploy. The Director PR that opened this
  spec lists leaving it as a recommendation. `network-stack.test.ts` pins it.
- The NAT egress rule stays: Cognito's JWKS and the later Kaggle refresh use it. Only the
  comment naming API-SPORTS changes.

## Order with other work

**`lambda-vpc-eni` self-deny, the later backlog row, also edits `infra/lib/app-stack.ts`
and depends on this merging first.** Its spec should be written after this merges. This
unit only touches a comment there, but the two must not be open together.

## Not in this unit

- **Track A edits, left out on purpose:** `wiki/GeneralContext/Prompts/06-nba-data.md`
  (its "What's next" and "Where things stand"), `TODO/01-for-you.md` (the hand-delete
  step, which this PR's list fills in) and `TODO/02-backlog.md` (the row).
- **A later Director PR:** `Standards/aws-stack.md` (DynamoDB's two jobs, API-SPORTS, the
  ingestion Lambda), `Standards/gof-patterns.md`, and
  `GeneralContext/Architecture/incident-runbook.md` (`ApiSportsKey`, the tables and the
  ingestion-retry queue in its lists). After the human deletes the retained table,
  `dynamodb:*` in `infra/iam/cdk-cfn-exec-role-policy.json` and the item actions in
  `fanwire-role-boundary-policy.json` can be narrowed, with a policy rollout.
- **Other stale text, not infra:** `docker-compose.yml`'s `dynamodb-local` service and
  comment, `docker/backend.Dockerfile`'s comment, `backend/pyproject.toml`'s comments and
  `moto[dynamodb]`, and docstrings in `backend/app/eventbus.py` and
  `backend/app/media/`. Manifests and compose are not unit-writable, and none of these
  reads the resources.
