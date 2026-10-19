# INFRA-004 — alarms, and where they go

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

Nothing alarms when something breaks (`grep -rn Alarm infra/lib` finds
nothing). A message in a dead-letter queue, a run of 5xx, a Lambda that
throws or a database filling up is invisible until someone happens to look.
`wiki/GeneralContext/Architecture/incident-runbook.md` "Known gaps" lists
this, and the backlog row "DLQ-depth alarms" is absorbed here. Deliverable 3
of `wiki/GeneralContext/Prompts/08-production-hardening.md`.

## Prerequisite: the exec policy (Director and human, before this deploys)

CloudFormation's role holds `FanwireCdkCfnExecPolicy`
(`infra/iam/cdk-cfn-exec-role-policy.json`), which grants only the services
the stacks use today. Alarms are `cloudwatch`; the topic is `sns`.
`infra/iam/**` is not writable by any unit role, so **the Director adds
`cloudwatch:*` and `sns:*` to that file in its own PR, and it merges before
this one.** The human then rolls the new version out (`infra/iam/README.md`)
before any deploy. `deploy.yml` refuses to deploy while the live version
differs from the file, so a merge in the wrong order blocks deploys. It
cannot half-deploy.

This unit adds `CloudWatch: 'cloudwatch'` and `SNS: 'sns'` to
`cfn-exec-policy.test.ts`'s `TYPE_TO_IAM`, in the test commit. Without the
policy change on `main`, "every service the templates create resources in
is granted" fails. If that happens, stop and report: it means the
prerequisite has not merged.

## The design

- **The topic lives in `Fanwire-Messaging`.** That is the async-plumbing
  stack. App already depends on it, and Data does not, so the topic cannot
  sit in Data without adding a dependency. DLQ alarms sit beside their
  queues in Messaging. Lambda, API and RDS alarms sit in App, which already
  holds the functions, the stage and a reference to `data.database`. Adding
  `instanceIdentifier` to that reference adds one Data export. It is stable,
  because the instance is never replaced.
- **Not a separate monitoring stack.** A stack that imports every function
  name, queue and instance from four others locks all of them behind exports,
  and `messaging-stack.ts`'s ingestion-queue comment shows what removing an
  export in use costs.
- **No CMK on the topic.** CloudWatch can publish to a KMS-encrypted topic
  only if the key policy grants `cloudwatch.amazonaws.com`. The one CMK's
  policy is in `Fanwire-Data`, and this stack deliberately uses an imported
  key reference so that it never edits that policy. Alarm notifications carry
  metric names and thresholds, no user data. Set `enforceSSL: true` and say
  why there is no key in a comment. If an existing test demands encryption on
  every resource, report it rather than weakening the test.
- **No subscription in the template.** The address is the human's, never
  committed (the brief's limit). The human subscribes it by hand with one
  command, which CloudFormation then leaves alone. Output the topic ARN from
  App (`AlarmTopicArn`) so the command has something to paste.
- **The thresholds start loose.** `16-performance-tests` gives the latency
  baseline to tighten p95/p99 from. 5xx is an absolute count (5 in 5
  minutes), not a ratio: at today's traffic one error in two requests would
  be 50%. Lambda errors and throttles alarm at 1, because at this volume one
  is worth an email, and an alarm emails on a state change, not every period.
  RDS `t4g.micro` allows roughly 80 to 110 connections, so alarm above 60. Its
  storage is 20 GiB, so alarm below 2 GiB free. The numbers are in
  `task.json`. Name each one as a constant with its reason.
- **Use the CDK metric helpers**: the queue's
  `metricApproximateNumberOfMessagesVisible`, the stage's
  `metricServerError` and `metricLatency` (the `$default` `HttpStage`, which
  carries the `Stage` dimension), the function's `metricErrors` and
  `metricThrottles`, and the instance's `metricCPUUtilization`,
  `metricFreeStorageSpace` and `metricDatabaseConnections`. Add actions with
  `aws-cloudwatch-actions`' `SnsAction`.
- **Every function, derived.** Loop over every function the stack builds,
  including the migration runner, the sports-data load and the origin-verify
  authorizer, so that a sixth function cannot ship unwatched. The test
  derives the list from the template, not from a hard-coded name list.

## Cost

About 21 alarms (3 DLQ, 3 API, 2 per function for 6 functions, 3 RDS; the
count test pins the real number) at USD $0.10 each per month is about
**$2.10 a month**. Email
delivery from SNS is free at this volume. Put the count and the cost in the
PR body.

## Traps

- **`cfn-exec-policy.test.ts` synthesizes every domain mode**, and so do
  `iam-policy.test.ts` and `permissions-boundary.test.ts`. Run the whole
  `npm test`, not one file.
- An alarm whose `OKActions` is missing goes quiet after the first email.
  Assert both action lists.
- Adding `instanceIdentifier` to App's reference to the database must not
  change `Fanwire-Data`'s template beyond the new export. Check `cdk synth`
  for Data before and after.
- **Never run `cdk deploy`.** The deploy is `deploy.yml`, after the human
  has rolled out the policy.

## Not in this task

Alarms on GuardDuty findings (the runbook's other gap), a dashboard,
composite alarms, anomaly detection, canaries, and subscribing an address.
