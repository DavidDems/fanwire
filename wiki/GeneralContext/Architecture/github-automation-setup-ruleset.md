---
type: runbook
---

# GitHub automation setup: the ruleset on `main`

Part of [GitHub automation setup](github-automation-setup.md).

## 3. Branch protection — the "Workflow ruleset" on `main`

Pull request required, **1 approval**, code-owner review, a strict up-to-date
policy, and required status checks.

**Required checks are `gate` and `guard-gate`** — two aggregate jobs, not the
individual suites. `gate` (in `test-agent.yml`) depends on every test job;
`guard-gate` (in `agent-guard.yml`) depends on `guard`. Both use `if: always()`
and deliberately avoid `success()`, because `success()` treats a *skipped*
dependency as not-success, and a skip is often the correct outcome — the guard
skips on non-`agent/*` branches, and path filtering skips suites a PR cannot
affect.

**Require the aggregates, not the leaves.** Naming individual jobs means a
renamed or path-skipped job silently stops being required: it does not fail, it
disappears from the gate. The aggregate turns "skipped" into an explicit pass
and a failure into a failure.

### ⚠️ Solo-repo caveat — you cannot approve your own PRs

GitHub never lets a PR author approve their own PR, and you are both the author
and the only code owner, so **your own PRs can never satisfy the 1-approval
rule**. The ruleset's bypass list therefore holds **Repository admin** with
mode **"Pull requests only"**: still no direct pushes to `main`, but you can
merge your own PR without a second approver.

This does not weaken the agent gate, and the asymmetry is the point:

| PR author | Can you review it? | How it merges |
|---|---|---|
| `github-actions[bot]` (agent PRs) | **Yes** — a different actor | Normal approval |
| You | No | The admin bypass |

When you use the bypass on your own PR you are waiving a rule that is
*unsatisfiable*, not a check that failed. Confirm the checks are green first —
the bypass does not distinguish.
