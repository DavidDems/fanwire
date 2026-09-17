# CodeContext handoff

`wiki/CodeContext/` is the only wiki content a code-change subagent (category 3, CodeContext flavor — see `wiki/GeneralContext/UsageRules/AgentType/3-scripted-execution.md`) may ever see, and only the specific files its manager hands it by name.

## The handoff
A category 2 manager, before dispatching a unit of work, selects:
1. The one `wiki/CodeContext/Modules/0x0N-*.md` file for the entity/piece being touched.
2. The specific `wiki/CodeContext/Standards/*.md` file(s) it cites that are actually load-bearing for this task — not all five by default.
3. The exact interface/contract to implement (schema, method signature, event name) — the manager decides this, the subagent does not.

That file set is everything the subagent gets from `wiki/`. It is self-contained by construction: every `wiki/CodeContext/Modules/*.md` file cites its `wiki/CodeContext/Standards/*.md` sources by exact excerpt, so a manager handing over the module file plus the cited standards files gives the subagent everything it needs without it ever having to look elsewhere.

## MUST NOT
- The subagent must not browse, list, or search `wiki/` — neither `CodeContext/` nor `GeneralContext/` — beyond the files handed to it by path.
- The subagent must not request additional wiki files mid-task by asking its manager in free-form prompt — if the handed files are insufficient, that's a signal the manager under-scoped the handoff; the manager fixes the handoff, the subagent does not go looking itself.
- The subagent must not read or infer from `wiki/GeneralContext/` at all, including its own manager's brief in `wiki/GeneralContext/Prompts/`.
- The manager must not hand over a whole `wiki/CodeContext/Standards/*.md` file when only a specific section is load-bearing for the task — trim the excerpt into the handoff instead of forwarding the whole document by default, to keep the subagent's context minimal.

## Reporting back
The subagent does not communicate results to its manager by writing a summary prompt back. Instead:
- If the task resolves or changes a documented decision, the subagent updates **only** the one `wiki/CodeContext/Modules/*.md` file it was handed — no other wiki file, in either folder.
- In the test-first workflow, the wiki update can instead be deferred to a conditional agent that runs after the test result is known (pass/fail), rather than the code-change subagent itself guessing the outcome before tests finish.
- The manager reads the diff and the (possibly) updated module file directly — that combination is the subagent's entire report.
