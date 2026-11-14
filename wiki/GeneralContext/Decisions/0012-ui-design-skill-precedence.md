---
type: decision
---

# 0012 - The ui-design skill: committed after review, and outranked

Decision: 2026-09-22, the human.

## Context

The `ui-design` skill (`omer-metin/skills-for-antigravity`) gives an agent
design guidance. Its own installer, `npx skills add`, would execute a third
party's code, and its `SKILL.md` tells the agent to "politely correct" a user
whose request conflicts with it.

## Choice

The skill is committed at `.claude/skills/ui-design/`: `SKILL.md` plus
`references/patterns.md`, `sharp_edges.md` and `validations.md`. That is
Markdown only, with no executable content.

- **It was installed by copying the files after a review**, not by running the
  `npx skills add` installer, which would execute a third party's code. Because
  the files are committed, they are pinned and reviewable as a diff.
- **Precedence:** `SKILL.md` tells the agent to "politely correct" a user whose
  request conflicts with it. That does not hold here: the human's decisions,
  and `wiki/CodeContext/Standards/design-principles.md`, win over the skill on
  any conflict.

## Consequences

- The FrontendUI pages outrank the skill too (`wiki/CodeContext/FrontendUI/index.md`, Precedence).
- Where the skill and the reference disagree, the reference says so in place:
  for example the skill's 44 × 44 target size against WCAG 2.2 AA's 24 × 24
  (`wiki/CodeContext/FrontendUI/accessibility.md`).
