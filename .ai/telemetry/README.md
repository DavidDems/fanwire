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

Every derived number — total tokens, duration, the estimate, which cost is
used — is recomputed by `telemetry.py`, not taken from the caller.

## Cost: the provider's figure, an estimate only as a fallback

`claude --print --output-format json` ends with an envelope that states what
the call was billed (`total_cost_usd`) and every token it was billed for,
cache reads and writes included. `invoke_agent.sh` carries that into the
normalised result, and the record keeps it:

| field | meaning |
|---|---|
| `provider_cost_usd` | the envelope's `total_cost_usd`; `null` if it had none |
| `estimated_cost_usd` | tokens × `.ai/config.json` `telemetry.prices`, cache tokens included; `null` when that cannot be done honestly (an unpriced model, cache tokens with no cache price, cache writes the provider did not split by duration) |
| `cost_usd` | `provider_cost_usd` when there is one, else `estimated_cost_usd` |
| `cost_source` | `"provider"` or `"estimate"` — which one `cost_usd` is |

A caller cannot set `cost_usd` or `cost_source`; both are derived. The
estimate is recorded beside the provider's figure so the two can be compared.

**Records written before D6 (schema 1) are estimates that left out every cache
token** — MEDIA-002's three records claim USD $1.25 against a real $2.65
(handoff.md §10.5). They have no `cost_source`, count as estimates, and
`telemetry report` lists them as such. They are not rewritten: telemetry is
append-only.

The provider's figure is trusted as reported: it comes from the CLI's stdout,
not from anything the model writes, but nothing here checks it against the
provider's bill. The Console is the ground truth.

## Permission denials

`permission_denials` is how many tool calls the CLI refused the model, and
`permission_denied_tools` their tool names — only the names, filtered to plain
identifiers. What the model asked to run is never recorded: it is
model-authored, and this file is committed. A count above 0 answers whether a
worker tries tools it is not given (a shell, above all; handoff.md §10, D2).

No LLM is involved in producing, parsing or aggregating any of this.

## Reading it

```
python .ai/bin/agentctl.py telemetry report          # totals by task, role, model
python .ai/bin/agentctl.py telemetry report --json   # for a script
```

The aggregate answers: total tokens per task, tokens by agent, tokens by model,
cost per task, attempts taken, how often the Manager was reached, and
permission denials. Cost is the provider's figure where a record has one;
every record whose cost is only an estimate is counted ("N estimated") and
listed by path, and one with no cost at all is counted as unpriced rather than
summed as zero, so an aggregate is never quietly wrong.

A record that cannot be parsed is listed under `unreadable` rather than
silently skipped.

## Record shape

Schema 2 (D6). A one-turn call, from the real envelope in
`.ai/tests/fixtures/claude-cli-2.1.295-envelope.json`:

```json
{
  "schema": 2,
  "task_id": "DEMO-001",
  "workflow_run_id": "17352019481",
  "role": "distiller",
  "provider": "anthropic",
  "model": "claude-haiku-4-5-20251001",
  "session_id": "sess-abc123",
  "attempt": 2,
  "started_at": "2026-09-20T10:00:00Z",
  "ended_at": "2026-09-20T10:00:02Z",
  "duration_seconds": 2,
  "input_tokens": 9,
  "output_tokens": 48,
  "cache_creation_input_tokens": 8596,
  "cache_creation_1h_input_tokens": 8596,
  "cache_creation_5m_input_tokens": 0,
  "cache_read_input_tokens": 16654,
  "thinking_tokens": 42,
  "total_tokens": 25307,
  "provider_cost_usd": 0.0191064,
  "estimated_cost_usd": 0.0191064,
  "cost_usd": 0.0191064,
  "cost_source": "provider",
  "num_turns": 1,
  "permission_denials": 0,
  "permission_denied_tools": [],
  "is_error": false,
  "subtype": "success",
  "result": "completed",
  "commit_sha": "deadbeef",
  "ci_run_id": "17352019999"
}
```

`total_tokens` is input + output + cache writes + cache reads: every token
billed. `thinking_tokens` is already inside `output_tokens`. `is_error` and
`subtype` are the CLI's own outcome (`success`, `error_max_turns`, ...); a call
that exits non-zero is still normalised, so its cost is recorded too.

The fields D6 added, and `session_id`, `commit_sha` and `ci_run_id`, may be
`null` — not every provider or CLI version reports them, and unknown is never
written as zero. Everything else is required, and a record missing one is
rejected.
