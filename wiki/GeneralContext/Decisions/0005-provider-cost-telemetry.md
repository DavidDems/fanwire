---
type: decision
---

# 0005 - Prefer provider cost and retain usage provenance

Decision: 2026-10-08, the human's workflow-review fix queue (D6),
implemented on 2026-10-09.

## Context

Recorded input counts of 30 to 66 tokens for a 38.6 KB prompt exposed missing
cache usage. MEDIA-002 cost USD $2.65 in the Console while its invocation
records estimated $1.25. Stale local prices compounded the error. A token
estimate presented as spend could therefore mislead budgeting and comparisons
between roles or models.

## Choice

Use the CLI envelope's `total_cost_usd` as the authoritative per-call cost.
Carry that figure through the invocation contract into telemetry's `cost_usd`,
with `cost_source` set to `provider`. Only when the provider figure is absent
or invalid may the price-table estimate become the fallback, with
`cost_source` set to `estimate`. Always retain `estimated_cost_usd` alongside
the selected cost so the sources remain distinguishable.

Keep honest null values for unknown D6 optional usage fields and provider
cost; never invent a price. This does not change the invocation contract's
zero defaults for missing core input and output token counts. The fallback estimate is null for an unknown model price, a missing
price for used cache tokens, or cache writes whose duration is unsplit or
does not reconcile with the reported cache total. Price cache reads and the
one-hour and five-minute writes separately when the necessary information
exists. The implementation corrected the price table and added the newer
model rows; this ADR does not freeze rates or introduce another price table.

Retain `cache_creation_input_tokens`, `cache_read_input_tokens`,
`cache_creation_1h_input_tokens`, `cache_creation_5m_input_tokens`,
`thinking_tokens` and `num_turns` when reported. Keep `permission_denials`
as a denial count and filtered tool names only; never retain or echo
`tool_input`, which can contain what the model asked to run.

The [invocation contract](../../../.ai/agentlib/agentresult.py) owns the
normalized fields and missing-value semantics;
[telemetry](../../../.ai/agentlib/telemetry.py) owns cost selection, estimation
and report aggregation. The [Cost reference](../../../.ai/docs/operations.md#cost)
owns report interpretation. Link those owners rather than copying their
schemas or operational procedure into this decision.

## Consequences

Recorded cost can now reflect the provider's whole call, including cache
usage, while reports identify estimated records and expose permission denials.
The eight legacy records before D6 remain under-counted estimates because
cache tokens were excluded; they lack `cost_source` and must not be mistaken
for provider-priced history. Immutable telemetry is not retrospectively
rewritten to imply evidence it never captured.

Provider telemetry remains observational evidence, not a new trust boundary:
the model's user could touch its envelope file. The report does not reconcile
with the Console, which remains billing ground truth. The human's comparison
of the Console's 2026-09-23 bill with the recorded $0.38 remains a separate
check, not proof supplied by this extraction.

This extraction changes no runtime behaviour, configuration or task state.
CLI field confirmation on 2.1.295 does not prove CI's envelope, multi-turn
cost, a real denial or cost after a non-zero exit. Those proof gaps and the
file-trust residue remain visible in the
[retained defect review](../../../.ai/docs/handoff.md#101-defects).
Original evidence and the implementation record remain in the
[immutable source revision](https://github.com/DavidDems/fanwire-archive/blob/4795f19f50405ac0d0a95276ddd427014559b392/.ai/docs/handoff.md#101-defects).
