---
type: prompt
---

# 22 - Track D: durable account lifecycle foundation

**Director handoff, 2026-11-12.** The human requests a sensible checkpoint and
two reviewable PRs: product and separate Director documentation/handoff. Finish
that checkpoint, then stop; do not continue AUTH-001 or USERS-005. fanwire-archive#378 and the
exact [USERS-009 specification](../../../.ai/tasks/USERS-009/task.json) /
[brief](../../../.ai/tasks/USERS-009/brief.md) in fanwire-archive#381 are merged. Foundation
implementation is authorized; merge, activation, AWS writes and production/user
data operations are not.

## Checkpoint and two PRs

- Product [PR fanwire-archive#392](https://github.com/DavidDems/fanwire-archive/pull/392):
  `agent/USERS-009`, product `fanwire-archive@324c5fa`, test follow-up `fanwire-archive@7eb88c2`, fresh-main
  merge `fanwire-archive@f4a4563`, import-order-only test correction `fanwire-archive@ca703d9`, frozen-clock
  route-test correction `fanwire-archive@803f9b2` (current product PR head).
- Documentation branch: `director/users009-handoff`, preserving CUT-06's split
  module references on main `fanwire-archive@ddff92e`:
  [PR fanwire-archive#393](https://github.com/DavidDems/fanwire-archive/pull/393). Product PR first,
  dependent documentation PR second; verify
  ancestry on main before reporting the dependency landed.
- Full backend container: 2,421 pass/one clock-sensitive test failure. The test
  used a future timestamp only one second ahead of a real clock across several
  requests; `fanwire-archive@803f9b2` freezes time without changing the application guard. Its
  complete route file then passes 20/20 in the rebuilt container. Final full CI
  confirmation remains **PENDING**: [run 43265803252](https://github.com/DavidDems/fanwire-archive/actions/runs/43265803252).
- Full frontend container: 3,671 pass; container typecheck/lint/build pass.
  Backend pinned Ruff passes and mypy passes 67 modules. Infra: 393 tests across
  19 suites, build/lint and synth with no lookups pass. Agent suite: 1,721
  pass/93 skip with GIT_* scrubbed; selfcheck passes. Ten fault mutants are
  killed, including removing the future-auth guard; three baseline runs pass.
  No full local backend rerun after the clock-only correction is claimed.
- Artifacts: `users009-*` in the old checkout's untracked `.worktrees/_ledger/`
  (after CUT-12, in the `fanwire-archive` folder beside this one). Both PRs are draft review
  checkpoints; task stays HAND_RUNNING. The receiving Director must inspect
  exact-head CI and both diffs before declaring ready; no rollout approval is
  implied. No browser/provider/deployed-role proof was obtained.
- The advisory coverage helper [run 43265796960](https://github.com/DavidDems/fanwire-archive/actions/runs/43265796960)
  failed because its model exhausted the 4,000-token output budget without a
  usable answer. This is not a failed application assertion or a completed
  criteria review. No paid rerun was requested; inspect coverage manually or
  scope a separate Director tooling change.
- Keep code/tests frozen at this review checkpoint. Resolve documentation and
  finish authorized verification/PR preparation, disclose pending evidence,
  update ledger/PR numbers and hand control to the human. No implementation of
  another task is authorized by this handoff.

## Read first

1. Read `AGENTS.md`, `Architecture/work-modes.md` (canonical routing),
   `Architecture/director-sessions.md` and the WikiUpdate skill.
2. Read [ADR 0009](../Decisions/0009-account-lifecycle-evidence.md), its
   [evidence/failure matrix](../Architecture/account-lifecycle-research.md) and
   [proof/deployment plan](../Architecture/account-lifecycle-proof.md), then
   USERS-009 task/brief. The merged ADR is immutable; this continuation narrows
   implementation to the approved foundation.
3. Read the Users/Posts/Media/Notifications module references and relevant
   architecture/security/design standards named by the task. Inspect current
   source, deletion facade, mutation commits, consumers and infra; do not assume
   the preserved AUTH-001 experiment is an approved implementation.

## Approved foundation and merge order

The merged USERS-009 specification selects durable issuer/sub authority
independent of profiles, monotonic generations, terminal tombstones, one immutable
deletion operation/manifest and a shared stage-specific runner. A five-minute
EventBridge Rule invokes a bounded DB scan so recovery does not depend on the
browser or a queue notification. Code remains dormant until separately reviewed
activation. Check actual task paths/roles before push; any missing IAM ceiling
needs a separate Director prerequisite, never worker permission expansion.

Preserve the existing DELETE /users/me/data contract: 204 only after durable
completion, generic 503/retry while unfinished. Add owner-authenticated status;
no unauthenticated capability flow or frontend polling redesign. Do not change
reset, auth-token transport, GetUser/managed-session architecture or Cognito
triggers. No new dependency, queue or generalized workflow platform is selected.
All mutation and background publication paths must fence deletion, including
requests authenticated before acceptance and subjects with no remaining profile.

Migration/cutover is a release gate. Backfill extant profiles without inventing
historical deleted subjects. Missing-profile legacy identities need an
evidence-based inventory/adoption plan and human review; do not silently lock
legitimate incomplete signups or claim complete historical coverage. New accepted
operations must recover automatically without ordinary operator intervention.
Stage schema before enforcement and prevent old handlers from bypassing fences.
No live inventory, migration, deployment or data operation is approved now.

Current media buckets are configured unversioned; verify live state separately
before activation. Retain exact-key manifests for late presigned uploads or late
media writes, with automatic cleanup and no timer-based access restoration.
Logical account deletion is distinct from CDN/backups/in-flight-copy erasure.
Evidence retention limits and scope any necessary warning-copy change before
activation; no instantaneous physical-erasure claim is authorized.

## Reset remains paused

AUTH-001's stop gate remains: neither fanwire-archive#378 nor foundation authorization releases
reset implementation. Completely missing/late provider completion and revocation
need authoritative evidence or a further reviewed enforcement architecture.
PostConfirmation is a candidate positive evidence path, not durable/exactly-once
or atomic delivery. A local outbox cannot reconstruct an absent provider result.
No timer unlock, invalid-code account lock or manual-only recovery is selected.

The shipped frontend already calls native Cognito ForgotPassword and
ConfirmForgotPassword directly. Deferring AUTH-001 leaves that basic flow in
place; it does not remove it or prove that reset ends all existing app sessions.
Locally verified ID JWTs cannot detect provider revocation. Keep native
verified-email codes/static reminder, optional verification for ordinary use,
no SES/custom reset tokens, separate post-reset email, history or paid plan.
AUTH-002/003 stay deferred outside Track D.

## Preserved work and completed prerequisites

USERS-006/007/008 and the other previously completed launch units remain complete;
do not repeat their migrations or launch manual steps. IAM fanwire-archive#370 deployed at
fanwire-archive@00933ce (run 42437556488); boundary v3 and exact-pool AdminGetUser and
AdminUserGlobalSignOut were verified. Scope fanwire-archive#375/#376 merged. These grants are
not permission to perform AWS writes or change provider data now.

The AUTH-001 experiment (local `agent/AUTH-001` at `fanwire-archive@54fdb67` plus its 14
uncommitted files) is [`parked/auth001-experiment.patch`](../../../.ai/tasks/AUTH-001/parked/auth001-experiment.patch);
do not ship it. USERS-005's red tests are
[`parked/users005-red-tests.patch`](../../../.ai/tasks/USERS-005/parked/users005-red-tests.patch),
and its scope now covers `AppLayout` (2026-11-13). The unapproved/unshipped finite 60-second
experiment cannot establish a remote completion bound. Prior 239 backend passes
and 789/791 frontend passes with 2 later repaired but unrerun failures are historical,
not security approval. Director UI documentation
follow-ups remain queued.

## Execution limits

Use one Codex subagent at a time in explicit isolated worktrees. Director owns
Git, review/reproduction, per-role guards, commits, push/PR, CI and the ledger.
Scrub every GIT_* variable in .ai tests. Before heavy work check shared lock and
at least 2 GB free RAM. Future browser checks use Chrome/Chromium, Track D ports
5230-5239 with strict binding, and stop only this session's verified process.
Keep jev disabled. Never merge/approve/force-push, dispatch paid workers, deploy
or perform production/user-data operations. AWS writes require explicit scoped
in-session approval. No manual action is needed during checkpoint preparation; the human reviews the two PRs.
