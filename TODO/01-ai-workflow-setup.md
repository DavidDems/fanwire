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

```sh
git switch main && git pull
git switch -c agent/<TASK-ID> main && git push -u origin agent/<TASK-ID>
gh workflow run agent-orchestrator.yml -f task_id=<TASK-ID>
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

- [ ] Fine-grained PAT: **Settings → Developer settings → Personal access tokens
      → Fine-grained tokens**. This repository only; **Actions: read and write**
      and **Contents: read and write**; nothing else.
- [ ] Add it as repository secret `AGENT_DISPATCH_TOKEN`.

Every dispatch step already prefers it, so no code change is needed. Read the
bypass warning in step 3 before creating it.

**Manual recovery, until then.** A bare nudge does *not* work in a CI-wait
state: `next_action` returns `await_ci`, which does nothing. You have to supply
the result yourself, after checking what CI actually concluded:

```sh
gh run list --workflow=test-agent.yml --branch agent/<ID> --limit 1
gh workflow run agent-orchestrator.yml -f task_id=<ID> -f event=CI_FAILED   # or CI_PASSED
```

A stalled task is never a lost task; the state file stays accurate.

**I have several things to clarify before we consider this DONE. Firstly, I already had a fine-grained personal access token created for this project 'fanwire token', I don't remember writing down its value in any file, but its possible I wrote its value into something when I created this PAT.**
This old PAT's permissions are;
 Read access to metadata
 Read and Write access to actions, administration, code, commit statuses, pull requests, secrets, and workflows
With that being said, I decided to create a new PAT (scoped only for the fanwire repo), called 'AGENT_DISPATCH_TOKEN', it has less permissions than the other one;
 Read access to metadata
 Read and Write access to actions and code
but its value was stored in a safe location on my computer and the PAT exists.
You said to 'Add it as repository secret `AGENT_DISPATCH_TOKEN`', which I was not exactly sure what you wanted me to do.
The project has no existing env variables, only github actions 'Repository secrets: ANTHROPIC_API_KEY', so I had to create an environment for this repo so that I could create an env secret.
This is the new PAT in the repo as you asked:
Environment secrets;
AGENT_DISPATCH_TOKEN    fanwire environment
It exists in the repo, confirm if this is what you wanted.

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

- [ ] Merge #29, then re-run the checks on #30 and merge it.

### 10. Let Actions open the review PR

`gh pr create` failed with *"GitHub Actions is not permitted to create or
approve pull requests"*. The task still reached `COMPLETE` — only the PR is
missing, and you can open it by hand.

- [ ] **Settings → Actions → General → Workflow permissions** → tick
      **"Allow GitHub Actions to create and approve pull requests"**

⚠️ That setting also grants *approval*, which would let a workflow satisfy the
1-approval rule. Nothing in these workflows calls `gh pr review`, and
`.ai/tests/test_workflows.py` now fails the build if one ever does — alongside
the existing check that no workflow can merge. CODEOWNERS is the second layer.

If you would rather not enable it, leave it off and open each PR by hand; the
orchestrator now prints the exact command when it cannot.

---

## Done when

- [x] `agentctl status` shows `DEMO-001` as `COMPLETE`
- [x] `agentctl telemetry report` shows a full task's cost — $0.2738
- [ ] A PR was opened **by the workflow**, and you merged it *(blocked on step 9;
      the first one was opened by hand)*
- [ ] You have paused and resumed a task at least once *(step 8)*

Then the pipeline is live, and
[`.ai/docs/philosophy.md`](../.ai/docs/philosophy.md) §6 becomes the standing
job: read the traces, find the next thing a script could do instead of a person
or a model.
