---
type: decision
---

# 0028 - Improvement roadmap answers

Decision: 2026-10-19, the human.

## Context

The improvement roadmap in `TODO/02-backlog.md` ("Improvement roadmap") left
open questions in its briefs. The human answered them before any brief started.

## Choice

- **Spam scoring** (`POSTS-003`): deterministic heuristics, no model call.
- **Unit metrics storage**
  ([Prompts/11](../Prompts/11-metrics-every-mode.md)): a `metrics` data branch.
- **Where evals run** ([Prompts/12](../Prompts/12-agent-evals.md)): locally, on
  the human's subscription.
- **Who runs a wiki maintenance pass**
  ([Prompts/10](../Prompts/10-docs-structure.md)): a Director session, before
  any automated pass is considered.
- **Independent review of Director PRs** (`director-review.yml`):
  `claude-sonnet-5-5`. Haiku is too light for reading workflow diffs.
- **The context graph** ([Prompts/15](../Prompts/15-context-graph.md)): our own
  thin generator on mature parsers (`ast`, the TypeScript compiler API, `cdk
  synth` output). It supplements the docs and does not replace them, and it
  enforces the connection rule. tempograph is not adopted; it is at most an
  optional comparison arm in the bake-off.

## Consequences

- The spam scorer is
  [0x03a-posts-post.md](../../CodeContext/Modules/0x03a-posts-post.md)
  "Security".
- The Director review costs about USD $0.05 a PR, configured at
  `automations.director_review` in `.ai/config.json`; it is described with the
  other automations in [work-modes.md](../Architecture/work-modes.md).
- Each brief records its answer and does not ask again. The performance-test
  answers of the next day are [ADR 0029](0029-performance-test-design.md).
