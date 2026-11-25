---
type: changelog
---

# Pipeline changelog

- 2026-11-24 | 1.0.0 | Pipeline declared live; `.ai/VERSION` and this changelog introduced, enforced by `agentctl version check` | [metrics reference](docs/metrics.md)
- 2026-11-24 | 1.1.0 | Added `agentctl metrics report`: by-week, by-mode, by-version table of the section 9 metrics from unit records | [metrics reference](docs/metrics.md)
- 2026-11-24 | 1.2.0 | `agentctl task validate` and `selfcheck` now reject an acceptance criterion with no observable predicate, naming its index | [backlog](../TODO/02-backlog.md)
- 2026-11-24 | 1.3.0 | Added `agentctl selfcheck --workspaces` (node_modules installed, local only), `agentctl preflight ports`, and a Claude Code PreToolUse hook refusing `git stash` and `docker compose run` port collisions | [backlog](../TODO/02-backlog.md)
- 2026-11-25 | 1.3.1 | Observable-criterion rule accepts invoke, exist and proof so merged specs such as POSTS-010 validate | [backlog](../TODO/02-backlog.md)
