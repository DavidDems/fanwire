# 01 — Making the AI workflow live

**Status: setup is complete. One thing left — run a task end to end.**

Everything a human had to do has been done. The system is merged, enabled and
funded. What remains is proving it works, which is step 6.

**No task has completed yet.** Four live runs, ten bugs found and fixed, each
getting further than the last. The next one is the first that could plausibly
go green.

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

```sh
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

```sh
git config core.hooksPath .ai/hooks
```

Blocks on ruff; **advisory** on the test suite, because this repo's own workflow
requires committing a failing test alone. CI is the real gate.

---

## Left to do

### 6. Run DEMO-001 to completion ⬅ the only open item

`agent/DEMO-001` is stuck in `TEST_AGENT_RUNNING` — left there by a bug since
fixed, but the branch cannot recover. Delete and recreate it:

```sh
git push origin --delete agent/DEMO-001
git branch -D agent/DEMO-001

git switch main && git pull
git switch -c agent/DEMO-001 main
git push -u origin agent/DEMO-001
gh workflow run agent-orchestrator.yml -f task_id=DEMO-001
```

Watch it without opening an agent session:

```sh
git pull                                          # state lives on the branch
python .ai/bin/agentctl.py status                 # where it is
python .ai/bin/agentctl.py state show DEMO-001    # why it is there
python .ai/bin/agentctl.py telemetry report       # what it cost
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

```sh
gh run list --workflow=agent-orchestrator.yml --limit 5
gh run view <id> --log-failed
```

- [ ] Review the PR it opens, merge or close it, and decide whether to keep the
      `/health/version` endpoint. Nothing depends on it.

### 7. Add a dispatch token — only if the chain stalls

Each run wakes the next with `gh workflow run`. `workflow_dispatch` chaining is
proven; the `workflow_run` leg (CI finishing → orchestrator waking) is **not yet
verified** and is the most likely thing to break.

**Symptom:** a task sits in `BASELINE_CI` or `IMPL_COMMITTED` with no new run in
the Actions tab.

- [ ] Fine-grained PAT: **Settings → Developer settings → Personal access tokens
      → Fine-grained tokens**. This repository only; **Actions: read and write**
      and **Contents: read and write**; nothing else.
- [ ] Add it as repository secret `AGENT_DISPATCH_TOKEN`.

Every dispatch step already prefers it, so no code change is needed. Read the
bypass warning in step 3 before creating it.

A stalled task is never a lost task — nudge it with
`gh workflow run agent-orchestrator.yml -f task_id=<ID>`.

### 8. Learn the stop button

Worth doing once, deliberately, while nothing is at stake:

```sh
python .ai/bin/agentctl.py state control DEMO-001 --set PAUSE   # stop, keep position
python .ai/bin/agentctl.py state control DEMO-001 --set RUN     # resume exactly there
python .ai/bin/agentctl.py state control DEMO-001 --set CANCEL  # stop for good
```

The emergency stop, if something runs away:

```sh
gh workflow disable agent-orchestrator.yml
gh workflow disable agent-worker.yml
```

The state file stays accurate while they are off, and `gh workflow enable`
resumes exactly where it stopped.

---

## Done when

- [ ] `agentctl status` shows `DEMO-001` as `COMPLETE`, or a state you
      understand and chose
- [ ] `agentctl telemetry report` shows a full task's cost
- [ ] A PR was opened by the workflow, and **you** merged it
- [ ] You have paused and resumed a task at least once

Then the pipeline is live, and
[`.ai/docs/philosophy.md`](../.ai/docs/philosophy.md) §6 becomes the standing
job: read the traces, find the next thing a script could do instead of a person
or a model.
