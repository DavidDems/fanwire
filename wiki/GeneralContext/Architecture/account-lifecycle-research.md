---
type: reference
---

# Account lifecycle: evidence and failure analysis

Design owner: [ADR 0009](../Decisions/0009-account-lifecycle-evidence.md).
This is a proposed contract and evidence analysis, not a description of shipped
protections. Execution gates belong to the [proof plan](account-lifecycle-proof.md).

## Main and the parked experiment

Main's `infra/lib/auth-stack.ts` configures Lite, email-only recovery, Cognito's
default sender, a public secretless SRP client, token revocation, one-hour ID/access
tokens and a 30-day refresh token. PreSignUp auto-confirms signup without marking
email verified. Preserve it. No PostConfirmation trigger exists.

`backend/app/users/auth.py` verifies ID JWTs locally, including `auth_time`.
`users/dependencies.py` checks profiles for active/own/optional-user paths, while
identity-only creation and deletion retry need no profile. Deactivation changes
`User.deleted_at`; recovery clears it without touching Cognito. The account
removal facade in `backend/app/account_deletion.py` locks a profile row, deletes
S3 objects, commits module cleanup, then calls AdminDeleteUser. No durable deletion
operation or independent subject tombstone survives. Missing-profile retries skip
to Cognito. Deleting the profile removes the lock target; stale ID JWTs remain a
profile-recreation risk. The proposed contract must close this, not claim USERS-008
already does.

The AUTH-001 experiment, kept as
[`parked/auth001-experiment.patch`](../../../.ai/tasks/AUTH-001/parked/auth001-experiment.patch),
is unapproved. Its finite cutoff and passing tests are
not evidence of a remote completion bound. USERS-005 remains unrelated unfinished
work. Neither parked tree is an implementation base authorized by this proposal.

## Primary evidence and limits

- [ConfirmForgotPassword API](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_ConfirmForgotPassword.html):
  public client operation, no IAM authorization, successful HTTP 200 with empty
  body; no operation identifier/status or idempotency parameter. ClientMetadata
  is caller input, not validated, stored or encrypted by Cognito. An application
  operation id in metadata is only a correlation hint: verify its durable binding
  to pool/sub/type/generation; missing metadata is allowed. Never include secrets.
- [Post-confirmation trigger](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-post-confirmation.html):
  reset and signup share the hook. Accept only `PostConfirmation_ConfirmForgotPassword`
  for reset evidence; signup must have no reset side effects. Documentation's
  administrator-created-user caveat requires separate coverage proof for any such
  accounts; the app's normal population is self-signup. The documented payload has
  no stable reset-event id, provider completion timestamp or durable replay handle.
- [Trigger behaviour and trust](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-working-with-lambda-triggers.html):
  restrict Lambda invoke permission to Cognito service, exact pool SourceArn and
  account SourceAccount. Validate expected region, pool, source and immutable
  `request.userAttributes.sub`; allow additive fields. An event-shaped JSON from
  an arbitrary invoker is not provider proof. Runtime role policies must not grant
  general direct invocation. Wrong source/pool/subject/correlation fails safely
  without touching a different identity. No HTTP ingestion endpoint is needed.
