# 01 — Making the AI workflow live

**Status: steps 0–5 done. Step 6 is the only one left.**

Progress so far: repo made public so Actions runs, PR merged, `ANTHROPIC_API_KEY`
added, branch protection on with every setting, staying on the hosted-runner CLI
install, pre-commit hook installed.

The first live run of DEMO-001 failed on **my bugs, not your setup** — three of
them, fixed on the `agent-system-fixes` branch. Merge that, then redo step 6.
Step 7 has not been reached yet; it will only matter if the chain stalls.

Background, if you want it: [`.ai/docs/operations.md`](../.ai/docs/operations.md)
is the full runbook; [`.ai/docs/philosophy.md`](../.ai/docs/philosophy.md) is why
the system is shaped this way.

---

## 0. ~~Check that GitHub Actions can actually run~~ — RESOLVED ✅

You made the repository public. Actions runs fine: `test-agent` has passed on
`main` and on both PRs, and `agent-orchestrator` now dispatches.

**The "skipped" runs you saw were correct, not a failure.** `agent-orchestrator`
also triggers on `workflow_run` — every time `test-agent` finishes, anywhere,
including on `main`. Its job then checks whether the branch is an `agent/*`
branch and skips if not. That is the design: a `test-agent` run on `main` is the
ordinary quality gate and none of the orchestrator's business. A skipped job
costs no minutes. Expect to keep seeing them, and ignore them.

The runs that matter are `[workflow_dispatch]` and `[workflow_run]` on an
`agent/*` branch.

---

## 1. Merge the agent-system PR

- [ ] Review and merge the `agent-system` branch into `main`.

Everything below assumes these files are on `main`. The workflows only dispatch
from the default branch.

**Confirm:** `.github/workflows/agent-orchestrator.yml` appears in the Actions
tab as a workflow you can run.

DONE

---

## 2. Add the provider API key

The only secret the system needs to function.

- [ ] GitHub → repo **Settings → Secrets and variables → Actions → New
      repository secret**
  - Name: `ANTHROPIC_API_KEY`
  - Value: a key from <https://console.anthropic.com/settings/keys>

**Why:** `agent-worker.yml` passes it to `.ai/bin/invoke_agent.sh`, and only to
that one step. No other step, and no agent process, can see it.

**Cost note:** this is the only thing in the system that spends money. Set a
spend limit on the key while you are getting started — the retry budget is
capped at 3 attempts per task and 8 absolute, but a misconfigured loop is
cheaper to catch with a hard limit than with attention.

**Confirm:** `ANTHROPIC_API_KEY` is listed under repository secrets. Do not
paste it anywhere else; nothing in the repo should ever contain the value.

DONE

---

## 3. Turn on branch protection for `main`

**This is the single most important item in this file.** The agent system
deliberately has no way to merge anything — no workflow requests merge
permission. Branch protection is what makes that a guarantee rather than a
convention.

- [ ] GitHub → **Settings → Branches → Add branch protection rule** for `main`:
  - [ ] Require a pull request before merging
  - [ ] Require approvals: **1**
  - [ ] Require review from Code Owners *(activates the committed
        [`.github/CODEOWNERS`](../.github/CODEOWNERS), which flags changes to
        `.ai/`, `.github/`, `AGENTS.md` and `wiki/GeneralContext/`)*
  - [ ] Require status checks to pass before merging, and select:
        `backend-test`, `frontend-test`, `agent-infra-test`, `infra-synth`,
        `pip-audit`, `npm-audit`, `guard`
  - [ ] Require branches to be up to date before merging
  - [ ] **Do not** allow bypass for `github-actions[bot]`, administrators, or
        anyone else

**Why the `guard` check matters:** it is
[`agent-guard.yml`](../.github/workflows/agent-guard.yml), which fails any
agent PR that writes outside its declared paths. It runs independently of the
orchestrator on purpose — a boundary checked only by the thing being bounded is
not a boundary.

**Confirm:** open a throwaway PR and check that the merge button is blocked
until checks pass and someone approves.

DONE, every setting was set

---

## 4. Decide how the provider CLI reaches the runner

One judgement call. The agent worker needs the `claude` CLI on the runner.

**Currently implemented (option A):** `agent-worker.yml` runs
`npm install -g @anthropic-ai/claude-code` on each run. It works on
GitHub-hosted runners with no setup from you, and costs ~20–30 seconds per
agent invocation.

- [ ] Accept option A (do nothing), **or**
- [ ] Switch to a self-hosted runner with the CLI pre-installed, and delete the
      install step from `agent-worker.yml`

Option B is faster and gives you control over the environment, but a
self-hosted runner executes agent-authored code on your machine. If you take
it, run it in a container or a VM you are willing to lose — the guard bounds
what an agent can *commit*, not what it can execute during a run.

**Recommendation:** stay on A until run time actually bothers you.

Stay on A for now, might consider this once I get a linux box to use VM's.

---

## 5. Install the pre-commit hook locally (optional, 10 seconds)

```sh
git config core.hooksPath .ai/hooks
```

Runs ruff over staged Python and the `.ai/` suite when you touch it. Purely a
convenience for your own commits — agent commits are checked by CI, not by
this. See [`.ai/hooks/README.md`](../.ai/hooks/README.md).

DONE, ran 'PS C:\Users\david\source\repos\fanwire> git config core.hooksPath .ai/hooks' with no output (no failure)

---

## 6. Run DEMO-001 — the first live task

**Your run failed. That was my bug, not your setup.** Three of them, all now
fixed on the `agent-system-fixes` branch. What you did was correct.

