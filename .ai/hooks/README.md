# Git hooks

Git does not install hooks from a tracked file, so this is opt-in per clone:

```bash
git config core.hooksPath .ai/hooks
```

## Claude Code `PreToolUse` hook

`claude_pretool.py` is not a git hook. It is a Claude Code `PreToolUse` hook on
the `Bash` tool, registered in the project's tracked `.claude/settings.json`
(per-machine overrides go in `.claude/settings.local.json`, which each
developer keeps out of git with a global ignore; the repo's `.gitignore` does not
list it). It reads the tool call as JSON on stdin; exit 2 plus a stderr
reason refuses it. Nothing to install: Claude Code loads it from the project.

- **`git stash` is refused**, whatever the subcommand and wherever it sits in a
  `&&`, `;`, `|`, `$( )` or `bash -c` chain, including `git -C <dir> stash`.
  The stash stack is shared by every worktree of one clone, so a session that
  stashes can have its work popped or dropped by another. Text inside a quoted
  commit message or a heredoc body is not a command and passes. It fails
  closed: input the hook cannot parse is refused.
- **`docker compose run` port pre-flight.** For `docker compose ... run` and
  `docker-compose run`, the hook resolves the host ports the compose file
  publishes for the services `run` starts (its dependencies, plus its own ports
  only with `--service-ports`; `--no-deps` drops the dependencies), applying
  `${VAR:-default}`, a command-line `VAR=x` prefix, the process environment and
  `.env`. A port already accepting connections on localhost refuses the call,
  naming the port, the variable to override (for example `POSTGRES_HOST_PORT`)
  and the rule to stop only processes you started. It fails open: any error in
  the pre-flight allows the command.

By hand, `python .ai/bin/agentctl.py preflight ports [--compose-file F]
[--service S]` runs the same check (exit 1 on a collision). It detects a bound
port by connecting to `127.0.0.1`; it never calls docker.

This is an agent-session convenience, not a security control: the model can
still run the command through a path the hook does not parse, and nothing in
the permission model depends on it. `.claude/` is a restricted tree, so
changes to the hook or its settings arrive by Director PR.

## `pre-commit`

Runs ruff (lint + format) over staged Python, the `.ai/` test suite and
`agentctl selfcheck` when `.ai/` is touched, and eslint over staged frontend
files. A missing toolchain skips its own check rather than blocking the commit.

**Why it exists in an agent system:** a lint failure that reaches CI costs a
full pipeline and, for a code agent, a whole implementation attempt out of a
budget of three. Catching it before the commit is the difference between a
retry spent on the actual problem and one spent on a line length.

## `pre-push`

Refuses to push a **non-`agent/*`** branch that carries `[agent-state]`
commits `main` does not already have.

**Why it exists.** A human branch cut while HEAD is on an `agent/*` branch
instead of `main` reviews as the change it claims to be, and on merge also
carries `[agent-state]` commits and a **mid-flight `state.json`** onto `main`
(bug 17, `handoff.md` §4).

That is not untidiness. A task's state file on `main` is what the *next* run of
that task reads. A fresh `agent/<ID>` cut from `main` would open by reading
"a test agent is already running", and stall — a task that looks rebuilt and
cannot move.

A merged agent PR leaving its own finished `state.json` on `main` is the design
and is fine. A human branch dragging one along is not, and after the merge the
two are indistinguishable.

`agent/*` branches are exempt: that is where those commits are legitimately
made. The range is measured against `origin/main`, not the remote branch, so a
second push of an already-poisoned branch still fails. A branch deletion (the
all-zero sha) is not inspected.

## What a hook is not

A hook is a convenience, not a control. It runs on the developer's machine, it
can be skipped with `--no-verify`, and the CI runner does not use it at all.
Nothing in the permission model depends on it — that lives in
`.github/workflows/agent-guard.yml`, which an agent cannot modify and cannot
skip.

Agent workers do not run this hook: `agent-worker.yml` does not set
`core.hooksPath`, so an agent commit is checked by CI like any other.
