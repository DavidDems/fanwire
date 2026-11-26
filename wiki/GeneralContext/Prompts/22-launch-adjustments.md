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

## Live state (track 6 deliverable 1, 2026-11-25)

**Not read: the AWS SSO token had expired before the session started.**
`aws sts get-caller-identity --profile fanwire-workload --region ca-central-1`
answered `Error when retrieving token from sso: Token has expired and refresh
failed`. The human's rule was not to sign in again, so every live answer below
is UNKNOWN and is a read-only manual step in the track PR. What the repository
says, read from `origin/main` at `7c335bf`:

| Question | Live answer | Repository evidence |
|---|---|---|
| API `ACCOUNT_LIFECYCLE_ENABLED` | UNKNOWN | `'false'` in `common`, `infra/lib/app-stack.ts:149`; no `ACCOUNT_LIFECYCLE_CUTOVER_AT` anywhere in infra |
| Newest applied Alembic revision | UNKNOWN | `main`'s single head is `fd9d2851baf5` (USERS-011) over `f2b8d4a6c9e3` over `9c009a110001`. The Migration function's log group keeps one month (`backendFunction`, `RetentionDays.ONE_MONTH`), so an older run has no record; `app.migrate` logs `migrations applied` with `revision` |
| `AccountDeletionSchedule` rule, target, invocations | UNKNOWN | `rate(5 minutes)` to the `AccountDeletion` function, `retryAttempts: 0` (`app-stack.ts:304`) |
| Media bucket versioning | UNKNOWN | `QuarantineBucket` and `PublicMediaBucket` `versioned: false` (`storage-stack.ts`) |
| Consumer queue and DLQ depth | UNKNOWN | each `queueWithDlq` DLQ alarms on its first message (`messaging-stack.ts`) |
| Alarms | UNKNOWN | every function in `Fanwire-App` gets `<id>ErrorsAlarm` and `<id>ThrottlesAlarm`, derived from the construct tree, so `AccountDeletionErrorsAlarm` exists in the template |
| Signed-in `/api/users/me` | not attempted | needs the human's token |

The read-only commands that answer each row are the "Live-state reads" in the
track 6 PR body, then the activation PR.

## Activation review (track 6 deliverable 3, 2026-11-25)

Documentation only: nothing here ran against AWS (the SSO token had expired)
and nothing was switched on. Every live check is a read-only command in the
track PR's manual steps. **Today, with the flag off, `DELETE /users/me/data`
answers 503 for everyone** (`delete_account_data` raises `LifecycleUnavailable`
when the flag is off and no operation exists), so the flag is what switches
deletion on for real users. It is set in the separate activation PR, not here.

| Gate | Evidence in hand | Missing | State |
|---|---|---|---|
| 1. Schema and backfill | `9c009a110001` creates the authority tables and backfills one authority per existing profile, preserving `deleted_at` as inactive. A profile created after that, while dormant, has none, and `authority_for_sub(adopt_profile=True)` adopts it on first fence. `ready()` refuses every fenced request if the flag is on and the tables are missing | which revisions the Migration Lambda applied (its logs keep 30 days only) | UNKNOWN |
| 2. Legacy identities | after activation, `prepare_profile` adopts a Cognito identity with no authority only if Cognito's `UserCreateDate` is at or after `ACCOUNT_LIFECYCLE_CUTOVER_AT`; an older one gets `LifecycleUnavailable` (503) on profile creation. Profiles are adopted whatever their age. So the only identities at risk are pre-cutover ones with no profile: incomplete signups, or leftovers of a partial deletion | the inventory: Cognito's list (read-only command prepared) compared with production `users.cognito_sub`. No read-only tool reads production profiles; the human knows the few accounts | UNKNOWN |
| 3. Media bucket versioning | `QuarantineBucket` and `PublicMediaBucket` are `versioned: false` in `storage-stack.ts`; the worker holds `s3:DeleteObject` only | `get-bucket-versioning` on both: empty means never versioned (green); `Suspended` or `Enabled` blocks activation for a reviewed version-cleanup plan | UNKNOWN |
| 4. Consumer drain | every function runs one image and reads the flag from the same `common` env, so one deploy switches API, consumers and reconciler together. During the CloudFormation update some functions are briefly on and others off, but dormant code still fences: once the authority tables exist, `ready()` is true and `_namespace` returns the trusted issuer whenever the pool id is set, so a dormant consumer consults the same authorities. In-flight messages meet one fence or the other, never none | queue and DLQ depth before and after the deploy (commands prepared); all should be 0 | UNKNOWN |
| 5. Alarms and schedule | `AccountDeletionSchedule` is `rate(5 minutes)` with `retryAttempts: 0`; the handler raises when any operation needs a retry, so `AccountDeletionErrorsAlarm` (from the construct-tree sweep) fires on stuck work; DLQs alarm on their first message | the rule's state and target, the function's invocations and errors, the alarms' state and actions, the alarm topic's subscription (commands prepared) | UNKNOWN |
| 6. Warning copy | the dialog says images are deleted and "Backup copies expire within 7 days" (RDS `backupRetention: 7 days`, true). But `/media/*` is `CACHING_OPTIMIZED` (24 h default TTL) and nothing sets `Cache-Control` on media, so an edge can serve a deleted image for up to 24 hours. Fixed by `FRONTEND-060` (copy only, not switched on) | the human's approval of the wording | GREEN once FRONTEND-060 merges, if the wording is approved |

### What the human approves, gate by gate

1. **Schema**: read the Migration log command's output. If its newest `revision` is not `fd9d2851baf5` (or the head after this track), approve one Migration Lambda invoke right after the track deploy.
2. **Legacy identities**: read the Cognito list. For each identity with no profile created before the cutover, decide: adopt (set the cutover earlier than its `UserCreateDate`), leave it unable to create a profile, or delete it in the console. Never invent a deleted subject. If every identity has a profile, the cutover is simply the activation deploy's time.
3. **Buckets**: confirm both answer empty.
4. **Drain**: confirm every queue and DLQ is 0 just before merging the activation PR, and again after.
5. **Alarms and schedule**: confirm the rule is `ENABLED`, targets the AccountDeletion function, the function has invocations and 0 errors, and the alarms are `OK` with the alarm topic as their action.
6. **Copy**: approve or overturn FRONTEND-060's sentence.

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

USERS-006/007/008 and the other launch units stay complete; do not repeat
their migrations or manual steps. IAM fanwire-archive#370 (exact-pool
AdminGetUser and AdminUserGlobalSignOut, boundary v3) is deployed; that is not
permission for any AWS write. The AUTH-001 experiment is
[`parked/auth001-experiment.patch`](../../../.ai/tasks/AUTH-001/parked/auth001-experiment.patch),
not shipped; USERS-005's red tests were
[`parked/users005-red-tests.patch`](../../../.ai/tasks/USERS-005/parked/users005-red-tests.patch),
applied in track 6. Limits for this work are Prompts/29's and 35's.
