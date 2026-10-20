# GitHub automation setup: the repository settings the agent pipeline needs

**Status: COMPLETED 2026-09-23 (human).** Every repository setting the `.ai/`
agent pipeline depends on is in place and has been exercised by a real task
running unattended end to end. **Revised
2026-10-08** after the workflow review (`.ai/docs/handoff.md` §10): fork-PR
approval tightened, the secrets changed, spend controls added, and
`action_required` decided. **Revised 2026-10-19** (supply chain, PRs
#174–#178): only selected actions may run and each must be pinned to a commit
SHA, secret scanning and push protection are on (§1, "Which actions may
run"), and Renovate is installed (§7) but not yet seen running.

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
branch. A skipped job costs nothing. Once D1 is merged it also skips every
`test-agent` run that is not a `workflow_dispatch` from this repository —
pull-request CI on an `agent/*` branch included — because only the run the
orchestrator dispatched is a task's verdict.

**`ci-summary` runs are marked "skipped" too**, for the same reason: it
listens on `workflow_run` for every `test-agent` completion and acts only on a
*failed* `pull_request` run of an `agent/*` branch in this repository. Only
those runs spend an Anthropic call (one Haiku 5.5 call, a fraction of a cent).

**`coverage-check` runs on every pull request** (`pull_request_target`,
2026-10-14, `Prompts/04` automation 2) and is skipped for anything but an
`agent/*` branch of this repository. On a task PR it spends one Haiku 5.5
call and one `jev` call each time the branch is pushed, unless the push
changes no test file, which needs no call. `pull_request_target` runs
`main`'s copy of the workflow with secrets and needs no approval, which is
why the job refuses forks and never executes the PR's files.

**`wiki-proposal` runs when any pull request closes** and is skipped unless
an `agent/*` branch of this repository merged. Then it spends one Haiku 5.5
call, unless the task's spec names no module file.

**`director-review` runs on a pull request to `main` that touches `.ai/` or
`.github/`** (`pull_request_target`, 2026-10-19, #178) and is skipped for an
`agent/*` branch, a bot's PR or a fork. Then it spends one Sonnet 5.5 call
(about $0.05) and posts one advisory comment. It fails nothing.

**`scorecard` runs weekly** (Mondays 06:17 UTC, #177), from `main`, with no
secret and no model call. Its results go to the Security tab; it is advisory.

### Which actions may run, and how they are pinned

Set by the human and read back with `gh api` on 2026-10-19:

| Setting (Settings → Actions → General, unless noted) | Value |
|---|---|
| Actions permissions | **Allow DavidDems, and select non-DavidDems, actions and reusable workflows**. "Allowed by GitHub" and "verified creators" are unticked |
| Allowed patterns | `actions/*`, `aws-actions/*`, `docker/*`, `github/*`, `ossf/*` |
| Require actions to be pinned to a full-length commit SHA | **On** |
| Workflow permissions | **Read repository contents and packages permissions** |
| Allow GitHub Actions to create and approve pull requests | **On**: the orchestrator opens review PRs (§4). No workflow approves anything (`TestNoWorkflowCanApprove`) |
| Security → Advanced Security: secret scanning, push protection | **On** |
| Security → Advanced Security: Dependabot alerts | **On** (2026-10-19), so Renovate and the Security tab see advisories. **Dependabot security updates stay off**: Renovate opens the update PRs (§7) |

The pin requirement is the server-side half of
`TestEveryActionIsPinnedToACommit`. The test stops an unpinned `uses:`
reaching `main`, and the setting stops GitHub running one at all, including
from an old commit. **A re-run of a deploy from before #174 now fails** at its
first action, because that commit's `deploy.yml` uses tags. Re-deploy from a
newer commit instead. A new action owner needs a pattern here before its first
run. Renovate keeps the SHAs and their `# vN` comments current (§7).

### Fork pull requests need approval from every outside contributor

`approval_policy: all_external_contributors` (set 2026-10-08; it was
`first_time_contributors`). The repository is public and forks are allowed,
and before D1 the orchestrator applied any `test-agent` run on a branch named
`agent/*` as a task's verdict, a fork's included. D1 closes that in code;
this setting keeps a fork's workflows from running at all until a human looks.

```powershell
gh api repos/DavidDems/fanwire/actions/permissions/fork-pr-contributor-approval
```

## 2. Secrets — all are *repository* secrets

| Secret | For |
|---|---|
| `ANTHROPIC_API_KEY` | The provider. Must be a **Claude Console** key — a Pro/Max plan does not grant API access, and an Organization-settings key is not the same thing. That mismatch caused the first four worker runs to fail. Also read, in one step that holds no GitHub token, by `ci-summary.yml` (2026-10-13, `Prompts/04` automation 1) `coverage-check.yml` (2026-10-14, automation 2) `spec-drift.yml` (2026-10-14, automation 3) and `wiki-proposal.yml` (2026-10-14, automation 4). |
| `AGENT_DISPATCH_TOKEN` | A fine-grained PAT, this repository only, **Actions: read+write** and **Contents: read+write**, nothing else. Every dispatch step prefers it. |
| `TYPESAFE_API_KEY` | Set 2026-10-08: the direct TypeSafe key for `jev` (route `api.typesafe.ai/v1/systemone`, model `jev-latest`). Read only by `.ai/bin/ask_jev.py`, in one step of a job that holds no other credential: `jev-smoke.yml` (dispatch-only) and, in shadow, `coverage-check.yml` and `spec-drift.yml` (2026-10-14). Never pasted into a session. |

`AI_GATEWAY_API_KEY` (the Vercel gateway route, which never returned a 200)
was deleted 2026-10-08: nothing read it, and a gateway key reaches every model
in its catalogue.

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

**Decided 2026-10-08: keep it.** It is a human gate between an agent
finishing and CI spending on its work, and the PR needs that human's review
to merge anyway. It sits in the end-to-end latency of every task, on purpose.

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

## 7. Renovate

**Added 2026-10-19** (#176). **The app is installed** (the human, 2026-10-19,
on Mend's free plan). As of the end of that day it had created nothing yet: no
Dependency Dashboard issue and no PR. That issue appearing is the proof it
runs. The config is
`.github/renovate.json`; `TestRenovateNeverMergesAnything` in
`.ai/tests/test_workflows.py` holds its safety properties.

**What it does.** Weekly, before 6am Monday Toronto time, it opens pull
requests updating dependencies:

| PR | Covers |
|---|---|
| `github-actions non-major` | Every action. They are pinned to a full SHA with a `# vN` comment; Renovate moves the SHA and the comment together (`helpers:pinGitHubActionDigests`). |
| `npm non-major` | `frontend/` and `infra/`. |
| `pip non-major` | `backend/pyproject.toml`, exact pins (ruff, mypy) included. |
| `docker non-major` | The base images in `docker/*.Dockerfile` and `docker-compose.yml`. |
| `claude CLI` | `providers.anthropic.cli_version` in `.ai/config.json`, via a custom regex manager. Labelled `recheck-d2b-flags`: before approving, confirm the new CLI still accepts `--setting-sources user --strict-mcp-config` (`.ai/docs/handoff.md` §10.1 D2b). The PR body says how. |
| one per package | Every major update. Majors are never grouped: a PR carrying several majors is unreviewable. (Renovate's monorepo preset still keeps one monorepo's packages together, e.g. `@vitest/*`.) |

Nothing is proposed until a release is **3 days old**, and `internalChecksFilter:
strict` means the branch is not even created before then, so a compromised
release pulled within days never reaches a PR. At most 5 PRs are open at once,
each labelled `dependencies`. The **Dependency Dashboard** issue lists what is
pending, waiting out its age, or blocked.

**No automerge, ever** (`.ai/docs/philosophy.md` §8). `automerge` and
`platformAutomerge` are both `false`, and the test fails if any
`automerge`-like key is turned on anywhere, or a preset brings one in. A
dependency bump is code from outside the repository; a human reads every one.

**You can approve these PRs for real.** They are authored by `renovate[bot]`, a
different actor from you, so your review satisfies the 1-approval rule of §3 the
way it does for agent PRs, rather than waiving it through the admin bypass the
way your own Director PRs merge. Use a normal approval.

**`agent-guard` skips them, correctly.** Their branches are `renovate/*`
(`branchPrefix` is stated explicitly), and `agent-guard` acts only on `agent/*`,
so `guard` is skipped and `guard-gate` passes. Renovate is not a worker and has
no task spec to be checked against; the test fails if the prefix ever starts
with `agent/`. `gate` (the test suites) still runs and is still required.

### Installing it (human)

1. Merge the PR that adds `.github/renovate.json` first. Renovate looks for a
   config on the default branch; finding one, it treats the repository as
   already onboarded and opens no onboarding PR.
2. Open <https://github.com/apps/renovate> and click **Install** (or
   **Configure** if the Mend Renovate app is already on the account).
3. Choose the account `DavidDems`, then **Only select repositories** →
   `DavidDems/fanwire`. Not "All repositories". Approve the permissions it
   asks for; it needs workflow write access because the action pins live in
   `.github/workflows/`.
4. If it lands you on Mend's developer-portal sign-up, sign in with GitHub and
   accept; the free tier is enough.
5. If a **"Configure Renovate"** onboarding PR appears anyway (the app was
   installed before step 1 merged), close it without merging: its
   `renovate.json` would compete with ours. Renovate reads
   `.github/renovate.json` on `main` from its next run.
6. Within about an hour, check the **Issues** tab for **"Dependency
   Dashboard"**. Its existence proves the app is running. Update PRs follow in
   the next Monday-morning window; ticking a box in the dashboard requests one
   immediately.
7. If a Renovate PR shows no checks, look in the Actions tab for a run waiting
   on approval and approve it as in §4.

**To decline or remove it:** <https://github.com/settings/installations> →
**Mend Renovate** → **Configure** → **Uninstall** (or drop `fanwire` from its
repository list), then delete `.github/renovate.json` and its test in a Director
PR. The fallback is `.github/dependabot.yml`, one entry per ecosystem
(`github-actions`, `npm` for `frontend/` and `infra/`, `pip` for `backend/`,
`docker`), each weekly with a `groups:` block and a `cooldown` of 3 days, and a
modest `open-pull-requests-limit`. Dependabot also keeps SHA pins current, but
it has no equivalent of the regex manager on `.ai/config.json`: the CLI pin
would go back to being bumped by hand.

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

## What a task costs, and the spend controls

**Not known yet.** `.ai/telemetry/` recorded about $0.38 for USERS-002, but it
drops the CLI's cache tokens: its records show 30–66 input tokens for a
~10k-token prompt, while the Claude Console showed 10.9M input and 86k output
tokens over the three days of September runs. Its prices were stale too.
Fixing that is D6 (`.ai/docs/handoff.md` §10). Until then, **the cost of a run
is the difference between the balances recorded just before and just after
it**: the Claude Console's credit balance and TypeSafe's.

Spend controls (human, 2026-10-08):

| Account | Control |
|---|---|
| Claude Console (`ANTHROPIC_API_KEY`) | Monthly spend limit **$40**; auto-recharge to $15 when below $5. The limit, not the balance, is what stops a runaway loop. |
| TypeSafe (`TYPESAFE_API_KEY`) | About $10 of credit; no limit configured here. |

Model cost is separate from Actions minutes, and is the only one that is
metered while the repository is public.
