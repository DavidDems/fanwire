---
type: decision
---

# 0044 - The deploy runs the migrations; their logs are kept forever

Decision: 2026-11-26, the human, after Outstanding-work track 6's deploy of
#123 failed its smoke check because a new Alembic revision (`6da4a4366b5b`)
had not been applied: nothing had invoked the `Migration` Lambda.

## Context

`INFRA-003` made the migration runner invoked "by a human, by nothing else", so
that DDL never sits inside a CloudFormation update. That held, but it made every
deploy that adds a revision go down until someone remembered the manual step,
and the deploy role had no `lambda:InvokeFunction` to do it itself.

## Choice

- **The workflow migrates.** `deploy.yml` invokes `Fanwire-App-Migration` after
  `cdk deploy` and before the smoke check, under the `production` environment
  approval the deploy already has. It fails the job unless the response is
  `{"revision": ...}` equal to the repo's single Alembic head. This supersedes
  `INFRA-003`'s manual-only rule; the "no trigger" half stands (no rule,
  schedule, event source mapping or custom resource), and DDL still never runs
  inside CloudFormation. By hand stays the fallback
  (`build-deployment-post-deploy.md`).
- **One narrow grant.** The deploy role gains `lambda:InvokeFunction` on
  `arn:aws:lambda:ca-central-1:294321867941:function:Fanwire-App-Migration`
  alone. The function now has a fixed name (it keeps the `Fanwire-App-` prefix
  the ENI self-deny matches), so the ARN has no wildcard.
- **The Migration log group never expires** and is retained when the stack is
  destroyed, so "which revisions ran?" always has an answer. Every other log
  group keeps one month.

## Consequences

- The policy change is applied by the human before the deploy that needs it, or
  the live-IAM check refuses the run.
- The first deploy after this replaces the Migration function (new physical
  name); the old log group is kept under CloudFormation's retain policy.
- `INFRA-003`'s note that "nothing invokes it automatically" is superseded in
  `app.migrate`'s docstring and `app-stack.ts`.
