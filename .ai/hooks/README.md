# Git hooks

Git does not install hooks from a tracked file, so this is opt-in per clone:

```bash
git config core.hooksPath .ai/hooks
```

## `pre-commit`

Runs ruff (lint + format) over staged Python, the `.ai/` test suite and
`agentctl selfcheck` when `.ai/` is touched, and eslint over staged frontend
files. A missing toolchain skips its own check rather than blocking the commit.

**Why it exists in an agent system:** a lint failure that reaches CI costs a
full pipeline and, for a code agent, a whole implementation attempt out of a
budget of three. Catching it before the commit is the difference between a
retry spent on the actual problem and one spent on a line length.

## What a hook is not

A hook is a convenience, not a control. It runs on the developer's machine, it
can be skipped with `--no-verify`, and the CI runner does not use it at all.
Nothing in the permission model depends on it — that lives in
`.github/workflows/agent-guard.yml`, which an agent cannot modify and cannot
skip.

Agent workers do not run this hook: `agent-worker.yml` does not set
`core.hooksPath`, so an agent commit is checked by CI like any other.
