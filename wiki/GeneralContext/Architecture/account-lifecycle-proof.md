---
type: runbook
---

# Account lifecycle proof and rollout gates

Owner: [ADR 0009](../Decisions/0009-account-lifecycle-evidence.md).
Use the [failure matrix](account-lifecycle-research.md) as the test inventory.
This procedure prepares future work; it authorizes no AWS writes or deployment.

1. **Approve the design amendment before implementation.** Merge the Director
   specification/ADR PR first. Keep AUTH-001 stopped afterward until the provider
   gate below is resolved and its own Director amendment/scope prerequisites have
   merged. Record that order in each dependent PR. Preserve the parked experiment
   and USERS-005. Do not change task state on a Director branch.

2. **Resolve the reset provider gate.** Obtain primary AWS documentation or a
   precise AWS response addressing: when the password changes relative to
   PostConfirmation; rollback after trigger error; missing-invocation recovery;
   durable completion identifiers/status; old access/refresh token revocation;
   and sign-out/confirmation calls that finish after caller timeout. Specify the
   guarantee's scope, accounts, app clients and allowed bypass paths. No evidence
   currently establishes all of these. A dev experiment measures behaviour only.
   Without authoritative independent enforcement/reconciliation evidence, propose
   another reviewed architecture; do not ship timer/manual-only recovery or
   claim this procedure resolves unknown completion.

3. **Approve exact future scope before authoring tests.** Compare every path
   against the merge-ref task and the worktree's guard. AUTH-001 currently omits
   critical lifecycle surfaces. Define separate Director prerequisites/units for:

   | Responsibility | Candidate affected paths; exact allowlist still required |
   |---|---|
   | Authority, operations, migration | `backend/app/users/**`, `backend/app/dependencies.py`, `backend/app/settings.py`, `backend/alembic/versions/**`, `backend/tests/users/**`, `backend/tests/test_route_auth.py` |
   | Deletion orchestration and module consumers | `backend/app/account_deletion.py`, `backend/tests/test_users_data_deletion_contract.py`, `backend/tests/test_users_data_deletion_route.py`, `backend/tests/test_migrations_users_data_deletion.py`, `backend/tests/users/test_account_deletion_contract.py`, `backend/tests/media/test_account_deletion_scan_race.py`, `backend/app/media/**`, `backend/app/posts/**`, `backend/app/notifications/**`, associated tests |
   | Token transport and online validation | `frontend/src/auth/**`, `frontend/src/api/client.ts`, `frontend/src/api/client.test.ts`, account/routes tests, generated `backend/openapi.json` and `frontend/src/api/schema.d.ts`, bundle declaration |
   | Trigger/queue/worker/schedule and role policies | `infra/lib/auth-stack.ts`, `infra/lib/app-stack.ts`, `infra/lib/messaging-stack.ts` if reused, `infra/bin/**` if wiring changes, exact `infra/test/**` |
   | Permission ceiling and deployment | `infra/iam/**`, applicable boundary/execution-role tests and deployment documentation |
   | Current facts after implementation | Users/Frontend/media/posts module references; Director-owned Standards/FrontendUI changes separately |

   Resolve nonexistent candidate paths against the selected design before making
   an allowlist. This PR does not widen `allowed_paths` or policy. Keep manifest,
   lockfile and Docker changes on reviewed Director branches if later required.

4. **Prove the local state machine first.** Commit failing tests alone on the
   intended interfaces. Use real PostgreSQL for competing operations, unique
   constraints, transaction rollback, no-profile subject locks and stale-worker
   fencing. Exhaustively permute reset/deactivate/recover/delete; deletion wins.
   Inject crashes before/after every DB commit, external call and queue ack.
   Run a scheduled reconciler with dropped notifications and expired leases;
   require automatic progress for recoverable known stages. Never unlock on a
   lease or age threshold. Prove authorization checks remain effective when a
   request authenticates before a concurrent lifecycle commit: mutation commit
   rechecks/fences, rather than assuming a request-start lookup is sufficient.

5. **Prove provider evidence and secret handling.** Stub timeouts with provider
   completion arbitrarily later; prove that no finite timeout implies completion.
   Reject wrong invoke source/pool/subject; ignore signup sources. Test missing,
   forged, replayed and cross-sub metadata, absent event ids, duplicate delivery,
   reverse event order, and a completely missing hook. Test independent API-200
   evidence and loss before persistence. Scan validation errors, logs, traces,
   queues, manifests and telemetry for passwords, codes and tokens. Capture only
   redacted flags/counts. An unknown unauthenticated reset attempt creates no
   account lock and is not represented as a completed safe reset.

