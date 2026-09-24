# GitHub automation setup: the repository settings the agent pipeline needs

**Status: COMPLETED 2026-09-23 (human).** Every repository setting the `.ai/`
agent pipeline depends on is in place and has been exercised by a real task
running unattended end to end. Nothing here is outstanding.

**Human-facing.** This page records *what is configured, and why* — the settings
themselves live in GitHub's UI and API, where they are invisible to the
repository. It replaces `TODO/01-ai-workflow-setup.md`, which was a checklist
and is deleted now that every item is closed.

**This is not the incident history.** Every bug, the run that exposed it and the
PR that fixed it is in `.ai/docs/handoff.md` §4. What is *unproven* about the
pipeline is §3 of that file. What to work on next is §6, and the open defects
have their own brief in §9. This page is configuration only.

## Why these settings are worth writing down

They are the one part of the agent system that is **not** in version control.
`policy.json`, the guard and the state machine are code and reviewed as code. A
repository setting is a checkbox in someone's browser: nothing diffs it, nothing
tests it, and a wrong one fails in ways that look like a code bug. Two of the
pipeline's seventeen recorded bugs were settings, not code.

---

## 1. Actions can run

The repository is **public**, which makes Actions minutes unmetered. Making it
private again re-meters them, and a runaway loop then burns the allowance — as
one nearly did.

**You will keep seeing `agent-orchestrator` runs marked "skipped".** That is
correct, not a failure: it listens on `workflow_run` for *every* `test-agent`
completion, including on `main`, then skips anything that is not an `agent/*`
branch. A skipped job costs nothing.

## 2. Secrets — all three are *repository* secrets

| Secret | For |
|---|---|
| `ANTHROPIC_API_KEY` | The provider. Must be a **Claude Console** key — a Pro/Max plan does not grant API access, and an Organization-settings key is not the same thing. That mismatch caused the first four worker runs to fail. |
| `AGENT_DISPATCH_TOKEN` | A fine-grained PAT, this repository only, **Actions: read+write** and **Contents: read+write**, nothing else. Every dispatch step prefers it. |
| `AI_GATEWAY_API_KEY` | Added 2026-09-23 with the `jev` model work. |

### ⚠️ Repository secret, not an environment secret

This cost a debugging session and is the single most confusable thing on this
page. `AGENT_DISPATCH_TOKEN` was first created as an **environment** secret,
which looks equivalent in the UI and is not.

An environment secret is only injected into a job that declares
`environment: <name>`, and none of the dispatch steps do. The expression
`${{ secrets.AGENT_DISPATCH_TOKEN || github.token }}` then resolves the left
side to empty and **silently falls back to `github.token`** — no error, no log
line, and the failure it was meant to fix stays exactly as it was. Environments
exist to gate deployments behind approvals, which is the opposite of what an
unattended orchestrator wants.

```powershell
gh secret list --repo DavidDems/fanwire
```

### Why the token is needed at all

GitHub does **not** fire `workflow_run` for a run that this repository's own
workflow started using the default `GITHUB_TOKEN`. That is precisely the
CI-finished leg of the chain, so without the PAT every task stalled at
`BASELINE_CI` and again at `IMPL_CI` and had to be nudged by hand twice.

`workflow_run` fires normally for `pull_request`- and `push`-triggered runs, so
neither of those is evidence the token works. **The only proof is a task
crossing a CI boundary with no manual nudge** — first observed 2026-09-22, run
`35768127169`, 12 seconds after CI finished.

### ⚠️ The token is a person's credential

A fine-grained PAT is owned by an account, so a workflow using it acts **as that
person** and inherits that person's ruleset bypass (§3). The PR-creation step is
deliberately pinned to `github.token` so agent PRs stay bot-authored. **Keep it
pinned, and do not widen the PAT.**

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
rule**. Resolved by adding **Repository admin** to the ruleset's bypass list with
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

## 4. Actions may open pull requests

