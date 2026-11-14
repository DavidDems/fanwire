# AUTH-001: password confirmation and Cognito code recovery

Prose for the Manager. The contract is `task.json`.

## Stop gate and merge order

[ADR 0009](../../../wiki/GeneralContext/Decisions/0009-account-lifecycle-evidence.md)
replaces the provisional reset-cutoff architecture. Read its
[evidence and failure matrix](../../../wiki/GeneralContext/Architecture/account-lifecycle-research.md)
and [proof/deployment plan](../../../wiki/GeneralContext/Architecture/account-lifecycle-proof.md).
Merge this Director specification/ADR amendment first. **Its merge alone does
not authorize implementation.** The entirely lost/late provider-completion and
revocation proof gate remains unresolved. Obtain authoritative evidence or a
further human-reviewed architecture amendment, then merge exact scope/IAM
prerequisites before any implementation resumes or a dependent AUTH-001 PR opens.
State this order in each PR. No timer unlocking or manual-only recovery is
approved. Do not change task state, allowed paths, policy or product code here.

The parked AUTH-001 experiment is unapproved/unshipped. It is kept, whole, as
[`parked/auth001-experiment.patch`](parked/auth001-experiment.patch): local
branch `agent/AUTH-001` at `fanwire-archive@54fdb6735835d975f375625afa22d3930fefbe2f` plus the
14 files that were uncommitted in its worktree, as one diff against `fanwire-archive@092175c`.
It leaves out the branch's hand-start `state.json`, so this task reads as DRAFT.
It applies to `fanwire-archive@092175c` exactly, and not to later `main`, where USERS-009
changed `backend/app/users/`. Read it as reference; do not apply or resume it
blindly. Previous passing backend tests and two subsequently repaired but
unrerun frontend failures are historical evidence, not security approval.

## Product requirements retained

- Native Cognito `ForgotPassword`/`ConfirmForgotPassword` codes to verified email
  through the current default sender. Optional verification for ordinary use;
  static verification-required reminder on recovery. Never mutate
  `email_verified` to permit reset.
- No SES/custom reset links or tokens, separate post-reset email, password-history
  checks, comparison with the old password, or paid Cognito-plan requirement.
  Codes and passwords remain transient and absent from logs, telemetry, queues,
  operations, metadata, validation responses and URLs.
- Known, unknown, disabled and unverified addresses get the same request status,
  body and generic UI message. Use timing-conscious handling and durable account
  and source-IP limits, at most five requests/hour per key. Never lock an account
  because an unauthenticated forgot request or invalid code arrived.
- Signup and reset have labelled Password/New password and Confirm password
  fields. Mismatch is accessible and makes no provider submission. Cognito owns
  its password policy and code expiry/use/attempt controls. Require normal login
  after recovery; never automatically authenticate the reset flow.
- Keep the sign-in Forgot password link and recovery email/code forms. Account
  settings starts with Account details: Email value and a Password row whose
  Reset password button opens the same route. Await sign-out and session clearing
  before enabling recovery submission for an initially signed-in visitor.

## Proposed security foundation and unresolved reset boundary

Use an independent immutable-sub authority row and durable operations rather than
profile-row existence as the security source of truth. Deactivation/recovery are
serialized local state transitions; deletion commits a tombstone and cleanup
manifest before irreversible work, then automatically reconciles S3, database and
exact-sub Cognito stages. This wider work needs separate scoped units; current
AUTH-001 paths do not authorize it.

A PostConfirmation reset hook is positive provider evidence only when trusted and
durably received. The candidate ingress/consumer/outbox design handles duplicates,
consumer failures and known-work recovery; it does not prove an entirely missing
hook can be recovered. Public-client direct confirmation can bypass a backend
wrapper. ClientMetadata is untrusted correlation, never proof or secret storage.
There is no selected finite timeout, cutoff or manual unlock policy.

Do not call Cognito confirmation from a replay queue containing password/code.
A request operation may have `provider_unknown` status without changing account
access. An earlier timed-out call may still finish: a later invalid-code response,
new login or user-modification timestamp cannot settle it. Automatic reconciliation
must use authoritative evidence and safe stage-specific retries. A status
capability grants minimal generic status only, with no account/reset authority.

Local ID JWT verification cannot observe revocation or identity deletion. Online
GetUser with a verified matching access token is an evaluated defence, distinct
from IAM AdminGetUser; it does not prove reset completion. Global-signout retries
can revoke fresh sessions, so late calls and admission ordering also require
proof. Managed sessions need server-side invalidation and do not solve unseen
provider events by themselves. The proof plan names release-blocking cases.

## Scope, testing and rollout

Existing IAM fanwire-archive#370 (deploy `42437556488` at `fanwire-archive@00933ce`, boundary v3) and scope
fanwire-archive#375/#376 are complete prerequisites. Do not repeat writes. Required future
scope includes the deletion facade, background consumers, token transport and
infra, which this task cannot widen itself. Check every eventual acceptance
criterion against the merge-ref allowlist and role guard before tests start.

Keep the AUTH-001 bundle declaration path; predeclare lazy outputs/entry growth
in failing tests and freeze budgets during implementation. Write/commit tests
first, implementation separately, then Director review/reproduction/mutation
checks and applicable container suites. Never claim a timer experiment proves a
remote completion bound. Provider/browser proof needs explicit dev-write approval;
report missing rows as NOT DONE. Deployments, migrations, IAM changes and live
user-data operations remain separately approval-gated; this research grants none.
