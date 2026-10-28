---
name: wiki-update
description: Create or edit any wiki/ or .ai/docs/ document using the project's document types, canonical routing, size budgets and pre-commit checklist.
---

# WikiUpdate

Use for every edit under `wiki/` or `.ai/docs/`. Read the shared rules below
and the canonical routing section they name. These are writing instructions;
the deterministic linter and corpus migration are separate Prompt 10 PRs.

<!-- wiki-update:rules:start -->
## Document types

Each new Markdown document under `wiki/` or `.ai/docs/` starts with YAML
frontmatter declaring exactly one `type`, for example:

```yaml
---
type: reference
---
```

| Type | Contents and lifecycle | Budget (words) |
|---|---|---:|
| `reference` | Current facts: modules, standards, architecture, philosophy. Rewrite changed facts in place. No dated status blocks, history, "as of", or "Update, YYYY" notes. | 2,500 |
| `decision` | One numbered ADR: context, choice, consequences. Immutable after merge except for a `superseded_by:` frontmatter line linking its replacement decision. | 1,800 |
| `runbook` | A procedure: ordered steps, commands and expected output or success checks. No narrative history. Human commands are single-line PowerShell, each in its own fenced powershell block. | 1,500 |
| `prompt` | One active thread's self-contained brief. Follow the canonical prompt lifecycle; update on handoff, delete when complete. Dated continuation notes belong here. | 1,500 |
| `changelog` | Append-only event ledger: one physical line per entry with date, change and PR link. No explanations or decision rationale. Start another volume before exceeding budget. | 1,000 |

Count words as whitespace-delimited tokens in the UTF-8 document body,
excluding opening YAML frontmatter and including headings, tables and code.
Budgets are per file. Split by responsibility and link; never cut necessary
facts or broken-off procedures just to meet a number. For an existing file
over budget, keep the edit small, avoid increasing debt, and report needed
splits to the Director. Do not silently delete facts or expand a unit's scope.

## Routing and single ownership

Use `wiki/GeneralContext/Architecture/work-modes.md`, **How work is handed on
and planned**, as the canonical routing for queues, task state, live prompts,
decisions and session procedures. Read it before choosing a destination;
the worker prompt includes that section verbatim at the slot below.

{{WIKI_UPDATE_ROUTING}}

Use the ADR destination and numbering in that routing for new decisions;
leave legacy decision collections in place until their migration PR updates
all citations together. Do not create parallel copies.

Module facts belong in the module's `wiki/CodeContext/Modules/` reference;
cross-cutting standards and UI facts belong in their existing canonical
files. Project status belongs in `wiki/GeneralContext/index.md` (Current
state). Link to an existing owner instead of repeating its fact. History and
rationale belong in git and decision records; a changelog is only an event
index into those sources. Keep procedures in runbooks and temporary
continuation detail in prompts, rather than appending either to references.

## Before committing

1. Confirm the document type and owner. Use canonical routing and the index
   to find an existing home; create a file only for a distinct responsibility.
2. Declare a type on new documents. On an existing untyped document, keep a
   focused correction focused; report mixed-type content for migration rather
   than relabelling history as reference or migrating the corpus incidentally.
3. Check the change against code, the approved diff or the human's decision.
   Correct references in place with the smallest true edit. Match the existing
   voice and preserve exact Standards citations. A bug fix restoring documented
   behaviour, tests alone or an internal refactor usually needs no wiki edit.
4. Search for the fact's other occurrences. Link to its owner; do not add task
   summaries, commit lists or dated updates to references. Name the destination
   of removed facts, or the decision that supersedes them, in the PR.
5. Preserve merged decisions. Supersede with a new ADR and only the old ADR's
   `superseded_by:` line; never rewrite the original context or choice.
6. Count body words against the type budget. Keep all steps and success checks
   of a runbook together. Flag pre-existing debt instead of erasing facts.
7. Resolve changed links, paths, anchors, line and section citations against
   their targets, and search for inbound citations before moving anything.
8. Check the role and task's allowed paths. A module writer changes only its
   permitted module reference; report anything needing a Director elsewhere.
   Proposals apply these checks before returning replacements, without
   committing. Directors run applicable repository checks; workers rely on
   CI and report checks they cannot run. Identify restricted trees
   and any continuation in the reviewable PR. Never claim a doclint pass
   while the linter is still unimplemented.
<!-- wiki-update:rules:end -->

## Budget evidence

Measured at `eab70db891671461667fd53eb1e5531b1adf8b42`, before migration:
56 Markdown files under `wiki/` and `.ai/docs/`, using whitespace word counts.
None has opening YAML frontmatter, so body and whole-file counts coincide.
Classification is by intended job, not a claim that legacy content is pure.

| Intended type | Files | Median words | Maximum | Within chosen budget |
|---|---:|---:|---:|---:|
| reference | 34 | 2,007.5 | 14,600 | 23 |
| decision (legacy collections, not single ADRs) | 2 | 1,705.5 | 1,806 | 1 |
| runbook | 7 | 1,357 | 3,376 | 4 |
| prompt | 13 | 1,009 | 7,530 | 8 |
| changelog | 0 | — | — | — |

Reproduce by classifying all `Prompts/*.md` (including `_template.md`) as
prompt; the stems `human-decisions` and `decisions` as decision; the stems
`incident-runbook`, `dev-auth-setup`, `deploy-traps`, `github-automation-setup`,
`director-sessions`, `verification`, `tokens-check` as runbook; all remaining
files as reference. For each body, count the length of Python's `str.split()`.
The limits round above each observed median. No standalone decision or
changelog population exists: 1,800 is a conservative initial ADR ceiling
based on the legacy collections; 1,000 bounds an event index pending real
samples. Neither number is presented as a measured standalone median.

## Integration

Claude Code discovers this file directly. Codex discovers the thin entrypoint
in `.agents/skills/wiki-update/SKILL.md`, which reads this canonical source.
Do not copy the rules into that entrypoint or `.ai/skills/`.

`agentlib.promptbuild.writer_prompt` expands only the marked shared section,
and replaces its routing slot with the canonical section from `work-modes.md`.
Its `ai_root` is the executing script's trusted tools checkout from main;
neither task context, current directory nor the merged checkout supplies
instructions. The context maintainer gets the expansion before fenced data;
the proposal script uses the same expansion in its system prompt. Missing,
empty or ambiguous sources fail construction before a model call. No worker
read permissions or workflow credentials change.
