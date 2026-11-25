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
| Tables | `Fanwire-Data` | `IdempotencyTable`, `LiveScoreCacheTable` |
| Key | `Fanwire-Data` | `Key` — the one CMK (RDS, S3 media, DynamoDB, SQS, Secrets Manager) |
| Buckets | `Fanwire-Storage` | quarantine `fanwire-storage-quarantinebucketfdbda180-wbd8njkzttkf`; `PublicMediaBucket`; `FrontendBucket`; sports data `SportsDataBucket` `fanwire-storage-sportsdatabucketbe0c4682-mpq0jeekssck` (output `SportsDataBucketName`; the NBA dataset CSVs, read only by `SportsDataLoad`; RETAIN, not scanned) |
| Malware scan | `Fanwire-Storage` | GuardDuty Malware Protection plan `e0d078028fa35d2cdba2`, `ACTIVE` on `uploads/` |
| Queues | `Fanwire-Messaging` | notifications, media scan results, ingestion retry — each with a DLQ (e.g. `Fanwire-Messaging-NotificationDlq467FCAE6-nWWbotTUIAPC`) |
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

| Alarm | First look |
|---|---|
| A DLQ depth > 0 (Messaging) | Read the message without deleting it: `aws sqs receive-message --profile fanwire-workload --region ca-central-1 --queue-url (aws sqs get-queue-url --profile fanwire-workload --region ca-central-1 --queue-name PASTE_DLQ_NAME --query QueueUrl --output text) --visibility-timeout 0`. Then read the consumer's log group for the error. |
| API 5xx, or p95/p99 latency | The `Api` function's log group, then RDS. A deploy just before it means [Roll back a deploy](incident-runbook-rollback.md). |
| A function's Errors or Throttles | That function's log group (`aws logs tail /aws/lambda/PASTE_FUNCTION_NAME --profile fanwire-workload --region ca-central-1 --since 30m`). Throttles at this volume mean a concurrency limit, not load. |
| RDS CPU, free storage or connections | RDS console → `Fanwire-Data` `Postgres` → Monitoring. Free storage below 2 GiB means growing the allocated storage is a reviewed CDK change. |

## Known gaps

- **GuardDuty findings raise no alarm.** They are checked by hand
  ([Response](incident-runbook-response.md), "Trigger"). The human's design is
  a same-account EventBridge rule in `fanwire-workload` routing Medium and High
  findings (`source` `aws.guardduty`, `detail-type` `GuardDuty Finding`,
  `detail.severity` ≥ 4; Medium is 4.0–6.9, High 7.0–8.9, Critical 9.0–10.0)
  to the existing alarm topic, with no cross-account forwarding. It is not
  built: AWS's GuardDuty documentation does not state that a member account's
  own default event bus receives its own findings. ["Processing GuardDuty
  findings with Amazon EventBridge"](https://docs.aws.amazon.com/guardduty/latest/ug/guardduty_findings_eventbridge.html)
  says only that rules in the administrator account receive findings from both
  the administrator and member accounts; the account, organizations and
  member-relationship pages are silent on a member's bus (members can view
  their own findings, cannot archive them, and cannot set the EventBridge
  notification frequency). The workload account has its own detector
  (`62d0584d4d193d4f24a7a4a5f375baa2`). Options; the choice is the human's:
  - (A) Build the same-account rule anyway and prove it with `aws guardduty create-sample-findings` in the workload account after the deploy (a human-run write), removing it if no email arrives.
  - (B) A rule in the delegated administrator `fanwire-log-archive`, which the docs confirm receives member findings, forwarding to the workload topic or bus: a deploy into the log-archive account, which the human ruled out for now.
  - (C) A managed notification outside CDK (AWS User Notifications or Security Hub).
- **No S3 data events in CloudTrail** (management events only), so object-level reads and writes are not
  recorded. Cheap at this volume; not enabled.
- Security Hub — optional at this budget per `wiki/CodeContext/Standards/security.md`, not part of this runbook.
