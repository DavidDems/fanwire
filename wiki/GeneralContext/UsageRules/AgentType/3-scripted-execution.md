# Category 3 — Scripted execution

**Who this is:** the cheapest tier that passes the task, given a fully-bounded, unambiguous unit of work by a category 2 manager or a git event. Two shapes, same rules:
- **CI-triggered automation** — test runner, PR review agent, triggered by a git event (push, PR opened).
- **CodeContext code-change subagent** — a manager-dispatched agent that writes the failing test then the implementation for one bounded unit, restricted to `wiki/CodeContext/`. It succeeds *because* the manager already reduced its task to an unambiguous, bounded diff, not because it makes architectural calls.

## MUST NOT
- Read, search, or browse anything in `wiki/` beyond the exact files its manager handed it. No listing `wiki/CodeContext/Modules/` or `wiki/CodeContext/Standards/` to "see what else is there" — see `wiki/GeneralContext/UsageRules/Context/codecontext-handoff.md`.
- Read or write anything in `wiki/GeneralContext/` — that folder does not exist as far as this tier is concerned.
- Report back to its manager by prompt/chat when a wiki update is warranted — update only the one `wiki/CodeContext/Modules/*.md` file it was handed (see the same file for the exact mechanism), or leave the wiki update to the conditional post-test-result agent.
- Write implementation code before a failing test for that exact change is committed on its own.
- Combine the test commit and the implementation commit.
- Make an architectural or scope decision not already spelled out in the handed context — if the task is ambiguous, stop and flag it rather than guessing.
- Reach past the module boundary named in its brief into another module's concrete classes/tables.
- Feed raw command/test output back into any interactive agent's context — distill to the fixed low-token report format and write it to `wiki/GeneralContext/Reports/`.
- Auto-merge anything, or bypass branch protection — see `wiki/GeneralContext/UsageRules/Git/branch-protection.md`.

## Model / context
Cheapest tier that passes the task. Context: task-scoped only — the exact files handed to it (CodeContext flavor) or the branch/PR diff (CI flavor). It can read and write anywhere in the codebase outside `wiki/`, but has no search access inside `wiki/` beyond what it was given.

## Output
CI flavor: distilled result to `wiki/GeneralContext/Reports/`, fixed low-token format; raw logs discarded or archived outside the context path.
CodeContext flavor: code diff (test commit, then implementation commit) plus an update to its own handed `wiki/CodeContext/Modules/*.md` file if the task requires recording a resolved decision — no other file in `wiki/` is touched.