**Settings → Actions → General → Workflow permissions → "Allow GitHub Actions to
create and approve pull requests"** is on. Without it `gh pr create` fails with
*"GitHub Actions is not permitted to create or approve pull requests"*; the task
still reaches `COMPLETE`, only the PR is missing.

`default_workflow_permissions` stays **read** on purpose — every workflow
declares its own `permissions:` block, so the repo-wide default never needs to
grant anything.

```powershell
gh api repos/DavidDems/fanwire/actions/permissions/workflow
```

⚠️ That setting also grants *approval*, which would let a workflow satisfy the
1-approval rule. Nothing in these workflows calls `gh pr review`, and
`.ai/tests/test_workflows.py` fails the build if one ever does — alongside the
existing check that no workflow can merge. CODEOWNERS is the second layer.

### ⚠️ A workflow-opened PR arrives with no checks at all

It reads as blocked and looks broken. Workflows on a PR authored by
`github-actions[bot]` land in **`action_required`** and wait for a human to
approve the run before CI executes. Approve it from the Actions tab.

Note this is a *separate action* from approving the PR: reviewing the PR
satisfies the approval rule, approving the run makes the checks execute. Both
are needed, and doing one does not do the other.

Arguably a feature — a human gate between an agent finishing and CI spending
minutes on its work — but it is GitHub's default rather than a decision anyone
made here, and it sits in the end-to-end latency of every task.

## 5. Head branches are deleted on merge

`delete_branch_on_merge: true`. This is the mechanical fix for the stacked-PR
trap: a merged branch cannot be branched from again by accident. 26 stale
branches were cleaned out on 2026-09-22 when this went on.

## 6. The pre-commit hook (per clone, opt-in)

```powershell
git config core.hooksPath .ai/hooks
```

`pre-commit` blocks on ruff and is **advisory** on the test suite, because this
repo's own workflow requires committing a failing test alone. `pre-push` refuses
to push a non-`agent/*` branch carrying `[agent-state]` commits — see
`.ai/hooks/README.md` for why.

Hooks are a convenience, not a control: they run on one machine, `--no-verify`
skips them, and CI does not use them. Nothing in the permission model depends on
one.

---

## Running and stopping a task

Full operational detail is in `.ai/docs/operations.md`; this is the short form.

Branch from `origin/main` **explicitly** — `git switch -c <name>` alone branches
from whatever HEAD happens to be, which has already put one task's mid-flight
state on `main`:

```powershell
git switch main; if ($?) { git pull }
git switch -c agent/<TASK-ID> origin/main; if ($?) { git push -u origin agent/<TASK-ID> }
gh workflow run agent-orchestrator.yml -f task_id=<TASK-ID>
```

Watch it without opening an agent session. State lives on the task branch, so
pull first or you are reading a stale file:

```powershell
git pull
python .ai/bin/agentctl.py status
python .ai/bin/agentctl.py state show <TASK-ID>
python .ai/bin/agentctl.py telemetry report
```

Stop, resume, or abandon a task:

```powershell
python .ai/bin/agentctl.py state control <TASK-ID> --set PAUSE
python .ai/bin/agentctl.py state control <TASK-ID> --set RUN
python .ai/bin/agentctl.py state control <TASK-ID> --set CANCEL
```

The emergency stop, if something runs away. The state file stays accurate while
they are off, and `gh workflow enable` resumes exactly where it stopped:

```powershell
gh workflow disable agent-orchestrator.yml
gh workflow disable agent-worker.yml
```

## What a task costs

**About $0.38** for a complete pass, measured on USERS-002 (2026-09-23): test
agent $0.151, code agent $0.151, context maintainer $0.076 — all sonnet, with
the manager never invoked. Against a **$15** credit.

Model cost is separate from Actions minutes, and is the only one that is metered
while the repository is public.

```powershell
python .ai/bin/agentctl.py telemetry report
```
