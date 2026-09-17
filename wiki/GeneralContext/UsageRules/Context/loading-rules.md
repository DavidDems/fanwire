# Context loading

## MUST NOT
- Front-load the whole wiki (either folder) into context "to be safe" — load `wiki/GeneralContext/index.md` (manager tier) or the exact handed files (subagent tier), then pull in more only as a specific need arises.
- Give a code-change subagent a file from `wiki/GeneralContext/` — its context is `wiki/CodeContext/` only, see `wiki/GeneralContext/UsageRules/Context/codecontext-handoff.md`.
- Have a manager-tier agent skip `wiki/GeneralContext/index.md` and jump straight to a module file — the index carries the rule index and module map that make the module file's cross-references resolvable.
- Re-read a reference doc's full content when the citing wiki file already states the specific rule inline — follow the link only when the summary is insufficient for the task at hand.
- Write a file for both a human and an agent reader. State which at the top of every agent-facing file; human files carry state/decisions/open-questions, agent files carry that plus build/test/run/conventions/constraints.
