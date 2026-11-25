---
type: reference
---

# Incident Runbook: inventory, alarms and known gaps

Part of the [Incident Runbook](incident-runbook.md).

## Inventory

Physical names are CloudFormation-generated and change when a resource is
replaced. Confirm one with the `describe-stack-resources` command in
[Response](incident-runbook-response.md), "Containment sequences", before
acting on it.

| What | Stack | Physical name / id |
|---|---|---|
| Site | `Fanwire-Cdn` | `https://fanwire.daviddems.com`, distribution `E2AXWWXMA8YAE8` (`d3fb0uyhisvzkz.cloudfront.net`) |
| WAF WebACL | `Fanwire-Edge` (us-east-1) | `WebAcl` |
| HTTP API | `Fanwire-App` | `HttpApi`; direct calls are rejected by the origin-verify authorizer |
| User pool | `Fanwire-Auth` | `ca-central-1_eSfPUMRq8`, SPA client `1vskugrl60gggpt0lmib4ka85j`; pre-sign-up trigger `PreSignUpTrigger` |
| Backend functions | `Fanwire-App` | Logical ids `Api`, `Media`, `Notifications`, `AccountDeletion`, `Migration`, `SportsDataLoad`; look up physical names with `describe-stack-resources` |
| Functions outside the VPC | `Fanwire-App` | `OriginVerifyAuthorizer`, `SportsDataRefresh` |
| Network | `Fanwire-Network` | `vpc-0259c7c65d0a58371`; app subnets `subnet-0e68161ab23330f65`, `subnet-028cef17a50cc7fbb`; Lambda SG `sg-0c98e281c22be6d0c`; one NAT instance |
| Database | `Fanwire-Data` | `Postgres` (RDS), CMK-encrypted, data subnets only |
| Key | `Fanwire-Data` | `Key` — the one CMK (RDS, S3 media, DynamoDB, SQS, Secrets Manager) |
| Buckets | `Fanwire-Storage` | quarantine `fanwire-storage-quarantinebucketfdbda180-wbd8njkzttkf`; `PublicMediaBucket`; `FrontendBucket`; sports data `SportsDataBucket` `fanwire-storage-sportsdatabucketbe0c4682-mpq0jeekssck` (output `SportsDataBucketName`; the NBA dataset CSVs, read only by `SportsDataLoad`; RETAIN, not scanned) |
| Malware scan | `Fanwire-Storage` | GuardDuty Malware Protection plan `e0d078028fa35d2cdba2`, `ACTIVE` on `uploads/` |
| Queues | `Fanwire-Messaging` | notifications, media scan results — each with a DLQ (e.g. `Fanwire-Messaging-NotificationDlq467FCAE6-nWWbotTUIAPC`) |
| Event bus | `Fanwire-Messaging` | `PostEventBus` |
| Alarm topic | `Fanwire-Messaging` | `AlarmTopic`; ARN in `Fanwire-App`'s `AlarmTopicArn` output |

## Alarms

The CloudWatch alarms (`INFRA-004`; their count is pinned by
`EXPECTED_ALARM_COUNT` in `infra/test/alarms.test.ts`) send ALARM and OK to one
SNS topic. The topic's ARN is `Fanwire-App`'s `AlarmTopicArn` output. An email
address is subscribed to it by hand and never committed; `set-alarm-state`
proves the path. Thresholds and reasons:
`wiki/CodeContext/Modules/0x00a-architecture-infra.md` "Alarms". An alarm
emails on a change of state, not every period, so one email can stand for a
long outage. An OK email means it recovered.
GuardDuty findings in this account of severity 4 or more (Medium, High,
Critical) email through the same topic: `GuardDutyFindingRule` in
`Fanwire-Messaging` (`INFRA-009`), on the default bus. A sample finding proves
the path: `aws guardduty create-sample-findings` with one `--finding-types`
value (without it, every type is created and each emails).

| Alarm | First look |
|---|---|
| A DLQ depth > 0 (Messaging) | Read the message without deleting it: `aws sqs receive-message --profile fanwire-workload --region ca-central-1 --queue-url (aws sqs get-queue-url --profile fanwire-workload --region ca-central-1 --queue-name PASTE_DLQ_NAME --query QueueUrl --output text) --visibility-timeout 0`. Then read the consumer's log group for the error. |
| API 5xx, or p95/p99 latency | The `Api` function's log group, then RDS. A deploy just before it means [Roll back a deploy](incident-runbook-rollback.md). |
| A function's Errors or Throttles | That function's log group (`aws logs tail /aws/lambda/PASTE_FUNCTION_NAME --profile fanwire-workload --region ca-central-1 --since 30m`). Throttles at this volume mean a concurrency limit, not load. |
| RDS CPU, free storage or connections | RDS console → `Fanwire-Data` `Postgres` → Monitoring. Free storage below 2 GiB means growing the allocated storage is a reviewed CDK change. |

## Known gaps

- **No S3 data events in CloudTrail** (management events only), so object-level reads and writes are not
  recorded. Cheap at this volume; not enabled.
- Security Hub — optional at this budget per `wiki/CodeContext/Standards/security.md`, not part of this runbook.
