# 01 — Making the AI workflow live

**Status: blocking.** The agent system is committed and its deterministic half
is tested, but it has never executed. Nothing below can be done by an agent —
these are credentials, repository settings and one judgement call.

Estimated time: ~30 minutes, plus waiting on the first run.

Background, if you want it: [`.ai/docs/operations.md`](../.ai/docs/operations.md)
is the full runbook; [`.ai/docs/philosophy.md`](../.ai/docs/philosophy.md) is why
the system is shaped this way.

---

## 0. Check that GitHub Actions can actually run — do this first

**Observed 2026-09-20:** pushing the `agent-system` branch and opening PR #23
created **no workflow runs at all**. Not a failed run — no run. The newest run
in the whole repository is from the previous day, so this is repo-wide and not
caused by anything in this branch.

`fanwire` is a **private** repository, so Actions minutes are metered against
the free monthly allowance. When that allowance is exhausted, or a spending
limit of $0 is set, GitHub silently stops creating runs. That matches the
symptom exactly, but it could not be confirmed from here — reading billing
needs a token scope this session does not have.

- [ ] GitHub → **Settings → Billing and plans → Plans and usage** → check
      Actions minutes remaining and any spending limit
- [ ] If exhausted: wait for the cycle to reset, raise the spending limit, or
      make the repository public (public repos get unmetered Actions)

**Why this is item 0:** the entire agent system is GitHub Actions. Without it,
`agentctl` and the state machine still work locally, but nothing dispatches,
no tests run, and the guard never fires. Every item below assumes Actions runs.

**Confirm:** push any commit and see a `test-agent` run appear in the Actions
tab.

---

## 1. Merge the agent-system PR

- [ ] Review and merge the `agent-system` branch into `main`.

Everything below assumes these files are on `main`. The workflows only dispatch
from the default branch.

**Confirm:** `.github/workflows/agent-orchestrator.yml` appears in the Actions
tab as a workflow you can run.

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

---

## 5. Install the pre-commit hook locally (optional, 10 seconds)

```sh
git config core.hooksPath .ai/hooks
```

Runs ruff over staged Python and the `.ai/` suite when you touch it. Purely a
convenience for your own commits — agent commits are checked by CI, not by
this. See [`.ai/hooks/README.md`](../.ai/hooks/README.md).

---

## 6. Run DEMO-001 — the first live task

Do this before pointing the system at anything real. `DEMO-001` adds a
`GET /health/version` endpoint: additive, two files, disposable.
[`.ai/tasks/DEMO-001/brief.md`](../.ai/tasks/DEMO-001/brief.md) explains why
that shape was chosen and what to watch.

- [ ] Create the branch and start it:

```sh
git switch -c agent/DEMO-001 main
git push -u origin agent/DEMO-001
gh workflow run agent-orchestrator.yml -f task_id=DEMO-001
```

- [ ] Watch it, from your own machine, without opening an agent session:

```sh
python .ai/bin/agentctl.py status            # where it is
python .ai/bin/agentctl.py state show DEMO-001   # why it is there
python .ai/bin/agentctl.py telemetry report      # what it cost
```

(Run `git pull` on the task branch first — state lives on the branch.)

**Expected path:**

```
READY → TEST_AGENT_RUNNING → TESTS_COMMITTED → BASELINE_CI
      → READY_FOR_IMPLEMENTATION → CODE_AGENT_RUNNING → IMPL_COMMITTED
      → IMPL_CI → COMPLETE
```

**If `BASELINE_CI` goes green** and the task lands in `MANAGER_REVIEW`, that is
*also* a successful demonstration — it is the red-baseline gate catching a test
that pins nothing. See [`.ai/docs/state-machine.md`](../.ai/docs/state-machine.md).

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
