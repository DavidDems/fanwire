# 01 — Making the AI workflow live

**Status: the pipeline works. DEMO-001 completed end to end on 2026-09-21.**

```
DRAFT → READY → TEST_AGENT_RUNNING → TESTS_COMMITTED → BASELINE_CI
      → READY_FOR_IMPLEMENTATION → CODE_AGENT_RUNNING → IMPL_COMMITTED
      → IMPL_CI → COMPLETE
```

One attempt, no retries, no escalation. **$0.2738** total (2 invocations,
18,328 tokens). The red-baseline gate fired correctly: 2 failed / 474 passed,
`assert 404 == 200`.

Two steps remain, both small and both discovered by that run — see
**Left to do**.

> Incident history is deliberately not repeated here. Every bug, the run it came
> from and the PR that fixed it is in
> [`.ai/docs/handoff.md`](../.ai/docs/handoff.md) §4, and in the commit
> messages. This file is a checklist, not a diary.

---

## Done

### 0. GitHub Actions can run ✅

Repository made public, so Actions minutes are unmetered. Verified: `test-agent`
passes on `main` and on PRs; orchestrator and worker both dispatch and chain.

**You will keep seeing `agent-orchestrator` runs marked "skipped".** That is
correct, not a failure — it listens on `workflow_run` for *every* `test-agent`
completion, including on `main`, then skips anything that is not an `agent/*`
branch. A skipped job costs nothing. Ignore them.

### 1. Agent system merged to `main` ✅

PRs #23, #25, #26, #27, #28.

### 2. Provider API key ✅

`ANTHROPIC_API_KEY` set as a repository secret, with **$15 of credit**.

It must be a **Claude Console** API key. A Pro/Max plan does not grant API
access, and an Organization-settings key is not the same thing — that mismatch
is what made the first four worker runs fail.

Spend so far: **$0.074**. Check any time with:

```powershell
python .ai/bin/agentctl.py telemetry report
```

### 3. Branch protection ✅

A **ruleset** ("Workflow ruleset") on `main`: pull request required, 1 approval,
code-owner review, required status checks (`backend-test`, `frontend-test`,
`agent-infra-test`, `infra-synth`, `pip-audit`, `npm-audit`, `guard`), and a
strict up-to-date policy.

**Solo-repo caveat, worth remembering.** GitHub does not let a PR author approve
their own PR, and you are both the author and the only code owner — so your own
PRs could never satisfy the rule. Resolved by adding **Repository admin** to the
ruleset's bypass list with mode **"Pull requests only"**: still no direct pushes
to `main`, but you can merge a PR without a second approver.

This does not weaken the agent gate. Agent PRs are opened by
`agent-orchestrator.yml` using `github.token`, so their author is
`github-actions[bot]` — a different actor, which you *can* approve normally. The
bypass needs your own credentials, which no agent has.

⚠️ If you later add `AGENT_DISPATCH_TOKEN` (step 7) as a fine-grained PAT owned
by your account, workflows using it act **as you** and would inherit that
bypass. The PR-creation step is pinned to `github.token` specifically to keep
agent PRs bot-authored. Keep it that way.

### 4. Provider CLI on the runner ✅ — option A

`agent-worker.yml` runs `npm install -g @anthropic-ai/claude-code` per run.
Costs ~20–30s per invocation and needs nothing from you.

> Your note: *stay on A for now, might consider this once I get a Linux box to
> use VMs.* If you do switch, run the runner in a container or a VM you are
> willing to lose — the guard bounds what an agent can **commit**, not what it
> can **execute** during a run.

Known gap: the install is unpinned, so the CLI can change under you and break
the workflow with no change on your side —
[`handoff.md`](../.ai/docs/handoff.md) §5.6.

### 5. Pre-commit hook ✅

```powershell
git config core.hooksPath .ai/hooks
```

Blocks on ruff; **advisory** on the test suite, because this repo's own workflow
requires committing a failing test alone. CI is the real gate.

### 6. Run DEMO-001 to completion ✅

Done 2026-09-21. The test agent wrote three tests (one per acceptance
criterion, including a regression guard on the existing `/health`), the
baseline went red for the right reason, the code agent implemented
`GET /health/version`, and implementation CI passed.