### What went wrong

Run [35551731774](https://github.com/DavidDems/fanwire/actions/runs/35551731774)
failed at the *Decide the next action* step:

```
agentctl: no state file for DEMO-001; run `agentctl state init DEMO-001`
```

A chicken-and-egg. `agentctl next` refused to answer without a state file — but
the action it should have returned is `validate`, which is the step that
*creates* that state file. So a brand-new task could never start. Every unit
test passed because they all hand `next_action` a state dictionary directly;
nothing exercised the CLI wrapper, which is where the bug was.

Two more bugs sat behind it, which the run never reached:

- **Dispatching a worker never moved the state machine.** The orchestrator
  would have started the test agent without emitting `DISPATCH_TEST_AGENT`, so
  the worker's `AGENT_COMMITTED` would have been an illegal transition. Worse,
  `DISPATCH_CODE_AGENT` is what increments the attempt counter — so the retry
  budget would never have been spent, and the retry loop would have had **no
  ceiling at all**. That mapping lived only in workflow YAML, where no test
  could see it; it now lives beside the transition table and is tested.
- **The two triggers used different concurrency keys** for the same task, so a
  CI-woken run and a dispatch-woken run could interleave and half-apply
  transitions.

Also: `agentctl status` said "no tasks" while DEMO-001 existed, because it
keyed on state files rather than specs. Fixed — it now shows `DRAFT`.

### What you need to do

- [ ] Merge the `agent-system-fixes` PR
- [ ] Delete the stale branch and re-run:

```sh
git push origin --delete agent/DEMO-001
git branch -D agent/DEMO-001

git switch main && git pull
git switch -c agent/DEMO-001 main
git push -u origin agent/DEMO-001
gh workflow run agent-orchestrator.yml -f task_id=DEMO-001
```

- [ ] Watch it. State lives on the task branch, so pull before looking:

```sh
git pull                                          # refresh state.json
python .ai/bin/agentctl.py status                 # where it is
python .ai/bin/agentctl.py state show DEMO-001    # why it is there
python .ai/bin/agentctl.py telemetry report       # what it cost
```

Or watch from GitHub without pulling at all:
`gh run list --workflow=agent-orchestrator.yml`.

**Expected path:**

```
DRAFT → READY → TEST_AGENT_RUNNING → TESTS_COMMITTED → BASELINE_CI
      → READY_FOR_IMPLEMENTATION → CODE_AGENT_RUNNING → IMPL_COMMITTED
      → IMPL_CI → COMPLETE
```

The first orchestrator run now does `validate` (creating `state.json`,
committing it to the branch) and then re-dispatches itself. So expect **two**
orchestrator runs before the test agent starts. That is normal — one action per
run is the design.

**If `BASELINE_CI` goes green** and the task lands in `MANAGER_REVIEW`, that is
*also* a successful demonstration — the red-baseline gate catching a test that
pins nothing. See [`.ai/docs/state-machine.md`](../.ai/docs/state-machine.md).

**If it fails again**, the useful command is:

```sh
gh run list --workflow=agent-orchestrator.yml --limit 5
gh run view <id> --log-failed
```

The state file is never lost — whatever happened, `state show` tells you where
it stopped and `next` tells you what it would do.

- [ ] Review the PR it opens, merge or close it, and decide whether to keep the
      endpoint. Nothing depends on it.

---

## 7. If the chain stalls — add a dispatch token

**Only if you hit this.** Each workflow run wakes the next with
`gh workflow run`. GitHub restricts workflows triggered by the default
`GITHUB_TOKEN` from triggering further runs in some circumstances. This is the
one part of the system that could not be verified without a live run.

**Symptom:** a task sits in a state with no new run appearing in the Actions
tab — typically `READY` (worker never dispatched) or `IMPL_COMMITTED` (CI never
triggered).

**Fix:**

- [ ] Create a fine-grained PAT: **Settings → Developer settings → Personal
      access tokens → Fine-grained tokens**
  - Repository access: this repository only
  - Permissions: **Actions: Read and write**, **Contents: Read and write**
  - Nothing else
- [ ] Add it as repository secret `AGENT_DISPATCH_TOKEN`

Every dispatch step already prefers it and falls back to `github.token`, so no
code change is needed.

**Meanwhile, a stalled task is never a lost task.** The state file is accurate;
nudge it manually with
`gh workflow run agent-orchestrator.yml -f task_id=<ID>`.

---

## 8. Learn the stop button before you need it

Worth doing once, deliberately, while nothing is at stake:

```sh
python .ai/bin/agentctl.py state control DEMO-001 --set PAUSE   # stop, keep position
python .ai/bin/agentctl.py state control DEMO-001 --set RUN     # resume exactly there
python .ai/bin/agentctl.py state control DEMO-001 --set CANCEL  # stop for good
```

Pausing refuses every workflow event and dispatches nothing. Resuming continues
from the same state — that is why human control is a separate field rather than
a state. You can also just disable the workflows in the Actions tab; the state
file is still correct when you turn them back on.

---

## Done when

- [ ] `agentctl status` shows `DEMO-001` as `COMPLETE` (or a state you
      understand and chose)
- [ ] `agentctl telemetry report` shows non-zero cost
- [ ] A PR was opened by the workflow, and **you** merged it
- [ ] You have paused and resumed a task at least once

Then the pipeline is live, and
[`.ai/docs/philosophy.md`](../.ai/docs/philosophy.md) §6 becomes the standing
job: read the traces, find the next thing a script could do instead of a person
or a model.
