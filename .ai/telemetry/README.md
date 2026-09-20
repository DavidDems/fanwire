# Telemetry

One immutable JSON file per agent invocation:

```
.ai/telemetry/runs/<TASK-ID>/<workflow-run-id>-<role>-a<attempt>.json
```

## Write boundary

Nothing writes here except `agentctl telemetry-from-run`, called by
`.github/workflows/agent-worker.yml` in a step the agent process does not run
in. `.ai/**` is in `agentlib.guard.ALWAYS_FORBIDDEN`, so no worker can write,
amend or delete a record even if it tried — and `telemetry.record` refuses to
overwrite an existing file, so history cannot be quietly revised.

Every derived number — total tokens, duration, estimated cost — is recomputed
from the raw counts by `telemetry.py`, not taken from the caller. An agent
cannot under-report what it spent.

No LLM is involved in producing, parsing or aggregating any of this.

## Reading it

```
python .ai/bin/agentctl.py telemetry report          # totals by task, role, model
python .ai/bin/agentctl.py telemetry report --json   # for a script
```

The aggregate answers: total tokens per task, tokens by agent, tokens by model,
cost per task, attempts taken, and how often the Manager was reached. Cost is
computed from the price table in `.ai/config.json`; a model with no entry
records `null` rather than a guessed number, so an aggregate is never quietly
wrong.

A record that cannot be parsed is listed under `unreadable` rather than
silently skipped.

## Record shape

```json
{
  "schema": 1,
  "task_id": "DEMO-001",
  "workflow_run_id": "17352019481",
  "role": "code_agent",
  "provider": "anthropic",
  "model": "claude-sonnet-5",
  "session_id": "sess-abc123",
  "attempt": 2,
  "started_at": "2026-09-20T10:00:00Z",
  "ended_at": "2026-09-20T10:04:30Z",
  "duration_seconds": 270,
  "input_tokens": 12000,
  "output_tokens": 3000,
  "total_tokens": 15000,
  "estimated_cost_usd": 0.225,
  "result": "completed",
  "commit_sha": "deadbeef",
  "ci_run_id": "17352019999"
}
```

`session_id`, `commit_sha` and `ci_run_id` may be `null` — they are not always
known. Everything else is required, and a record missing one is rejected.