- [Cognito password recovery](https://docs.aws.amazon.com/cognito/latest/developerguide/managing-users-passwords.html):
  use native codes for verified recovery destinations. Do not set `email_verified`
  to obtain recovery eligibility. No password-history or paid-plan feature is
  needed for this choice.
- [OWASP forgot password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html):
  generic, timing-conscious request responses; account and IP abuse controls;
  normal login after reset; no account modification before valid recovery proof.
  Fanwire retains its explicit no-post-reset-email product exception. Request
  throttling can temporarily reject recovery requests without denying sign-in.
- [AWS idempotent API design](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/):
  bind request identity to intent and parameters, handle late requests, and
  distinguish a new intent from a retry. Fanwire's idempotency record cannot make
  Cognito confirmation idempotent or recover an absent provider result.
- [Transactional outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html):
  commit local authority and its work record together; consumers remain
  idempotent. This closes the local DB-to-work-notification gap, not Cognito's
  external password-change-to-trigger gap.
- [SQS/Lambda delivery](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html):
  duplicates are possible; use partial-batch failures and acknowledge only after
  durable commit. DLQs and scheduled scans recover known work. Queue retention
  expiry must not erase the operation's source of truth.
- [Cognito CloudTrail](https://docs.aws.amazon.com/cognito/latest/developerguide/logging-using-cloudtrail.html)
  and [EventBridge delivery](https://docs.aws.amazon.com/eventbridge/latest/ref/events-ref-cognito-idp.html):
  optional corroboration and alerts. Absence is not negative evidence; best-effort
  delivery cannot establish that no reset occurred. An error event must not be
  treated as successful password-change proof. Avoid ingesting/logging whole
  events because caller-populated fields may contain PII.
- [GetUser](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_GetUser.html)
  validates the caller's access token online; AdminGetUser is an IAM-authorized
  attribute lookup and not a session-liveness test. Neither provides a password
  version or a reset-operation terminal result. ID tokens cannot substitute for
  the access token. Match the returned subject to the cryptographically verified
  identity; never combine one user's ID token with another's access token.
- [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html):
  server-side session authority permits immediate local invalidation and careful
  renewal. A BFF with HttpOnly/Secure/SameSite cookies and CSRF protection can
  reduce browser token exposure, but adds migration complexity and does not itself
  solve an entirely missed password-change signal.

No reviewed primary source guarantees automatic invalidation of all sessions by
ConfirmForgotPassword alone. Do not promote an observed dev behaviour into that
contract. Trigger failure may follow a changed password: no rollback guarantee
was found. The conservative interpretation is ambiguity, not a claim that every
error changes the password.

## Durable state and reconciliation contract

Use a unique `(issuer, sub)` authority row, even without a profile. Operation and
manifest tables have bigint identity keys; externally visible operation handles
are opaque random values, not those database keys. Include type, subject,
immutable generation, request identity, stage, evidence provenance, retry state,
lease fencing and terminal result. Hash status capabilities. Do not store a hash
of a password/code either: it is unnecessary sensitive verification material.

For accepted authenticated lifecycle mutations, lock this authority row and
commit state, operation and outbox in one DB transaction before external work.
Recheck its generation before publishing data or recording worker results. A
worker lease prevents ordinary duplication; expiry only permits another worker
to inspect/retry, never proves an external call stopped. A stale worker cannot
move status backward, clear a newer fence or restore deleted state.

A scheduled, bounded scan re-enqueues unfinished durable stages, with exponential
backoff/jitter and alerts for oldest work, retries, unknown outcomes and DLQ age.
No request browser must remain open. Generic status polling requires the random
status capability; authenticated status is limited to the verified owner. A
capability never authorizes confirmation, deletion, recovery or login. Unknown
addresses get indistinguishable request/status envelopes and bounded retention;
no account-wide "reset pending" disclosure.

Reset evidence arriving without valid app correlation is still a provider reset
signal for that exact subject; it cannot complete a guessed operation or re-open
a deleted account. Record it separately. Duplicates with a proven durable event
identity are no-ops. Without one, a fresh conservative invalidation can be safer
than suppressing a real second reset, but may evict a new session. This availability
tradeoff and robust deduplication remain part of the reset proof gate. Local
monotonic generations do not manufacture provider event order or completion time.

## Failure matrix

| Boundary/failure | Durable truth and safe report | Recovery and safety obligation |
|---|---|---|
| Browser disconnects before acceptance commit | No accepted operation is promised | Retry same operation key; do not infer that a provider RPC was sent |
| Acceptance commits; response is lost | Accepted operation exists; client outcome unknown | Capability/owner status and idempotent retry return the same intent |
| Subject lookup/DB unavailable | No external destructive work; service unavailable | Retry automatically or by client after availability returns; no account-state guess |
| Forgot request/invalid code/unknown address | Generic recovery response; no account lock | Rate-limit requests; no sign-out/deactivation from unauthenticated input |
| Confirmation times out before/after provider completion | `provider_unknown`; never claim password unchanged or finished | Await authenticated completion evidence; never replay stored secrets; unresolved lost-evidence case blocks release |
| Provider HTTP 200 received, local evidence write fails | Provider success known only to the interrupted process | Trigger is independent evidence if durably received; otherwise unknown; no fictitious atomicity |
| Hook missing, invoke denied, five-second timeout or downstream enqueue failure | Password may already differ; no durable inbox promised | Alarm/corroboration; no timer unlock; missing authoritative fallback remains release blocker |
| Hook enqueue succeeds; consumer dies/DB down | Queue evidence pending, not locally enforced yet | Retry delivery then commit inbox/fence/outbox; latency gap must be accounted for before release |
| Duplicate/replayed/out-of-order hook | Never reduce authority generation or override deletion | Proven duplicates no-op; uncorrelated signals cannot complete another operation; no invented provider ordering |
| Invalid metadata or wrong pool/source/sub | No trusted matching operation | Reject/quarantine redacted counts; never act on email or metadata subject |
| Sign-out succeeds; response or stage commit lost | Tokens may be revoked; revocation stage unknown | Serialized conservative retry; late calls can revoke fresh sessions; completion/session-admission proof required |
| Deactivation DB commit rolls back | No transition or external work is accepted | Retry same key; inactive state and work cannot split |
| Deactivation/recovery races deletion | One serialized authority transition wins | `deleting/deleted` dominates; no recovery/profile recreation afterward |
| In-flight mutation authenticates before deactivation/delete | Request-start authorization is stale | Serialize/recheck generation at mutation commit; background writes must fence too |
| New signup reuses a deleted email with new sub | Different identity; old tombstone still denies old sub | Never target email for retry or inherit old personal data |
| Status capability leaked/guessed or cross-sub id requested | Capability permits minimal status only; no account mutation | High entropy, hash at rest, generic envelopes, owner authorization and rate limits |
| S3 HTTP 200 with per-key errors or partial batch | Manifest retains unfinished exact keys | Retry failed/unknown keys; no DB/identity completion claim yet |
| S3 succeeds; DB removal rolls back | Manifest and deleting authority survive; objects may be absent | Retry exact keys and module transaction; never restore active account or claim rollback restored S3 |
| DB removal commits; Cognito deletion times out | Tombstone/operation survive missing profile | Automatically inspect/retry exact-sub deletion; never fall back to email |
| Cognito deletion already happened | Exact subject absent, local work still authoritative | Absence is terminal only for identity stage; still finish S3/DB/retention obligations |
| Queue message lost/expired, DLQ or worker crash | Durable operation/manifest remains | Scheduled scan resumes; DLQ alarms supplement automatic recovery |
| Stale ID JWT after profile/identity deletion | Durable tombstone denies creation and protected use | Test every dependency path; local JWT validity cannot resurrect the account |
| GetUser outage/throttle/revoked token | Protected authorization fails closed | Retry transient failures safely; never fall back to local ID JWT acceptance |

For [S3 DeleteObjects](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObjects.html),
HTTP success can include individual errors; missing keys count as deleted. A
versioned bucket requires an explicit version-deletion plan. For
[AdminDeleteUser](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminDeleteUser.html),
retry only the immutable identity in the configured pool. The app idempotency
record and tombstone must survive provider identity removal.
