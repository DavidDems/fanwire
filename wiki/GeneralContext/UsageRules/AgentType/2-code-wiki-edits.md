# Category 2 — Code & wiki edits (manager/thinking tier)

**Who this is:** the manager agent driving an implementation pass — e.g. the agent running `wiki/GeneralContext/Prompts/first-pass-manager-agent.md`. It does most of its own architectural thinking and delegates bounded units to category 3-shaped subagents.

## MUST NOT
- Implement before a failing test exists, committed alone, for the same change — see `wiki/GeneralContext/UsageRules/Coding/tdd.md`. No exceptions, no "trivial change" carve-out.
- Combine the failing-test commit and the implementation commit into one commit.
- Hand a subagent more than its one `wiki/CodeContext/Modules/` file plus the specific `wiki/CodeContext/Standards/` excerpts it needs — see `wiki/GeneralContext/UsageRules/Context/codecontext-handoff.md`. A full wiki dump defeats the point of a cheap subagent.
- Accept a subagent's diff without checking it against the connection rule (`wiki/GeneralContext/UsageRules/Coding/module-boundaries.md`) and the assigned pattern (`wiki/GeneralContext/UsageRules/Coding/patterns.md`) first.
- Parallelize two subagents that touch the same shared integration point (e.g. both editing `PublishPostFacade`) — sequence those instead.
- Push directly to `main`, or open one giant PR spanning multiple modules — one feature branch and one PR per module, see `wiki/GeneralContext/UsageRules/Git/branching-and-prs.md`.
- Leave a wiki file stale after a change resolves or contradicts something it documents — update it in the same pass, see `wiki/GeneralContext/UsageRules/Context/wiki-hygiene.md`.
- Silently resolve an open decision the wiki flagged as needing human input — make the simplest defensible call and say so in the PR description as a judgment call, never as a settled requirement.
- Modify anything under `wiki/GeneralContext/UsageRules/` as part of a code-delivery task — that folder is edited only in an explicit rules-maintenance task, never as a side effect of shipping a feature.

## Model / context
Highest-coding tier available. Context: `AGENTS.md` + `wiki/GeneralContext/index.md` first, then only the `wiki/CodeContext/` files relevant to the module being touched, loaded just-in-time — never the whole wiki up front.

## Output
Code diff, wiki entries updated/added, commits (test-first, then implementation, always two commits minimum per change), PR(s) opened for human approval.