6. **Prove revocation and deletion boundaries.** Verify ID/access token mismatch,
   scope/client/issuer/token-type checks, revoked/expired tokens, no-profile
   tombstones, same email with a new sub, and provider outages. Show that a raw
   locally verified JWT can pass after revocation, while the proposed boundary
   denies it. Test partial S3 errors, versions, DB rollback after S3 success,
   identity timeout/success/later NotFound, concurrent uploads and late media
   processing. Verify cleanup manifest ownership and surviving other authors'
   dependants. Include backups/CDN retention in the erasure claim.

7. **Review infrastructure, IAM and cost before rollout.** A minimal candidate
   keeps the short, non-VPC ingress trigger and its dedicated queue/DLQ in
   AuthStack; AppStack imports the queue for a VPC-backed consumer/reconciler.
   Preserve existing PreSignUp and every pool/client setting. Avoid an AuthStack
   to AppStack to AuthStack dependency cycle. A direct-DB trigger is an alternative
   requiring VPC/DB access and five-second cold-start/connection proof, not an
   automatic choice. Neither topology closes a lost pre-enqueue event.

   Require exact pool/account invocation conditions; ingress role only queue
   SendMessage, its log streams and CMK access; worker only selected pool
   AdminGetUser/AdminUserGlobalSignOut/AdminDeleteUser, exact S3 objects and
   queues, DB/network access and logs. Schedule only invokes the reconciler.
   Inspect role-boundary and CloudFormation execution-policy deltas plus
   synthesized policies. GetUser has no IAM grant: it uses an access token.

   Budget additional Lambda requests/GB-seconds, SQS requests, KMS, log/alarm,
   scheduler, DB connection/IO/storage, S3 version cleanup and network costs.
   For a five-minute scheduled scan, 30 days means 8,640 executions even with no
   operations. Calculate region-specific totals from measured memory/duration,
   queue polling/retries and retained bytes, including shared free-tier usage;
   no fixed dollar promise is justified here. Lite supports the retained native
   flow; no upgrade is selected. Online GetUser adds protected-request latency,
   outage exposure and regional/account quota usage; avoid a positive cache that
   silently creates a revocation window. Review actual peak quota headroom. AdminGetUser calls count toward Cognito MAU billing; account for the subjects polled by reconciliation rather than assuming inactive users are free ([API billing note](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminGetUser.html)).
   Sources: [Cognito pricing](https://aws.amazon.com/cognito/pricing/),
   [quotas](https://docs.aws.amazon.com/cognito/latest/developerguide/quotas.html),
   [Lambda](https://aws.amazon.com/lambda/pricing/),
   [SQS](https://aws.amazon.com/sqs/pricing/),
   [EventBridge](https://aws.amazon.com/eventbridge/pricing/).

8. **Obtain scoped approval for dev-only provider proof.** No writes are approved
   now. Future approval must name throwaway dev identities, pool, trigger/client
   changes, failure injection and cleanup. Test direct public-client confirmation,
   missing/failed/slow trigger, late completion, normal recovery and old/new
   access/refresh tokens; preserve existing fwtest identities. Use Chrome/Chromium
   and sign out afterward. Report unsupported cases as NOT DONE; do not treat a
   finite successful run as a delivery or timing guarantee.

9. **Run gates and roll out additively after all approvals.** Director reruns
   container backend/frontend suites, infra build/lint/tests/synth, security
   review and relevant mutation tests. Strip every GIT_* variable in .ai test
   subprocesses. Use the shared heavy lock and at least 2 GB free RAM. Separate
   reviewed IAM/boundary prerequisites before the normal human-approved deploy;
   use the existing Migration Lambda procedure only with explicit approval.
   Create/backfill authority tables and a single Alembic head before enabling
   code that requires them. Historical deleted subjects cannot be reconstructed
   from removed profiles: inventory evidence or retain an online provider
   existence/session check; never invent a complete tombstone backfill.
   Stage dormant workers/schema, verified triggers and observability before
   enabling lifecycle endpoints. Keep pending operations/fences during rollback;
   never revert to accepting raw JWTs as an availability workaround. Verify
   deployed role/trigger config, alarms, reconciliation and public health before
   declaring readiness. No production/user-data operation is authorized by this
   document. No manual action is needed during the research PR.
