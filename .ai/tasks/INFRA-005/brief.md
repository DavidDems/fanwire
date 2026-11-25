# INFRA-005: delete the API-SPORTS infra

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Start gate

This spec merges into `outstanding-track-3-phase-2`, this run's integration branch for
phase 2 (the human's instruction). The unit's branch is cut from that branch once it
holds the spec. Its PR into `main` is titled "merge only after track 3's deploy is
green". No agent merges it.

## Why

`Prompts/06` decision 3 retired API-SPORTS. `EVENTS-003` (fanwire-archive#142, deployed
2026-10-14) removed every consumer but kept the resources and their exports, because the
deployed App still imported them and a deploy updates Data and Messaging first.
`Prompts/06` "What's next" item 1 is this unit.

No data is at stake: `EVENTS-003`'s spec says the path never ran against real data, the
live database was loaded from the dataset, and neither table is the system of record
(`aws-stack.md`). Nothing falls back to it. The scheduled refresh, `EVENTS-008`, uses
Kaggle.

## Phase 1 is done

The importer (`Fanwire-App`) stopped importing all seven exports with `EVENTS-003`'s
deploy on 2026-10-14. On 2026-11-24 the Director ran `aws cloudformation list-imports`
on each of the seven, and each answered "is not imported by any stack". The human still
re-runs the seven checks before approving this unit's deploy, since that can change.

## Exactly what is removed

Re-verified on this repo at the `outstanding-track-3-phase-2` tip. Eight resources and
seven outputs.

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
two `exportValue` calls and `CONSUMER_TIMEOUTS.ingestion` in `messaging-stack.ts`
(`app-stack.ts` uses only `.media` and `.notifications`). `app-stack.ts` and
`network-stack.ts` change in comments only, so check their templates did not move.
`queueWithDlq` keeps its signature: two callers remain. The Kaggle API token secret
(`EVENTS-008`) and its export, and the RDS instance export, stay.

## Physical ids of the RETAIN resources

Read live on 2026-11-24. Retained resources keep no link to the stack, so these cannot be
read from it after the deploy; the PR carries them.

- `IdempotencyTable22A5A209`: table `Fanwire-Data-IdempotencyTable22A5A209-1C43JFYKWD1FS`,
  0 items, deletion protection off.
- `ApiSportsKey4432EB4A`:
  `arn:aws:secretsmanager:ca-central-1:294321867941:secret:ApiSportsKey4432EB4A-iEhKdFE3TfkR-kzUcyV`.

## What the PR hands the human

Single-line PowerShell commands, each with `--profile fanwire-workload --region ca-central-1`:

1. Before approving the deploy: `aws cloudformation list-imports --export-name <stack>:<output id>`
   for each of the seven. Each must answer that it is not imported by any stack.
2. After the deploy: `aws dynamodb delete-table --table-name <table>`, then
   `aws dynamodb describe-table --table-name <table>`, which must answer
   `ResourceNotFoundException`.
3. `aws secretsmanager delete-secret --secret-id <ARN> --recovery-window-in-days 7`, then
   `aws secretsmanager describe-secret --secret-id <ARN>`, which must show a
   `DeletedDate`. The secret is fully gone only after the 7-day window;
   `--force-delete-without-recovery` (instead of the window) is the human's choice if
   they want it gone now.

Never read the secret's value: no `get-secret-value`. If a real key was ever stored, the
human may revoke it at api-sports.io; that is theirs. Nothing in the unit runs `aws`.

## Expected deploy, in `cdk diff` terms

- `Fanwire-Data`: `[-]` `IdempotencyTable22A5A209` (RETAIN, orphaned),
  `[-]` `LiveScoreCacheTable277AE7C2` (deleted), `[-]` `ApiSportsKey4432EB4A` (RETAIN,
  orphaned), `[-]` five Outputs.
- `Fanwire-Messaging`: `[-]` the two queues, the two queue policies, the DLQ alarm and
  two Outputs.
- Every other stack: no change.

Derive it from the synth diff below; the unit does not run `cdk diff`, which needs AWS
credentials and compares against the live stack.

## `docker-compose.yml`

`dynamodb-local`, the header comment line "a local DynamoDB for the idempotency-key /
live-score-cache tables", backend-test's `depends_on` entry for it and its
`AWS_ENDPOINT_URL_DYNAMODB` env var exist only for the retired tables. Remove them; the
other backend-test env vars stay.

`git grep -n -E "dynamodb-local|DYNAMODB_HOST_PORT|AWS_ENDPOINT_URL_DYNAMODB"` over
`backend/ frontend/ .github/ docker/ scripts`, run on 2026-11-24, finds only:

- `backend/tests/media/test_dev_process_media.py:86`
- `backend/tests/media/test_lambda_handler.py:72`
- `backend/tests/notifications/test_lambda_handler.py:51`

each `monkeypatch.delenv("AWS_ENDPOINT_URL_DYNAMODB", raising=False)`. They do not block:
with `raising=False` they are no-ops once compose stops setting the var. They are in
`backend/`, which the unit cannot write, so the Director removes them (below). Outside
those paths, `wiki/CodeContext/Standards/build-deployment.md` line 92 names
`dynamodb-local`, also the Director's. `.ai/tests/fixtures/media002-baseline-failed.log`
is a recorded CI log; leave it.

## What was checked to still read them

On this repo at the phase-2 branch tip, and to repeat before the PR:

- **Templates:** no resource elsewhere refers to these, and no `Fn::ImportValue` names
  them in any stack.
- **Lambda code, env vars:** `backend/app` has no DynamoDB client and no
  `IDEMPOTENCY_`, `LIVE_SCORE` or `API_SPORTS` setting. `backend/tests/events/test_api_sports_retired.py`
  guards that and stays.
- **IAM and schedules:** no statement or event source mapping names them.
  `app-stack.test.ts`'s `RETIRED_*` sweeps say so; keep them, and correct its header
  comment, which says the resources stay.
- **`infra/test/cfn-exec-policy.test.ts`:** one-way. It requires what templates use to
  be granted and does not fail on a grant no template uses, so removing the last
  DynamoDB resource does not fail it. Leave `TYPE_TO_IAM`'s `DynamoDB` entry.
- **`infra/iam/`:** no change, so no policy rollout blocks the deploy. **Do not drop
  `dynamodb:*`:** CloudFormation needs it to delete the live-score table in this deploy.
- **Tests to invert:** `data-stack.test.ts` (the DynamoDB block's count of 2, "four
  CMK-encrypted secrets" becoming three, the block keeping the five exports),
  `messaging-stack.test.ts` (the three-purpose loop and the block keeping the two
  exports), `alarms.test.ts` (`EXPECTED_ALARM_COUNT` 26 to 25, comment "2 DLQ
  (notification, media-scan-result)").

## Before/after synth diff

From `infra/`, `npm run synth` on the base commit and on the branch, each into its own
output folder, then diff `cdk.out/*.template.json` per stack. Eight stacks: expected
identical are Edge, Network, Auth, Storage, App and Cdn.

Do not reword the CMK's `description`, though it still says DynamoDB: it is a key update
for no gain. The `Fanwire-Data` stack description in `app.ts` may lose "DynamoDB tables",
since a description changes no resource.

## Traps

- **Never run `cdk deploy`.** The deploy is `deploy.yml`, behind the human's approval.
- `npx cdk` only works from `infra/` (`deploy-traps.md`).
- `cfn-exec-policy.test.ts`, `iam-policy.test.ts` and `permissions-boundary.test.ts` synth
  every domain mode. Run the whole `npm test`.
- Don't touch the DynamoDB gateway endpoint in `network-stack.ts`: it is free, and
  removing it changes route tables on the same deploy. `network-stack.test.ts` pins it.
- The NAT egress rule stays: Cognito's JWKS and the Kaggle refresh use it. Only the
  comments naming API-SPORTS change.

## Docs

The unit updates `0x00-architecture.md`, `0x00a-architecture-infra.md` (the Messaging
row, and "Alarms": 25, breakdown without ingestion-retry), `0x00b-architecture-iam-gaps.md`,
`0x02-events.md` and `0x02a-events-schema.md`.

The Director, not the unit, adds a Director commit on the same PR for:
`wiki/CodeContext/Standards/aws-stack.md` (DynamoDB's two tables, the API-SPORTS secret
and the ingestion-retry queue), `security.md` (the API-SPORTS key line),
`build-deployment.md` (`dynamodb-local`),
`wiki/GeneralContext/Architecture/incident-runbook-inventory.md` (the Tables row) and
`incident-runbook-response.md` (`ApiSportsKey`), plus the three `backend/tests` `delenv`
lines above.

## Not in this unit

- **Track edits:** `wiki/GeneralContext/Prompts/06-nba-data.md` ("What's next", "Where
  things stand"), `TODO/01-for-you.md` (the hand-delete step, which this PR's list fills
  in) and `TODO/02-backlog.md`.
- **Later:** the `Standards/gof-patterns.md` and `build-deployment-packages.md` mentions,
  and `backend/pyproject.toml`'s comments and `moto[dynamodb]`. After the human deletes
  the retained table, `dynamodb:*` in `infra/iam/cdk-cfn-exec-role-policy.json` and the
  item actions in `fanwire-role-boundary-policy.json` can be narrowed, with a policy
  rollout.
