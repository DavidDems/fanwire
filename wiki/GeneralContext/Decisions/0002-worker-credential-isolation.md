---
type: decision
---

# 0002 — Isolate worker output from privileged execution

Decision: 2026-10-08, the human's workflow-review agreement (D2b).

## Context

Removing a GitHub token from the model's environment left a second route to
that token: later privileged steps executed files or Git metadata the model
could change. Repository Python, invocation scripts, Git hooks and config,
workspace CLI settings, and surviving processes each crossed that boundary.
An edit-only model could exploit several of these routes without a shell.

The human chose a split worker over hardening one shared job. The design must
continue to hold when a worker has shell access, and must cover the
orchestrator and PR guard as well as the model's own invocation.

## Choice

- Separate the worker into `run-model` and `land` jobs. The former has
  repository read permission, supplies no GitHub credential to the model,
  and hands over a patch artifact. Checkouts use
  `persist-credentials: false`; removing a token from one process alone is
  insufficient.
- Run the model under the separate unprivileged `agentrun` user. Keep its
  Git metadata outside the model-writable tree, prevent it writing the
  runner user's tools and Actions directories, and kill that user's
  surviving processes before packaging the patch. Invoke the provider
  through the trusted wrapper rather than a task-branch script.
- Start `land` on a fresh runner with a fresh checkout. Apply the patch as
  data, inspect every changed path through the role guard, and only then
  write workflow-owned state and telemetry, commit, push and hand control
  back. There is no filter exempting `.ai/` from the patch guard.
- Execute tooling from a trusted main checkout; the PR guard uses the PR's
  base revision. Set `AGENTCTL_DATA_ROOT` to the separate task data tree and
  use `python -I` to prevent the task's import environment supplying code.
  PR content, including a fork's files and chosen branch name, remains
  untrusted input rather than a source of guard instructions or imports.
- Before Python runs, reject task-branch changes under `.ai/` beyond that
  task's permitted bookkeeping. Validate task identifiers with `fullmatch`,
  and pass external values through environment variables instead of
  interpolating them into shell scripts.
- Refuse branch changes under `.claude/` or to `.mcp.json` before invoking
  the model. Start the CLI with `--setting-sources user` and
  `--strict-mcp-config` so workspace hooks and MCP configuration cannot
  become an execution path. These checks accompany the job and user split;
  they do not replace it.

## Consequences

Model-written files reach privileged work as a guarded patch, while the
authority that interprets the patch comes from a different checkout and
runner. Credentials used for landing, pushing or dispatching are kept apart
from the worker's files and surviving ordinary processes. This requires an
artifact handover and a landing path that handles failed or cancelled model
jobs, not merely successful output.

The current permission boundaries belong to the
[permission model](../../../.ai/docs/permissions.md); the
[threat model](../../../.ai/docs/threat-model.md) records their limits.
The [worker](../../../.github/workflows/agent-worker.yml),
[orchestrator](../../../.github/workflows/agent-orchestrator.yml) and
[PR guard](../../../.github/workflows/agent-guard.yml) own the executable
protocol. This decision does not claim a new live proof or eliminate the
provider credential, cron/timer, path-quoting or merge-base limitations.
The existing proof gaps and residue remain in the
[handoff's defect review](../../../.ai/docs/handoff.md#101-defects).

The original attack narratives, implementation evidence and human agreement
remain in the
[source revision](https://github.com/DavidDems/fanwire/blob/6188e2807ebb5e2210087e87abffa11c338ab000/.ai/docs/handoff.md#103-agreed-by-the-human-2026-10-08).
