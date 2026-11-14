---
type: runbook
---

# GitHub automation setup: Actions

Part of [GitHub automation setup](github-automation-setup.md).

## 1. Actions can run

The repository is **public**, which makes Actions minutes unmetered. Making it
private again re-meters them, and a runaway loop then burns the allowance.

**You will keep seeing `agent-orchestrator` runs marked "skipped".** That is
correct, not a failure: it listens on `workflow_run` for *every* `test-agent`
completion, including on `main`, then skips anything that is not an `agent/*`
branch. A skipped job costs nothing. It also skips every `test-agent` run that
is not a `workflow_dispatch` from this repository — pull-request CI on an
`agent/*` branch included — because only the run the orchestrator dispatched
is a task's verdict.

**`ci-summary` runs are marked "skipped" too**, for the same reason: it
listens on `workflow_run` for every `test-agent` completion and acts only on a
*failed* `pull_request` run of an `agent/*` branch in this repository. Only
those runs spend an Anthropic call (one Haiku 5.5 call, a fraction of a cent).

**`coverage-check` runs on every pull request** (`pull_request_target`) and is
skipped for anything but an `agent/*` branch of this repository. On a task PR
it spends one Haiku 5.5 call each time the branch is pushed, unless the push
changes no test file, which needs no call. Its `jev` call is wired and
switched off (`ask_jev: false`,
[ADR 0025](../Decisions/0025-jev-shadow-only-switched-off.md)).
`pull_request_target` runs `main`'s copy of the workflow with secrets and needs
no approval, which is why the job refuses forks and never executes the PR's
files.

**`wiki-proposal` runs when any pull request closes** and is skipped unless
an `agent/*` branch of this repository merged. Then it spends one Haiku 5.5
call, unless the task's spec names no module file.

**`director-review` runs on a pull request to `main` that touches `.ai/` or
`.github/`** (`pull_request_target`) and is skipped for an `agent/*` branch, a
bot's PR or a fork. Then it spends one Sonnet 5.5 call (about $0.05) and posts
one advisory comment. It fails nothing.

**`scorecard` runs weekly** (Mondays 06:17 UTC), from `main`, with no secret
and no model call. Its results go to the Security tab; it is advisory.

**`codeql` runs on every pull request to `main`, every push to `main`**, weekly
(Wednesdays 05:41 UTC) and on dispatch, with no secret and no model call. It
analyses `actions`, `javascript-typescript` and `python` with `build-mode: none`:
it extracts source and builds nothing, so it runs no PR's code, `agent/*`
included. Its results go to the Security tab; it is advisory and not in `gate`.

### Which actions may run, and how they are pinned

Set by the human; read each back with `gh api`:

| Setting (Settings → Actions → General, unless noted) | Value |
|---|---|
| Actions permissions | **Allow DavidDems, and select non-DavidDems, actions and reusable workflows**. "Allowed by GitHub" and "verified creators" are unticked |
| Allowed patterns | `actions/*`, `aws-actions/*`, `docker/*`, `github/*`, `ossf/*` |
| Require actions to be pinned to a full-length commit SHA | **On** |
| Workflow permissions | **Read repository contents and packages permissions** |
| Allow GitHub Actions to create and approve pull requests | **On**: the orchestrator opens review PRs (§4). No workflow approves anything (`TestNoWorkflowCanApprove`) |
| Security → Advanced Security: secret scanning, push protection | **On** |
| Security → Advanced Security: Dependabot alerts | **On**, so Renovate and the Security tab see advisories. **Dependabot security updates stay off**: Renovate opens the update PRs (`github-automation-setup-renovate.md` §7) |
| Security → Advanced Security: Private vulnerability reporting | **On**: `.github/SECURITY.md` sends reporters to it. |

The pin requirement is the server-side half of
`TestEveryActionIsPinnedToACommit`. The test stops an unpinned `uses:`
reaching `main`, and the setting stops GitHub running one at all, including
from an old commit. **A re-run of a deploy whose commit's `deploy.yml` uses
tags fails** at its first action. Re-deploy from a newer commit instead. A new
action owner needs a pattern here before its first run. Renovate keeps the
SHAs and their `# vN` comments current (`github-automation-setup-renovate.md` §7).

### Fork pull requests need approval from every outside contributor

`approval_policy: all_external_contributors`
([ADR 0023](../Decisions/0023-human-gates-on-agent-work.md)). The repository
is public and forks are allowed. D1 stops the orchestrator applying a fork's
`test-agent` run as a task's verdict; this setting keeps a fork's workflows
from running at all until a human looks.

```powershell
gh api repos/DavidDems/fanwire/actions/permissions/fork-pr-contributor-approval
```

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

This gate is kept on purpose: [ADR 0023](../Decisions/0023-human-gates-on-agent-work.md).

## 5. Head branches are deleted on merge

`delete_branch_on_merge: true`. This is the mechanical fix for the stacked-PR
trap: a merged branch cannot be branched from again by accident.

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