**[PR #30](https://github.com/DavidDems/fanwire/pull/30) is open** for it —
opened by hand, because the workflow could not (step 9).

Worth looking at before you merge: the implementation reads `pyproject.toml`
from disk on every request rather than using `importlib.metadata`. It passes
the tests and it is in scope, but it is a judgement call a reviewer should make
— which is exactly what the human gate is for. Merge it, change it, or close it;
nothing depends on the endpoint.

To run it again, or to run any task:

```powershell
git switch main; if ($?) { git pull }
git switch -c agent/<TASK-ID> main; if ($?) { git push -u origin agent/<TASK-ID> }
gh workflow run agent-orchestrator.yml -f task_id=<TASK-ID>
```

Watch it without opening an agent session — state lives on the task branch, so
pull first or you are reading a stale file:

```powershell
git pull
python .ai/bin/agentctl.py status
python .ai/bin/agentctl.py state show DEMO-001
python .ai/bin/agentctl.py telemetry report
```

Or from GitHub, without pulling:
`gh run list --workflow=agent-orchestrator.yml`

**Expected path:**

```
DRAFT → READY → TEST_AGENT_RUNNING → TESTS_COMMITTED → BASELINE_CI
      → READY_FOR_IMPLEMENTATION → CODE_AGENT_RUNNING → IMPL_COMMITTED
      → IMPL_CI → COMPLETE
```

Two orchestrator runs happen before the test agent starts — the first only does
`validate`, commits `state.json`, and re-dispatches itself. One action per run
is the design, not a stall.

**What to watch for:**

| Sign | Meaning |
|---|---|
| `BASELINE_CI` goes green → `MANAGER_REVIEW` | **A success.** The red-baseline gate caught a test that pins nothing. |
| Stuck in `BASELINE_CI` or `IMPL_CI` with no new run | Probably `workflow_run` chaining. Go to step 7. |
| `ESCALATED` | Read `escalation_reason`. Nothing is lost; the state file is accurate. |

If it fails:

```powershell
gh run list --workflow=agent-orchestrator.yml --limit 5
gh run view <id> --log-failed
```

- [ ] Review the PR it opens, merge or close it, and decide whether to keep the
      `/health/version` endpoint. Nothing depends on it.

---

## Left to do

### 7. Add a dispatch token ⬅ **required, confirmed**

No longer conditional. During DEMO-001 the orchestrator **did not wake after
either CI run** — the task stalled at `BASELINE_CI` and again at `IMPL_CI`, and
both had to be nudged by hand. GitHub does not fire `workflow_run` for a run
that the default `GITHUB_TOKEN` started, so the CI-finished leg of the chain
never fires.

**Symptom:** a task sits in `BASELINE_CI` or `IMPL_CI` with no new run in the
Actions tab. Until the token is added, every task needs two manual nudges.

- [x] Fine-grained PAT: **Settings → Developer settings → Personal access tokens
      → Fine-grained tokens**. This repository only; **Actions: read and write**
      and **Contents: read and write**; nothing else. *(Created as
      `AGENT_DISPATCH_TOKEN`, scoped to this repo, with exactly: metadata read,
      actions read/write, code read/write.)*
- [x] Add it as a **repository** secret named `AGENT_DISPATCH_TOKEN` —
      **Settings → Secrets and variables → Actions → Secrets → Repository
      secrets → New repository secret**. Not an *Environment* secret; see the
      box below.

Every dispatch step already prefers it, so no code change is needed. Read the
bypass warning in step 3 before creating it.

> **Repository secret, not an environment secret.** The first attempt put the
> token in an environment (`fanwire environment`), which looks equivalent in the
> UI and is not. An environment secret is only injected into a job that declares
> `environment: <name>`, and none of the four dispatch steps do
> (`agent-orchestrator.yml` :128, :163, :203; `agent-worker.yml` :218). The
> expression `${{ secrets.AGENT_DISPATCH_TOKEN || github.token }}` then resolves
> the left side to empty and **silently falls back to `github.token`** — no
> error, no log line, and the `workflow_run` stall stays exactly as it was.
> Environments exist to gate deployments behind approvals, which is the opposite
> of what an unattended orchestrator wants.
>
> ```powershell
> gh secret set AGENT_DISPATCH_TOKEN --repo DavidDems/fanwire   # paste at prompt
> gh secret list --repo DavidDems/fanwire                       # must list two
> gh api -X DELETE "repos/DavidDems/fanwire/environments/fanwire%20environment"
> ```
>
> **Confirm it actually took.** Two separate checks, and the first is not
> evidence of the second:
>
> ```powershell
> gh secret list --repo DavidDems/fanwire     # 1. is it a repository secret?
> ```
>
> **2. Is the chain fixed?** This needs a task the **orchestrator itself**
> dispatches CI for. Nothing else tests it:
>
> | What you might watch | Does it test the token? |
> |---|---|
> | A merged PR, on any branch | **No.** |
> | A PR check run on an `agent/*` branch | **No** — `workflow_run` always fired for `pull_request`-triggered runs. |
> | An `agent-orchestrator` run marked `skipped` | **No** — that is the job's `if:` rejecting a non-`agent/*` branch, and most rows are these. |
> | A task passing `BASELINE_CI` → `READY_FOR_IMPLEMENTATION` **with no manual nudge** | **Yes.** This is the only proof. |
> | A task already `COMPLETE` | **No** — it is terminal and will never dispatch CI again. |
>
> So: start a **new** task and watch it cross a CI boundary unattended.
>
> ```powershell
> python .ai/bin/agentctl.py status                 # did it move past BASELINE_CI on its own?
> gh run list --workflow=agent-orchestrator.yml --limit 5
> ```
>
> If it sits in `BASELINE_CI` and only a hand-supplied `-f event=CI_FAILED`
> moves it, the token is still not reaching the workflow. See
> [`handoff.md`](../.ai/docs/handoff.md) §5.1, which was originally written too
> broadly and is now corrected.

**Manual recovery, until then.** A bare nudge does *not* work in a CI-wait
state: `next_action` returns `await_ci`, which does nothing. You have to supply
the result yourself, after checking what CI actually concluded:

```powershell
gh run list --workflow=test-agent.yml --branch agent/<ID> --limit 1
gh workflow run agent-orchestrator.yml -f task_id=<ID> -f event=CI_FAILED   # or CI_PASSED
```

A stalled task is never a lost task; the state file stays accurate.

**DONE**

### 7b. Revoke the old `fanwire token` PAT ⬅ **do this too**

A second, older fine-grained PAT (`fanwire token`) exists with **read/write on
administration, secrets, workflows, pull requests, code, commit statuses and
actions** — and its value is unaccounted for. That is the most privileged
credential in this project: `secrets: write` can read nothing but can *replace*
`ANTHROPIC_API_KEY`, and `workflows: write` can rewrite the very files that
enforce the permission model.

Nothing in the repo uses it. Before the dispatch token was added the repo had
exactly one secret (`ANTHROPIC_API_KEY`), so there is nothing to break.

- [x] **Settings → Developer settings → Personal access tokens → Fine-grained
      tokens → `fanwire token` → Delete.** *(Revoked 2026-09-22.)*

A token you cannot locate is a token you cannot rotate, and deleting it costs
nothing because `AGENT_DISPATCH_TOKEN` now covers the only automated use.

### 8. Learn the stop button

Worth doing once, deliberately, while nothing is at stake:

```powershell
python .ai/bin/agentctl.py state control DEMO-001 --set PAUSE   # stop, keep position
python .ai/bin/agentctl.py state control DEMO-001 --set RUN     # resume exactly there
python .ai/bin/agentctl.py state control DEMO-001 --set CANCEL  # stop for good
```

The emergency stop, if something runs away:

```powershell
gh workflow disable agent-orchestrator.yml
gh workflow disable agent-worker.yml
```

The state file stays accurate while they are off, and `gh workflow enable`
resumes exactly where it stopped.

**ALREADY DONE**

---

### 9. Merge PR #29 before merging PR #30

PR #30 (the DEMO-001 work) **cannot merge until #29 is in**. `agent-guard` is a
required check and it failed on #30 — the first time it had ever run on a real
agent branch — because it flagged the orchestrator's own `[agent-state]`
commits as an agent writing to `.ai/`.

Two correct design decisions had collided: state lives on the task branch so
the PR is self-documenting, and `.ai/**` is forbidden to agents. The PR-level
guard sees the whole branch and could not tell the two apart. #29 teaches it
the difference, as narrowly as possible — this task's `state.json` and
telemetry, and nothing else.

- [x] Merge #29 — merged 2026-09-22 02:53Z, `main` is now `3daac76` and the
      guard fix is live.
- [ ] **Update branch** on #30, wait for `guard` to re-run, then merge it.

**#30 needs "Update branch" rather than just a re-run.** It currently reads
`BEHIND` (its base is `60f14bd`, `main` is `3daac76`), the strict up-to-date
policy requires the update anyway, and `agent-guard` evaluates the PR's merge
ref — so it only picks up #29's fix once `main` is merged in. A bare "re-run
failed jobs" on the old ref fails again for the same reason. The `guard
FAILURE` you can see on #30 right now is that stale run, not a new verdict.

⚠️ **Expect one red X that is not your problem.** Updating the branch re-runs
`test-agent` on `agent/DEMO-001`, which wakes the orchestrator for a task that
is already `COMPLETE`, and until the fix for bug 15 lands that run **fails**
(`COMPLETE is terminal; CI_PASSED rejected` — run 35670385955 is the first
instance). It is cosmetic: `agent-orchestrator` is not a required check, the
state file stays `COMPLETE`, and nothing is lost. Merge on the strength of
`guard` and the six `test-agent` checks.

**DONE**

### 10. Let Actions open the review PR ✅

`gh pr create` failed with *"GitHub Actions is not permitted to create or
approve pull requests"*. The task still reached `COMPLETE` — only the PR was
missing.

- [x] **Settings → Actions → General → Workflow permissions** → tick
      **"Allow GitHub Actions to create and approve pull requests"**

Enabled 2026-09-21. Verify any time:

```powershell
gh api repos/DavidDems/fanwire/actions/permissions/workflow
# {"default_workflow_permissions":"read","can_approve_pull_request_reviews":true}
```

`default_workflow_permissions` stays **read** on purpose — every workflow
declares its own `permissions:` block, so the repo-wide default never needs to
grant anything.

⚠️ That setting also grants *approval*, which would let a workflow satisfy the
1-approval rule. Nothing in these workflows calls `gh pr review`, and
`.ai/tests/test_workflows.py` now fails the build if one ever does — alongside
the existing check that no workflow can merge. CODEOWNERS is the second layer.
**Unproven:** no workflow-opened PR has appeared yet, because the setting was
off for every run so far. The next task to reach `COMPLETE` is the test.

**DONE "Allow GitHub Actions to create and approve pull requests" is already enabled**

### 11. Head branches are deleted on merge ✅

Turned on 2026-09-21 (`delete_branch_on_merge: true`) — the mechanical fix for
the stacked-PR trap that [`03-open-decisions.md`](03-open-decisions.md) asked
for, and a candidate automation from
[`philosophy.md`](../.ai/docs/philosophy.md) §6 now closed.

**Done 2026-09-22: 26 stale branches deleted, `main` is the only one left.**
17 were provably merged (ancestors of `main`). The other 9 were squash-merged,
so they were not ancestors and needed checking individually — `git cherry`
compares by patch id, and `git diff main...<branch>` was empty for eight of
them. The ninth, `phase-2-3-4-manager-prompts`, held four human answers, all of
which were already on `main` in the same file. Nothing unique was lost.

To find deletable branches again later:

```powershell
git branch -r --merged origin/main | ForEach-Object { $_.Trim() -replace '^origin/','' } | Where-Object { $_ -notmatch '^(main|HEAD)$' }
```

**Manually delete all the old branches that have been merged with main**

---

## Done when

- [x] `agentctl status` shows `DEMO-001` as `COMPLETE`
- [x] `agentctl telemetry report` shows a full task's cost — $0.2738
- [ ] `AGENT_DISPATCH_TOKEN` is a **repository** secret and an
      `agent-orchestrator` run woke on `workflow_run` after CI *(step 7)*
- [ ] The old `fanwire token` PAT is revoked *(step 7b)*
- [ ] A PR was opened **by the workflow**, and you merged it *(step 10 is now
      enabled, so the next completed task should do this; the first one was
      opened by hand)*
- [ ] You have paused and resumed a task at least once *(step 8)*

Then the pipeline is live, and
[`.ai/docs/philosophy.md`](../.ai/docs/philosophy.md) §6 becomes the standing
job: read the traces, find the next thing a script could do instead of a person
or a model.
