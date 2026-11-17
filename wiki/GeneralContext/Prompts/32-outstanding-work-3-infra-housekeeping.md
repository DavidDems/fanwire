---
type: prompt
---

# 32 — Outstanding work, track 3: infra and backend housekeeping

**Brief for a Director session.** Shared rules: [29](29-outstanding-work.md).

**Objective:** retire the API-SPORTS leftovers and close the small infra,
alarm and documentation gaps the compaction carried over. Closes the backlog
rows "Delete the API-SPORTS infra resources", the `lambda-vpc-eni` self-deny,
the GuardDuty alarm, "`0x00a` says 21", and "Small open decisions from the
compaction".

## Read first, in this order

1. `Architecture/deploy-traps.md` and `wiki/CodeContext/Modules/0x00b-architecture-iam-gaps.md`.
2. `Prompts/06-nba-data.md` "Open work" 1, and `TODO/01-for-you.md`.
3. `infra/lib/data-stack.ts`, `app-stack.ts`, `messaging-stack.ts`: what the
   leftovers are. `infra/test/alarms.test.ts`, `iam-policy.test.ts`.
4. `incident-runbook-inventory.md` "Known gaps".

## Where things stand (2026-11-17), verify, don't trust

- Retained in code and unused: `IdempotencyTable` (DynamoDB, `RETAIN`),
  `LiveScoreCacheTable`, the `ApiSportsKey` secret (`RETAIN`), the
  ingestion-retry queue and DLQ, and the five exports that keep their stack
  imports stable (`data-stack.ts`, "this.exportValue"). The human decided to
  delete all of it ([ADR 0035](../Decisions/0035-outstanding-work-answers.md)).
- `0x00a` "Alarms" says 21; `infra/test/alarms.test.ts` pins 23.

## Deliverables

1. **The API-SPORTS clean-up (`hand` unit, spec first).** Remove the
   resources and the exports in the right order: a CloudFormation export still
   imported by another stack cannot be removed in the same deploy that drops
   the importer (read the comment in `data-stack.ts` and `deploy-traps.md`).
   That probably means two deploys; plan them. `RETAIN` resources leave the
   template but stay in the account: the human deletes `IdempotencyTable` and
   `ApiSportsKey` by hand afterwards. List both commands in the PR, as single
   lines, with the check that each is gone.
2. **Alarms doc.** Make `0x00a` state the number and list the test pins.
3. **The `lambda-vpc-eni` self-deny.** First check how
   `infra/test/iam-policy.test.ts` treats a `Deny`; add the condition
   (`lambda:SourceFunctionArn`, `ArnLike` `Fanwire-App-*`). It is proven only
   by a deploy and a signed-in `/api/users/me` 200: put that in the PR's
   manual steps.
4. **The GuardDuty-findings alarm.** Findings live in
   `fanwire-log-archive`, the topic in the workload account. Write the design
   first (a cross-account EventBridge rule), ask the human only if it needs a
   new account-level permission, then build it as a unit.
5. **The compaction's small decisions.** For each, read the code and decide,
   recording the answer in its owner file: migrations stay manual (revisit
   with the permissions boundary); per-user rate limits (`0x00b`); whether the
   incident inventory misses the sports-data bucket; `dev-auth-setup`
   "mirrors" against production's pre-sign-up auto-confirm. A decision that
   needs the human goes to one `AskUserQuestion` at the end.

## Mechanics learned the hard way

- Never run `cdk deploy`; `deploy.yml` deploys, and the human reads the
  `cdk diff` first. A removed export that is still imported fails the deploy.
- `RETAIN` resources keep their names, so a re-add collides.
