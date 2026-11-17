---
type: prompt
---

# 22 - Track D: durable account lifecycle foundation

**Update, 2026-11-17.** The USERS-009 product PR and its documentation PR are
merged in the archive (fanwire-archive#392, #393), so the checkpoint this brief
once described is history. The code is on `main` and **dormant**:
`ACCOUNT_LIFECYCLE_ENABLED` is `'false'` in `infra/lib/app-stack.ts`. The
human's decisions ([ADR 0035](../Decisions/0035-outstanding-work-answers.md)):
Track D is a security requirement to finish, after the user-facing work, as
Outstanding-work track 6 (`35-outstanding-work-6-account-lifecycle.md`), which
owns what is left: `USERS-005`, activation and `AUTH-001`. Implementation of
AUTH-001 is no longer paused: it is re-scoped below. `AUTH-002`/`AUTH-003` are
dropped.

**Brief for a Director session** (a high-tier model, driven turn by turn by
the human) on the Track D foundation. Self-contained: read this file, then
what it names. The merged foundation's migration, legacy-adoption and
activation gates remain.

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

## Reset: native Cognito only

Decided ([ADR 0035](../Decisions/0035-outstanding-work-answers.md)): `AUTH-001` keeps
the shipped frontend's direct native Cognito ForgotPassword and
ConfirmForgotPassword with the verified-email code, plus a static verify
reminder and optional verification for ordinary use. No SES, custom reset
tokens, post-reset email, password history, paid plan, timer unlock or
revocation-evidence machinery. Locally verified ID JWTs cannot detect a
provider revocation; that stays a known limit, and `USERS-009`'s fencing
covers deletion. A Director rewrites the `AUTH-001` spec to this scope before
any hand run; the parked experiment is not shipped. `AUTH-002` and `AUTH-003`
are dropped.

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
