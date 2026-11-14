---
type: decision
---

# ADR 0009: Evidence before account lifecycle completion

## Context

AUTH-001's parked implementation is unapproved and unshipped. A finite reset
cutoff cannot cover an unbounded remote completion. Main verifies ID JWTs
locally; USERS-008 removes the profile before Cognito deletion and has no durable
subject tombstone. An old ID token can recreate that profile. Deactivation is
reversible application state, not Cognito account deletion.

## Decision proposed for human review

Adopt a durable lifecycle record and retryable cleanup as the foundation. Reject
timer unlocking and manual-only recovery. **This ADR does not approve a complete
password-reset architecture or release AUTH-001's implementation stop gate.**
Merge this Director amendment first; then obtain the missing provider evidence
or approve a different architecture in another Director amendment, with exact
scope prerequisites, before any implementation resumes or AUTH-001 PR opens.

Keep native verified-email Cognito recovery codes, optional email verification
for ordinary use, a static verification reminder, and normal sign-in after reset.
No SES/custom reset tokens, password history, post-reset email or paid-plan
requirement. This supersedes ADR 0007's custom unverified-address recovery choice;
its historical rationale stays intact.

### Durable account authority

Key security state by configured issuer/pool plus immutable Cognito `sub`, never
email, aliases or profile id. Use bigint identity primary keys and a unique
subject key. Keep `active`, `inactive`, `deleting`, `deleted` and a monotonic
security generation independent of profile lifetime. A deletion tombstone wins
over recovery/reset events. Consult it on every authenticated path, including
profile creation, optional identity reads and deletion retries; lookup failure
fails closed. Public guest reads remain available without identity.

An authenticated, recently reauthenticated deactivation commits inactive state
and its operation record together. It hides the account immediately; repeated
requests preserve the first transition. Keep Cognito enabled so the owner can
sign in to recover. Recovery is an explicit authenticated transition, serialized
against deletion; deletion cannot be undone by recovery. Do not silently expand
the existing recovery reauthentication requirement in this research PR.

For hard deletion, recent authentication authorizes one durable operation. Before
external removal, commit `deleting`, the owner subject, immutable cleanup manifest
and work item together. Serialize competing account mutations through that
subject record, including when no profile exists. Block uploads/publications and
make existing background consumers respect the tombstone. Delete exact owned S3
objects, inspect per-key errors, remove local personal data through module
interfaces in one transaction, and delete the exact Cognito identity last. Keep
minimal tombstone/status after profile removal. Record each completed stage;
automatically resume unfinished stages from durable state after crashes, queue
loss or browser departure. No account recovery can resurrect deleted state.
Object versions, outstanding uploads, CDN copies and backups require explicit
retention/cleanup proof before claiming all personal data erased.

### Password-reset evidence boundary

`PostConfirmation_ConfirmForgotPassword` is useful positive evidence from the
provider, not a transaction coordinator. The documented post-confirmation hook
also serves signup; reset handling must select the exact source and trusted
pool/subject. Its delivery is synchronous with a five-second response deadline,
conditional retries, and some invocation failures without retry. There is no
published exactly-once, durable replay, atomic rollback or completion-query
contract in the reviewed sources. Treat trigger errors/timeouts as potentially
changed-password outcomes, not proof of rollback. [AWS post confirmation](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-post-confirmation.html),
[AWS trigger behaviour](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-working-with-lambda-triggers.html).

Candidate: the hook durably hands minimal evidence to a dedicated queue; an
idempotent consumer commits an inbox record, revocation work and account fence
before acknowledging. A scheduled reconciler scans durable work even if queue
notifications disappear. An API's recorded successful confirmation is an
independent evidence path. However, the interval before consumer commit and a
hook that never runs remain security gaps. Queue durability starts only after
successful enqueue. CloudTrail/EventBridge is supplementary, best-effort evidence,
not a guaranteed replacement. [AWS EventBridge](https://docs.aws.amazon.com/eventbridge/latest/ref/events-ref-cognito-idp.html).

Never lock or change an account merely because an unauthenticated forgot request
or invalid code arrives. Persist an attempt/status record without changing
account authority. Never queue passwords/codes or retry confirmation from stored
secrets. A timeout is `provider_unknown`; a later code mismatch, successful new
login, elapsed time or `UserLastModifiedDate` does not prove the old call ended.
A new attempt must not silently overwrite unresolved work. [OWASP recovery](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

**Release-blocking question:** what authoritative, recoverable provider fact
closes a completely lost completion event and late completion, without an
unauthenticated account lock? Reviewed AWS APIs do not expose an idempotency key
or queryable ConfirmForgotPassword operation. Obtain a documented AWS guarantee
or approve an architecture with a provable independent enforcement boundary.
An observed development test is not that guarantee. If neither is available,
reset remains blocked; indefinite user lock plus an operator runbook is not the
selected solution. A fully managed session implementation alone cannot infer a
provider password change it never learns about.

### Revocation and user-visible status

Locally verified JWTs cannot detect provider revocation. Prefer evaluating
access-token authentication with an online `GetUser` check plus durable account
state as defence in depth. Validate issuer, client, token type, expiry and subject;
`GetUser` uses the user's access token and required scope, not IAM. It proves token
liveness, not reset completion. It adds a provider dependency to every protected
request and is conditional on latency/quota proof and approved scope changes.
[AWS revocation](https://docs.aws.amazon.com/cognito/latest/developerguide/token-revocation.html),
[AWS GetUser](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_GetUser.html).

Global sign-out invalidates refresh and provider-checked sessions; it does not
make raw ID JWT verification safe. Serialize sign-out retries; their late
completion can also invalidate newly created sessions. Do not admit a replacement
session while an applicable revocation remains uncertain. Do not advance an
operation to complete on lease expiry. Managed-login cookies, if introduced,
need separate logout handling. [AWS global sign-out](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminUserGlobalSignOut.html).

Return an opaque operation id and separate random status capability after durable
acceptance; hash the capability at rest. It authorizes only generic status, never
account access or reset. Repeated authenticated operations use the same key and
payload identity; conflicting reuse fails. Status distinguishes accepted,
in-progress, provider-unknown, retrying and completed without claiming that
browser timeout cancelled provider work. Unauthenticated recovery responses must
not reveal existence, verification, delivery, subject or provider diagnostics.

## Consequences

Automatic reconciliation is required for every recoverable, durably known stage;
alerts and rare operator escalation supplement it. Unknown provider completion
is explicitly unresolved, not an invented automatic-recovery guarantee.

Future Director scope/IAM/deployment work must precede unit code. No policy,
allowed-path expansion, task-state change, dependency, AWS write or deployment
is authorized here. The [research and failure matrix](../Architecture/account-lifecycle-research.md)
and [proof/deployment plan](../Architecture/account-lifecycle-proof.md) define
the remaining evidence and review gates. Main's current limitations remain until
separately implemented and deployed fixes pass those gates.
