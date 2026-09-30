# 00 — Session protocol

**Not a session prompt.** The shared rules every numbered prompt in this folder
points at, so none of them has to repeat it. Read this first, then your prompt.

## Which tier you are

You are a **Director**: a human-supervised interactive session. `AGENTS.md`
"Agent system" defines the two tiers and says which one you are in is decided by
the branch your work lands on, not by what you were told. A Director has no path
restrictions and may write `.ai/`, `.github/`, `wiki/GeneralContext/` and
`AGENTS.md` — so **say plainly in the PR body when you have**, because on a
human-named branch one code-owner review is the only control.

A diff going to a branch named `agent/*` is a worker's diff whatever the prompt
says, and `agent-guard` will hold it to the task spec.

## The loop, per unit

1. **Cut the branch from `origin/main` explicitly**: `git switch -c agent/<TASK> origin/main`. `git switch -c` alone branches from whatever HEAD is.
2. **Delegate the tests to a subagent.** Give it the acceptance criteria, the exact list of files it may write, and the traps. Tests only, no implementation, no placeholder module to make an import resolve, no skips, **and it must never run `git`** — you commit.
3. **Review it yourself, verify the red is red for the right reason**, commit the tests alone. Distinguish "red because the thing under test does not exist" from "red because the test file is broken".
4. **Delegate the implementation to a second subagent.** Its contract is the committed tests. `allow_test_edits_during_impl` is false on every remaining spec: a diff touching a test file is discarded wholesale.
5. **Review, run every gate yourself, commit the implementation separately.**
6. **Update the relevant `wiki/CodeContext/Modules/0x0N-*.md`** if the unit changed a documented decision. A subagent handed no wiki path cannot do this — it is yours.
7. **Push, open the PR, hand to the human. Merge nothing.**

Give each subagent its own git worktree and its own dependency install. **Never
`git stash`** — the stash stack is shared across worktrees.

## Verification

A subagent's report is evidence, not a result. Run every gate yourself:

```powershell
cd frontend; npm test; npm run typecheck; npm run lint; npm run build
docker compose run --rm frontend-test    # then: docker compose down
docker compose run --rm backend-test     # then: docker compose down
python -m pytest .ai -q; python .ai/bin/agentctl.py selfcheck
```

**A local pass is a hint; the container is the result.** `docker compose run`
reuses a tagged image, so rebuild explicitly when the branch changed:
`docker build -q -f docker/frontend.Dockerfile --target test -t fanwire-frontend-test:latest .`

Run the guard over your real diff before pushing — `.ai/docs/permissions.md` and
`agentlib.guard.check_diff(paths, role, spec, policy)`. It has caught a live
defect that CI would not have.

## Take objections seriously, and confirm them

Every implementation agent so far that said "this committed test is wrong" was
right. Reproduce it yourself before acting. If you do fix a test after seeing an
implementation, make it **its own commit**, say so plainly in the PR, and
**mutation-test** the affected assertions to prove they still fail when the
behaviour they pin is removed.

## Standing limits

- **Never run `cdk deploy` or `npm run deploy`** from any session. It is out of scope for this repo by design — `.ai/docs/handoff.md` §5.7.
- **Never start `.github/workflows/agent-orchestrator.yml`** for these tasks. It bills metered API credits; a subscription does not cover it (`TODO/04-first-deploy.md` §5).
- **Every command you hand the human is a single-line PowerShell command.** A multi-line or `sh`-flavoured one half-succeeds on their machine and has already cost a broken Route 53 token.
- Nothing in this repo has merge permission. Keep it that way.
