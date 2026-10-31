---
type: decision
---

# 0004 - Require lint and type checks before merge

Decision: 2026-10-08, the human's workflow-review fix queue (D5),
implemented on 2026-10-09.

## Context

Passing application tests did not establish that the frontend type-checked
or linted: its test image ran Vitest, while TypeScript first ran during
deployment after merge. Backend lint and type errors were also outside CI's
required checks. Hand-run sessions performed those checks themselves, but a
dispatched worker could not run them. The same change therefore received
different validation depending on who ran the unit.

## Choice

Make four quality jobs required in the repository's authoritative CI:
`backend-ruff`, `backend-mypy`, `frontend-typecheck` and `frontend-lint`.
Run them in the corresponding suites' images, with mypy scoped to `app`.
Clear the existing backend lint and type debt rather than exempting it from
the checks. The original implementation required no dependency addition.

Preserve the baseline classification boundary owned by
[ADR 0003](0003-red-baseline.md). A type-check error can accompany a qualifying
failed test, while lint red cannot open implementation. Required quality jobs
must not become an alternative to tests that demonstrate missing behaviour.
The [state-machine reference](../../../.ai/docs/state-machine.md) owns the
classification protocol; the
[test workflow](../../../.github/workflows/test-agent.yml) owns job execution.

## Consequences

A test pass alone no longer permits a merge with lint or type errors. The
additional jobs also become inputs to red-baseline classification, so their
names and failure interpretation must stay consistent with that protocol.
Keeping their tools in the suite images aligns automated validation with the
environment that runs the tests.

This extraction changes neither required checks nor their implementation.
It does not establish new runner evidence or resolve parser, formatting or
worker-tooling limits. The existing proof gaps, residue and historical tool-pin
correction remain in the
[defect review](../../../.ai/docs/handoff.md#101-defects).

The original rationale, backend findings and fixes, including the malformed
notification-reference handling, remain in the
[immutable source revision](https://github.com/DavidDems/fanwire/blob/c6af661ef1dd6fef0a9eb0f0042c38beee65a425/.ai/docs/handoff.md#101-defects).
