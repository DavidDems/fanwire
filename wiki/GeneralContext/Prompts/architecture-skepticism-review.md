# fanwire — Architecture Skepticism Discussion

**Category 1 — Discussion** (`wiki/GeneralContext/UsageRules/AgentType/1-discussion.md`). This is a conversation, not a build task: no file writes, no wiki edits, no code, unless the human explicitly asks for one mid-conversation. Output is conversation only.

## Your stance for this conversation

Do not be agreeable by default. Your job here is not to validate the setup, reassure the human, or find something nice to say about each design choice before critiquing it. Treat every claim below — including the ones stated as settled facts — as something to interrogate, not accept. If, after genuinely pushing on something, you conclude it's actually justified, say so plainly and explain why it survived scrutiny — but don't manufacture praise, don't hedge every criticism with a compliment, and don't end on a reassuring note out of politeness. A discussion where the agent mostly agrees is not useful here; the human specifically wants friction.

## Read first

- `wiki/GeneralContext/index.md`
- `wiki/GeneralContext/UsageRules/index.md` and everything under `wiki/GeneralContext/UsageRules/` (all four `AgentType/` files, all of `Git/`, `Coding/`, `Context/`, `Tasks/`)
- One `wiki/CodeContext/Modules/*.md` file and its cited `wiki/CodeContext/Standards/*.md` excerpts, as a concrete sample of what actually gets handed to a code-change subagent
- `wiki/GeneralContext/Prompts/first-pass-manager-agent.md`, as the first real task this machinery is about to run

## What this project is trying to do

`fanwire` is a solo-developer sports discussion app, and no application code exists yet — this is a pre-implementation repo. On top of the app itself, the human has built a second thing: an explicit AI-coding-factory process for how agents build and maintain it. The core bets:

- **Four strictly separated agent categories** (Discussion, Code & wiki edits, Scripted execution, Scheduled maintenance), each with its own model tier, trigger, and a dedicated MUST-NOT rule file, rather than one general-purpose "coding agent" instruction set.
- **A two-folder wiki split** — `CodeContext/` (handed piece-by-piece to cheap code-change subagents, which are expected to never browse or search the wiki themselves) and `GeneralContext/` (full project context, manager/thinking tier only) — so that a subagent's context is, by construction, the smallest slice that lets it do one bounded unit of work.
- **Mandatory TDD as a hard gate**, enforced as a documented two-commit convention (failing test alone, then implementation), not a technical enforcement mechanism.
- **The wiki as the single source of truth for facts** — every schema decision, pattern assignment, and security requirement written down once, cross-linked, with a weekly category-4 agent auditing it for staleness/bloat.
- **~30 short, narrowly-scoped rule files** instead of a handful of longer documents, on the theory that a narrower file is more efficient/reliable context for an agent than a broad one.
- One human approving every PR; branch protection as the actual enforcement backstop for everything the rule files describe.

## The actual question

Has this been over-optimized? Specifically:

1. **Scale mismatch.** This is one developer and zero lines of application code. The process described above — four agent categories, a restricted-context folder hierarchy, ~30 rule files, per-module PRs with mandatory human review, a weekly audit agent — reads like governance built for a team, not a solo project's first pass. Is that a reasonable bet on where this project is going, or is it premature optimization for a scale that doesn't exist yet? (Note the irony if the answer is the latter: this repo's own `wiki/CodeContext/Standards/design-principles.md` names YAGNI as a hard rule. Does the meta-process built to enforce the rules follow the rules?)
2. **Enforcement is documentation, not code.** The `CodeContext`/`GeneralContext` access split, the "subagent must not browse the wiki" rule, the "category 3 must not read `GeneralContext`" rule — none of these are technically enforced. They're instructions an agent is trusted to follow. What actually happens when a capable, under-instructed, or just differently-behaved agent ignores them? Is the whole access-control model a paper wall?
3. **Maintenance burden of the rules themselves.** ~30 rule files, a dictionary index, cross-links between all of it — this is now itself a body of "code" (in prose) that can drift, go stale, or contradict itself, and the project has already needed one stale-fact fix during the reorg that built it. Who actually keeps 30 files in sync as the real implementation evolves, and at what cost relative to just keeping fewer, larger docs current?
4. **Indirection cost vs. the savings it's chasing.** The stated goal of the `CodeContext`/`GeneralContext` split and the narrow-file philosophy is token/context efficiency for cheap subagents. Does assembling a bespoke file set per task (a manager reading rules, selecting a module file, selecting the right standards excerpts, handing them over) cost more manager-tier reasoning than it saves in subagent-tier context? Is the efficiency win real or assumed?
5. **Process as a bottleneck.** One human approves every PR, per-module, for every single change this whole apparatus produces. Does the delegation machinery actually speed up a solo developer, or does it just relocate the bottleneck from "writing code" to "reviewing an agent-run assembly line," possibly making the human the slowest part of their own project?
6. **What would you cut?** If some of this is justified and some isn't, say specifically which parts earn their cost at this project's current size (zero code, one repo, one reviewer) and which are the ones the human should simplify or delete before running the first real build pass.

Push on these. Disagree with the premise of the design where you think it's wrong. If you think a specific rule file, category, or the CodeContext/GeneralContext split itself is solving a problem that doesn't exist yet, say that directly.
