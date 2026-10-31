---
type: decision
---

# 0003 - Require a red baseline to fail for the right reason

Decision: 2026-10-08, the human's workflow-review fix queue (D4),
implemented on 2026-10-09.

## Context

A failed CI baseline alone does not show that newly committed tests pin the
requested behaviour. Dispatched CI runs every suite: an audit vulnerability,
OpenAPI drift, an unrelated broken test or a tree-scan failure can all make
it red. Letting that result open implementation spends the code agent's
bounded attempts on failures it cannot repair, especially when the fault is
in a test file the dispatched code agent is forbidden to edit.

## Choice

Use the deterministic `ciresult.baseline_verdict` to classify baseline
failures from the run's jobs and failed-job log. The orchestrator obtains
those inputs and passes them as files; a model does not decide whether red
qualifies.

Failures must be attributable to files changed by the test agent's commits,
including every commit recorded from `TEST_AGENT_RUNNING`. Unrelated failed
jobs, failures outside those files, cancellation and unreadable or incomplete
evidence must fail closed. A qualifying test failure may be a collection or
import error caused by the intended implementation not existing yet.

Keep D5's static-check distinction: type-check failures in changed test files
qualify only with a failed test job. A type error alone proves no failing
test; a lint failure never qualifies, because its repair would require an
edit the code agent cannot make.

Enforce classification in `agentctl state advance`. An independently supplied
`CI_FAILED` must not bypass it: unqualified red becomes
`CI_FAILED_WRONG_REASON` and routes to `MANAGER_REVIEW`, with
`red_baseline_wrong_reason` identifying the cause. This gives the manager the
same opportunity to re-scope or escalate as a green baseline, instead of
opening implementation on incidental red.

## Consequences

The baseline gate needs complete, parseable evidence and the test commits'
changed-file set; missing evidence stops automatic implementation. Its
parser and CI job classification therefore form part of the gate's safety
contract. The decision protects against incidental failure, while the
remaining limitations require separate work and evidence.

The [state-machine reference](../../../.ai/docs/state-machine.md) owns the
classification rules and transition protocol; the
[operations runbook](../../../.ai/docs/operations.md) owns recovery.
This extraction changes neither implementation nor live-proof status. The
retained [defect review](../../../.ai/docs/handoff.md#101-defects) records the
unproven cases and residue.

The original defect narrative and implementation evidence, including the
`MEDIA-002` baseline fixture, job-list synchronization test and failed-log
prefix correction, remain in the
[immutable source revision](https://github.com/DavidDems/fanwire/blob/23211267285437e09211460934b62f89026ab2ac/.ai/docs/handoff.md#101-defects).
