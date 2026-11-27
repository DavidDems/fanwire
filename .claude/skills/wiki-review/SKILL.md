---
name: wiki-review
description: A weekly by-hand pass over wiki/ and .ai/docs/ - run the doc linter, find budget overruns, duplicated facts, stale module facts, broken links and done backlog rows, and end in one reviewable PR.
---

# WikiReview

A periodic pass over the documentation, run by a Director session by hand
about weekly. It reports first and edits second. It makes no API call, adds no
workflow or schedule, and merges nothing.

Document types, budgets, routing and the pre-commit checklist are the
[WikiUpdate skill](../wiki-update/SKILL.md). Read it first and apply it to
every edit; this file does not restate it. The checks themselves are
[the linter reference](../../../.ai/docs/doclint.md).

## Hard rules

- Never rewrite a `decision`. Supersede it with a new ADR and the old file's
  `superseded_by:` line only (WikiUpdate, "Before committing", step 5).
- Never delete a fact without naming where it went: the file that now owns
  it, or the decision that supersedes it. A fact with no new home stays.
- Never relabel an untyped legacy file just to quiet a check.
- Never raise a budget or add a baseline entry. The baseline only shrinks.

## The pass

Work from a worktree on a Director branch cut from `origin/main`, never the
shared checkout. Run these in order and keep a list of findings.

1. **Lint.** `python .ai/bin/agentctl.py docs lint --base origin/main`. It
   exits 0 even when it finds errors, so quote its summary line and claim a
   pass only if it says `0 errors`. Add `--json` for violation keys. Baselined
   debt is expected; list the entries now cleared (a Director may prune them)
   and those still open.
2. **Budget overruns.** `agentctl docs inventory` lists words against budget
   per file with its inbound links. For each file over budget, propose a split
   by responsibility with links, not a cut. Report a split to the human for
   `Standards/`, `FrontendUI/` and `wiki/GeneralContext/`; do not do it alone.
3. **Duplicated facts.** `agentctl docs dupes` (exact and near repeats). Keep
   the fact in its owner (WikiUpdate, "Routing and single ownership"), replace
   the other copy with a link, and name the owner in the PR.
4. **Module facts against code.** For each `wiki/CodeContext/Modules/0x0N-*.md`
   (follow the index files' lettered parts), check named routes, tables,
   columns, events and settings against `backend/app/` and `frontend/src/`.
   Correct the reference in place with the smallest true edit. When the doc is
   right and the code is wrong, report a finding; do not edit the doc.
5. **Broken links.** The linter's link and citation errors; also inbound
   links to anything you move.
6. **Done backlog rows.** Each row of `TODO/02-backlog.md` whose work is on
   `main` (`git log origin/main`, `gh pr list --state merged`): delete the row
   and make sure the module reference states the new fact. A finished live
   prompt is deleted and gets one `Timeline/` line
   ([the index](../../../wiki/GeneralContext/index.md), "Task prompts").

## Report, then one PR

Report findings ranked most severe first, each with the file and the proposed
change. Put questions for the human last. Then make the safe edits in one
branch and one PR to `main`.

The PR body names every restricted-tree edit (`.ai/`, `.github/`,
`wiki/GeneralContext/`, `AGENTS.md`, `.claude/`), and for each removed passage
where its fact now lives. Re-run the lint and quote its `0 errors` line before
pushing; run the `.ai` suite alone when `.ai/` changed.
