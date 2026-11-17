---
type: prompt
---

# 35 — Outstanding work, track 6: account lifecycle (Track D)

**Brief for a Director session.** Shared rules: [29](29-outstanding-work.md).
This track is a security requirement the human wants finished, not a feature
they want quickly ([ADR 0035](../Decisions/0035-outstanding-work-answers.md)),
so it runs after the user-facing tracks.

**Objective:** `USERS-005` shipped; `USERS-009` verified and, with the
human's approval at each gate, activated; `AUTH-001` rebuilt to native Cognito
only. `AUTH-002` and `AUTH-003` are dropped: do not touch them.

## Read first, in this order

1. `Prompts/22-launch-adjustments.md`: the foundation, the gates, the limits.
2. `Decisions/0009-account-lifecycle-evidence.md`,
   `Architecture/account-lifecycle-proof.md` (steps 7–9) and
   `account-lifecycle-research.md`.
3. `.ai/tasks/USERS-009/brief.md` "Migration and activation gates",
   `wiki/CodeContext/Modules/0x01a-users-schema.md` "Durable account
   lifecycle", `Architecture/deploy-traps.md`.

## Where things stand (2026-11-17), verify, don't trust

- `USERS-009` is merged (fanwire-archive#392, #393) and **dormant**:
  `ACCOUNT_LIFECYCLE_ENABLED: 'false'` in `infra/lib/app-stack.ts`, and the
  settings validator requires a cutover time and a trusted Cognito namespace
  once it is true (`backend/app/settings.py`).
- The Alembic head on `main` is `9c009a110001`; the human is unsure whether
  the Migration Lambda ever ran it. A five-minute rule, `AccountDeletionSchedule`,
  is in `app-stack.ts`.
- `USERS-005` has red tests parked in `.ai/tasks/USERS-005/parked/`.
- The human wants the live state confirmed first: deliverable 1.

## Deliverables

1. **Confirm the live state (the human runs; you read the output).** An
   ordered list, one single-line PowerShell command each:
   - the flag is off: find the API function with `aws lambda list-functions`
     and read `Environment.Variables.ACCOUNT_LIFECYCLE_ENABLED`;
   - the migration ran: invoke the `Migration` function; its answer must name
     `9c009a110001`. Invoking is idempotent but is a production write: get
     the human's approval first;
   - the rule exists and runs: `aws events list-rules` for
     `AccountDeletionSchedule`, and its Lambda's recent invocations;
   - the site still works: signed in, `/api/users/me` answers 200.
   Record the answers in `Prompts/22` before going on.
2. **`USERS-005` (hand).** Avatar colours replace presets; resume from the
   parked red tests; its scope already covers `AppLayout`. Browser-check the
   header avatar.
3. **Activation review (Director).** With the human, work through
   `.ai/tasks/USERS-009/brief.md`'s gates one at a time: legacy-identity
   inventory and adoption (never invent deleted subjects); the bucket
   versioning check; the consumer drain; alarms and the schedule; the
   warning copy. For each, say what evidence you have and what the human
   must approve. **No production write happens without the human's explicit
   yes for that step.** Activate by setting the flag and the cutover time
   through a normal deploy, and verify after it.
4. **`AUTH-001` (the Director rewrites the spec, then a hand unit).** Native
   Cognito forgot-password with the verified-email code, plus the static
   verify reminder (`Prompts/22` "Reset: native Cognito only"). No SES,
   custom tokens, paid plan or revocation machinery. Delete the parked
   experiment's patch once the unit merges.
5. **Close-out.** Delete `Prompts/22`; update `0x01*` and the index; remove
   the Track D section from the backlog.

## Limits specific to this track

No AWS write, migration or production-data operation without the human's
explicit approval at that step; the foundation merge authorized none. Use
real PostgreSQL for the concurrency tests. Browser checks use Chrome and
ports 5230–5239, and sign out afterwards.
