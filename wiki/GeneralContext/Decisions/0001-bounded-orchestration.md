---
type: decision
---

# 0001 — Bounded orchestration and a human escalation exit

Decision: 2026-10-08, the human's workflow-review agreement (D3).

## Context

The review found two related failures: an invocation could repeat without
consuming a recorded budget, and a task could stop progressing without a
recorded outcome. Cancellation before a model call stranded running states;
orchestrator errors could skip persistence; unexpected CI conclusions were
ignored. A worker could start before its dispatch transition was committed.
Recovery instructions also named events that were illegal from escalation.

These are orchestration failures, not reasons to spend another code-agent
attempt. Their handling must be deterministic and reconstructable from state,
with a bounded retry path and an explicit human recovery path.

## Choice

- Count every manager invocation in history through `DISPATCH_MANAGER`.
  Enforce `MAX_MANAGER_INVOCATIONS` at three; an invocation beyond that cap
  escalates rather than returning to an unrecorded loop.
- Persist each transition before dispatch: advance, commit and push the state,
  then invoke the worker or CI. Record dispatch identity and timing in
  `last_dispatch`, and CI identity and disposition in `last_ci_run`, so a
  lost result can be reported as `STALLED` instead of disappearing.
- Route landing outcomes even when the model job fails or is cancelled, using
  the workflow's always-run landing path. A failed invocation or an
  unappliable result records `AGENT_FAILED`. Apply a result only from its
  role's own running state; a late failure must leave `ESCALATED` with the
  human rather than reopen work.
- Classify every documented CI conclusion and fail closed on unknown ones.
  Test verdicts advance the test workflow; outcomes that are not test
  verdicts, and failed orchestrator action steps, escalate. Apply D1's trusted
  verdict rule to the branch tip.
- Discard a CI result while the task is paused, record that it was not
  applied, and provide a deliberate replay procedure. Resuming must not
  silently pretend that a discarded result advanced the state.
- Make `MANAGER_RETRY` and `MANAGER_RESCOPE` legal from `ESCALATED` as a
  human's recovery events, supplied only by an orchestrator dispatch. A
  worker applies its result from its expected role state; a late worker
  cannot use the human's escalation exit.

## Consequences

Missing or failed actions become visible state or escalation instead of
unbounded calls or silent stalls. A manager cannot extend its own invocation
budget indefinitely, and dispatch persistence removes the race between a
worker checkout and the state that authorized it. Recovery is explicit rather
than an automatic return from a human-owned escalation.

The executable protocol and event meanings belong to the
[state-machine reference](../../../.ai/docs/state-machine.md), including its
manager-decisions and bounded-and-detectable sections. Human replay and
recovery steps belong to the
[operations reference](../../../.ai/docs/operations.md). This record does not
claim that every failure route has been exercised live or that the separate
timeout, baseline-recovery and late-worker limitations are fixed.

The original review evidence and agreement remain in
[the source revision](https://github.com/DavidDems/fanwire/blob/05d644017f57c69e453e98d7d49d44d875d5dab1/.ai/docs/handoff.md#103-agreed-by-the-human-2026-10-08).
