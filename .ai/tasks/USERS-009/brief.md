# USERS-009: durable account lifecycle and automatic deletion recovery

Prose for the Manager. The contract is `task.json`.

## Authority and scope

The human approved the ADR 0009 foundation after merging fanwire-archive#378. This unit covers
account authority, deletion tombstones, durable operation/status and automatic
reconciliation together. AUTH-001 stays stopped. Do not edit its parked branch,
14-file experiment, USERS-005 or other tasks. Merge this Director specification
PR first, then start USERS-009 test-first from fresh main. This scope is not an
AWS write, deployment or production-data approval.

One complete backend slice avoids deploying a deleting marker whose only recovery
is another browser request. Use existing PostgreSQL and boto3, one shared deletion
runner, and a five-minute EventBridge Rule invoking a dedicated Lambda DB scan.
No queue, generic workflow platform, new dependency, frontend redesign, password
reset trigger, online GetUser/access-token migration or global-signout workflow.
The existing role policy permits app/migrations/infra and tests/module references;
this spec narrows those roles. No policy expansion is selected. If synthesized
IAM shows an uncovered ceiling, stop for a separate Director prerequisite.

Preserve the pinned absence of Lambda reserved concurrency: work claiming and
fencing live in PostgreSQL, not an account quota. Do not weaken the deployment
quota rationale in infra/test/app-stack.test.ts or request a quota increase. Add
the reconciler Errors/Throttles alarms and deliberately extend the pinned
function/alarm count and rationale in infra/test/alarms.test.ts, retaining its
full coverage assertions.

## Concrete contract

`users/lifecycle.py` owns the public lifecycle interface and authority/operation
primitives; models remain in `users/models.py`. The cross-module deletion facade
remains `app.account_deletion`, and the new scheduled entry point is
`app.account_deletion_handler.handler`. Other modules use the users interface;
they must not import its tables to bypass ownership boundaries.

The configured, trusted issuer/pool and immutable sub identify the authority.
Record and lock it even when no User exists. Every table has a bigint identity
primary key; opaque externally returned operation handles are separate random
values. Deleting/deleted is irreversible. Keep User.deleted_at consistent with
active/inactive/deleting visibility so existing public readers keep hiding the
account. A stable lock order and commit-time generation check close the gap
between request-start authorization and concurrent account deletion. Include
both actor and affected identity fencing for notifications/follows; do not block
unrelated owners or erase their replies/reposts.

One durable deletion intent per subject survives every retry. Atomically commit
its deleting fence, exact immutable cleanup manifest and due-work record before
external work. This database work record is the outbox. Snapshot through module
interfaces, including deterministic possible output keys for every owned media id,
not merely non-null keys recorded before an interrupted publisher writes them.
Never delete an arbitrary prefix or accept client bucket/key/subject input.

The runner advances exact-object S3 cleanup, module-owned local removal in one
transaction, then exact-sub Cognito deletion. A provider-absent response only
settles the provider stage. A timeout or expired lease cannot settle an external
call. Fenced stage writes must survive retries and reject stale results; known
S3 and exact-sub delete calls are safely repeatable without storing secrets.

The scheduled scan automatically finds unfinished work after client/worker loss.
Use bounded pagination, fairness, retry backoff and a durable next-attempt field.
A poison operation cannot starve others. Retain minimal terminal authority and
manifests for automatic late-object cleanup; URL expiry and caller timeout do not
prove in-flight S3 writes ended. Media publication checks/fencing and compensating
cleanup stop local resurrection, while retained exact-key sweeps remove later
arrivals. No timer clears the tombstone or discards cleanup obligations.

## HTTP and current client compatibility

Keep DELETE /users/me/data and its recent-auth requirement. Return 204 only once
the required app/object/provider stages are durably completed; never return 202
because the existing frontend treats any successful status as completed deletion.
Accepted-but-pending or retryable failures return generic 503, Retry-After and a
stable opaque operation handle/Location; the old client retains its failure/retry
behaviour and cannot announce success or clear its session on this response.
The browser need not retry for the backend operation to progress.

Add authenticated GET /users/me/data-operation before the dynamic user route.
It exposes only the verified owner's opaque operation_id and generic
in_progress/retrying/completed state; 404 means that owner has no operation.
The narrow identity dependency permits status and deletion retry with an otherwise
valid same-sub token even after profile removal; it cannot unlock account writes.
Expired/invalid tokens stay 401. No unauthenticated status, reset capability,
provider diagnostics or frontend status-polling feature is included. Regenerate
OpenAPI and TypeScript types; the existing account-client test proves 204/503
compatibility. New frontend runtime outputs/bundle growth are not selected.

## Migration and activation gates

Add one additive Alembic revision from the current single head and backfill extant
profiles preserving inactive timestamps. Configure trusted namespace for API,
media, notifications and reconciler; fail closed on missing schema/config after
activation. Dormant schema deployment is not the completed security feature.
Before activation, separately review a cutover/drain procedure that migrates and
backfills before new code depends on it, prevents old handlers/consumers from
bypassing the fence, verifies roles/schedule/alarms and never rolls back to legacy
deletion after accepted operations exist. No such production procedure runs now.

Historical removed profiles cannot reconstruct deleted subjects. An absent
profile plus a provider identity can be incomplete signup or old partial deletion;
fresh login/modified time does not prove which. The release gate must inventory
available evidence and obtain human approval for concrete legacy adoption or
remediation. Do not silently deny legitimate old incomplete-signup users or claim
historical resurrection solved by a backfill of current profiles. This rare
migration gate is separate from automatic recovery of ordinary newly accepted
operations; it does not make routine deletion operator-dependent.

Both media buckets are configured unversioned. Verify live configuration under a
separately approved rollout check. If it differs, block activation for a reviewed
version-cleanup plan, not speculative DeleteObjectVersion grants. Public CDN and
backup retention are not instantaneous erasure: retain existing seven-day backup
limit and evidence actual CDN/quarantine limits. Any required warning/copy change
gets exact frontend scope and review before activation; no false stronger erasure
claim is authorized. A 204 represents logical deletion and successful current
exact-key cleanup; late-key/retained-copy obligations remain automatically enforced.

## Proof and review

Use real PostgreSQL for uniqueness, rollback and concurrent fencing. Inject
crashes before/after every durable/external boundary, dropped wakeups, stale
workers, duplicate scans, S3 per-key errors and late known-key writes. Test
profile resurrection, owner status isolation, recent-auth limits, inactivity,
recover/delete/mutation/consumer races, provider NotFound, browser loss and
scheduler-only completion. Finite observed timing is never a remote completion
proof. Preserve every existing USERS-008 privacy/other-author invariant.

Director reruns full applicable backend/frontend containers, infra
build/lint/test/synth and a focused security review, plus meaningful fault/race
mutations. Every GIT_* variable is stripped from .ai test subprocesses. Heavy work
uses the shared lock at the authorized 2 GiB free-RAM floor. Future dev-pool or
browser writes need explicit scoped approval; evidence not obtained is NOT DONE.

The five-minute schedule makes 8,640 invocations per 30-day month before retries.
Budget Lambda duration/memory, DB connections and scan/index IO, log/alarm usage,
S3 deletions and ongoing retained-manifest sweeps. Bounded scans and a capped
maintenance backoff prevent unbounded per-invocation work; measure actual traffic
before any dollar promise. Existing IAM ceilings appear sufficient but the unit's
synthesized least-privilege tests decide. No SES, queue or paid Cognito tier cost.
