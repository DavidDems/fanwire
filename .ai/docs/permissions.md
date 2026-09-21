# Permission model

Agent permissions are treated as a security boundary, not as documentation.
The enforceable part lives in `.ai/policy.json` and `agentlib/guard.py`; this
file explains the model and records what is enforced where.

## Decision order

For every path in an agent's diff, first match wins, and a denial is never
overridden later:

| # | Check | Source | Can it be granted away? |
|---|---|---|---|
| 1 | `ALWAYS_FORBIDDEN` | `agentlib/guard.py` | **No.** Not by a spec, not by policy.json. |
| 2 | task `forbidden_paths` | `task.json` | Only by editing the spec (reviewed PR). |
| 3 | role `deny` | `.ai/policy.json` | Only by editing the policy (reviewed PR). |
| 4 | role `write` allowlist | `.ai/policy.json` | No match ⇒ denied. |
| 5 | task `allowed_paths` | `task.json` | Narrows the role. **Never widens it.** |

Point 5 is the important one: a task spec can only ever reduce what a role may
touch. There is no path from a task spec to more permission than the role has.

## Always forbidden

```
.ai/**                    the agent system itself
.github/**                the workflows that enforce it
wiki/GeneralContext/**    Director-owned semantic context
.gitignore .gitattributes .gitmodules
AGENTS.md
```

A coding worker cannot modify its own security boundaries. This is checked in
three independent places: before the commit in `agent-worker.yml`, at PR level
in `agent-guard.yml`, and in `agentctl selfcheck` which runs in the ordinary
test suite.

## Matrix

| Role | READ | WRITE | EXECUTE | FORBIDDEN |
|---|---|---|---|---|
| **Director** | everything | `.ai/`, `wiki/`, workflows — via human-reviewed PR from a non-agent branch | interactive session | merging its own PR |
| **Manager** | task spec, branch diff, distilled results, state history | nothing | none | code, tests, wiki, state (it emits a decision; `agentctl` applies it) |
| **Test Agent** | handed context files + skills, existing tests, production code (read-only) | test paths within `allowed_paths` | test runners locally | production code, wiki, dependency manifests, workflow state |
| **Code Agent** | handed context files + skills, committed tests, distilled failure | production paths within `allowed_paths` | test runners locally | test files (unless `allow_test_edits_during_impl`), dependency manifests, `docker/`, wiki, workflow state |
| **Distiller** | **nothing** — its prompt is its whole world | nothing | none | the repository entirely |
| **Context Maintainer** | task spec, the diff, the one module file | `wiki/CodeContext/Modules/*.md` | none | `Standards/`, `GeneralContext/`, all code |

## Dependency changes are denied on purpose

`backend/pyproject.toml`, `frontend/package.json`, `infra/package.json`,
`docker/**` and `docker-compose.yml` are in the code agent's `deny` list.

Adding a package is a supply-chain decision. It is not something a retry loop
should settle on attempt three because a test would then go green. A task that
genuinely needs a new dependency escalates to the Director, who adds it in a
reviewed PR.

## GitHub Actions permissions

Least privilege per workflow:

| Workflow | `contents` | `actions` | `pull-requests` | Why |
|---|---|---|---|---|
| `test-agent.yml` | read | — | — | It only runs tests. |
| `agent-guard.yml` | read | — | — | It only checks a diff. |
| `agent-worker.yml` | write | write | — | Commits to a task branch; wakes the orchestrator. |
| `agent-orchestrator.yml` | write | write | write | Commits state; triggers CI and workers; opens the review PR. |

**The agent process itself gets no GitHub token.** In `agent-worker.yml`, the
step that invokes the model sets `GITHUB_TOKEN: ""` and `GH_TOKEN: ""`
explicitly. Only the deterministic steps around it can reach the GitHub API. A
model that is persuaded to dispatch a workflow, push to `main`, or change
branch protection has no credential with which to try.

The provider credential (`ANTHROPIC_API_KEY`) is present only in that one step.

## Secrets

- None are committed. `.ai/config.json` names the secret that holds a
  credential; it never holds a value.
- `.gitignore` already excludes `.env` and `*.env`.
- No workflow echoes a secret, writes one to a file, or passes one to an agent
  prompt.
- `AGENT_DISPATCH_TOKEN` is optional and only used to chain workflow dispatches
  (see [operations.md](operations.md)). It needs `actions: write` on this
  repository and nothing else.

## What is not enforced technically

Stated plainly, because this system exists precisely because prose-only rules
were judged not good enough:

- **Read** restrictions are advisory. A worker is *handed* a small file set and
  told not to browse, but nothing stops it reading another file in the
  checkout. Write is what is enforced, and write is what determines blast
  radius.
- **The Director** is not sandboxed. It is a human-supervised interactive
  session whose output goes through ordinary review.
- **Branch protection and CODEOWNERS** are GitHub repository settings, not
  files in this repo. `.github/CODEOWNERS` is committed; requiring review on
  `main` and requiring `agent-guard` to pass are settings a human must switch
  on — see [operations.md](operations.md).
