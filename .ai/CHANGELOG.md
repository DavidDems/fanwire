---
type: changelog
---

# Pipeline changelog

- 2026-11-24 | 1.0.0 | Pipeline declared live; `.ai/VERSION` and this changelog introduced, enforced by `agentctl version check` | [metrics reference](docs/metrics.md)
- 2026-11-24 | 1.1.0 | Added `agentctl metrics report`: by-week, by-mode, by-version table of the section 9 metrics from unit records | [metrics reference](docs/metrics.md)
- 2026-11-24 | 1.2.0 | `agentctl task validate` and `selfcheck` now reject an acceptance criterion with no observable predicate, naming its index | [backlog](../TODO/02-backlog.md)
- 2026-11-24 | 1.3.0 | Added `agentctl selfcheck --workspaces` (node_modules installed, local only), `agentctl preflight ports`, and a Claude Code PreToolUse hook refusing `git stash` and `docker compose run` port collisions | [backlog](../TODO/02-backlog.md)
- 2026-11-25 | 1.3.1 | Observable-criterion rule accepts invoke, exist and proof so merged specs such as POSTS-010 validate | [backlog](../TODO/02-backlog.md)
- 2026-11-27 | 1.4.0 | Added `agentctl docs graph`: writes `.ai/graph.json`, a typed, deterministic graph of links, mentions, citations and spec paths between docs, task specs and code | [doclint reference](docs/doclint.md)
- 2026-11-27 | 1.5.0 | `agentctl docs graph --of`, `--within` and `--task` query the committed graph: edges of a file, its neighbourhood, and a task's required_context closure | [doclint reference](docs/doclint.md)
- 2026-11-27 | 1.6.0 | `agentctl docs graph --orphans` lists unlinked docs and dangling edges, and `--check` (a docs-lint step in CI) fails on a stale `.ai/graph.json` or orphans/dangling edges beyond `.ai/graph-baseline.json` | [doclint reference](docs/doclint.md)
- 2026-11-27 | 1.7.0 | `agentctl docs graph`: a dangling edge from a decision (`type: decision`) is frozen history, not graph debt; `--orphans` lists it apart and the baseline drops such entries | [doclint reference](docs/doclint.md)
- 2026-11-27 | 1.8.0 | `docs graph` reads a Markdown path mention relative to the mentioning file's folder when it is not a root path, so skill references count as linked | [graph reference](docs/docgraph.md)
