# INFRA-009: GuardDuty findings email through the alarm topic

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

`incident-runbook-inventory.md` "Known gaps": GuardDuty findings raise no alarm and are
checked by hand. The human chose option (A) on 2026-11-25: a same-account EventBridge
rule in `fanwire-workload`, routed to the existing `AlarmTopic`, with no cross-account
forwarding and no deploy into `fanwire-log-archive`, proved after the deploy with one
sample finding and removed if it does not work.

## The open question this unit settles by deploy

AWS's GuardDuty pages say an administrator account's EventBridge rules receive member
findings, and say nothing about a member's own default bus. The workload account is a
member of the delegated administrator `fanwire-log-archive` and has its own detector,
`62d0584d4d193d4f24a7a4a5f375baa2`. The sample-findings page says samples exist to test
EventBridge rules, but not whether a member account may create them. Synth proves only
the shape; the sample finding after the deploy is the proof, and the rollback is named
in the PR.

## What exists

- `MessagingStack` (`infra/lib/messaging-stack.ts`) owns `AlarmTopic` (no CMK, on purpose:
  see the comment above it) and its topic policy, which holds one statement,
  `AllowCloudWatchAlarms`, scoped by `aws:SourceAccount` and `aws:SourceArn`.
- `MalwareScanResultRule` already listens to `aws.guardduty` on the default bus. Its
  detail-type is `GuardDuty Malware Protection Object Scan Result`, a different event, so
  the new pattern cannot overlap it.
- `routeRuleToQueue` is the model: a hand-written target (`rule.addTarget({ bind: ... })`)
  plus a single-action resource-policy statement conditioned on the rule's ARN. Do the
  same for the topic. The stock `targets.SnsTopic` grants publish to
  `events.amazonaws.com` with no source condition: a confused-deputy gap, so it is not
  used. The rule's target returns `input` from `bind` for the message.

## Severity

GuardDuty severities: Low 1.0–3.9, Medium 4.0–6.9, High 7.0–8.9, Critical 9.0–10.0. The
human named Medium and High; `>= 4` includes Critical, which must not be dropped.

## The message

`events.RuleTargetInput.fromMultilineText` with `events.EventField.fromPath` for
`$.detail.severity`, `$.detail.type`, `$.detail.title`, `$.account`, `$.region` and
`$.detail.id`. The email subscriber is a human reading it on a phone: one line naming
severity and type, then the title, then where to look (account, region, finding id).

## Traps

- Commit by role: the infra tests as `test_agent`, `messaging-stack.ts` as `code_agent`,
  `0x00a` as `context_maintainer`.
- GuardDuty publishes a new finding within about five minutes; updates to an existing
  finding follow the administrator's frequency, which a member cannot change. The sample
  is a new finding, so 15 minutes is a fair wait.
- Do not change `EXPECTED_ALARM_COUNT`; do not add a CloudWatch alarm on the rule.
- `wiki/GeneralContext/` (the inventory's gap and the response runbook's "Trigger") is the
  Director's, after the deploy proves it.
- `npm test` in `infra/` runs many synths; `--maxWorkers=2` keeps it from exhausting memory.
