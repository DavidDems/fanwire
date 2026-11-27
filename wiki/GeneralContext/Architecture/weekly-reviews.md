---
type: runbook
---

# Weekly reviews

Two by-hand passes the human runs about once a week, each a Claude Code
session with the matching project skill. Neither calls the API, adds a
workflow or schedule, or merges anything
([ADR 0035](../Decisions/0035-outstanding-work-answers.md)). The skills hold
the checks; these prompts only start them.

1. Open a new Claude Code session in the repository root, on `main` and
   up to date.
2. Paste one of the two prompts below.
3. Read the report. Success is a ranked findings list, each with a file and a
   proposed change, and the questions for you last.
4. Answer the questions and tell the session which findings to fix. Each fix
   lands as its own Director PR, reviewed and merged by you.

## Wiki review

[`wiki-review`](../../../.claude/skills/wiki-review/SKILL.md) runs the doc
linter, budget overruns, duplicated facts, module facts against code, broken
links, orphan docs and done backlog rows. It ends in one reviewable PR.

```text
Run the wiki-review skill (.claude/skills/wiki-review/SKILL.md) on origin/main in a worktree. Report first: findings ranked most severe first, each with the file and the proposed change, and the lint's "0 errors" line quoted. Put your questions for me last. Then make the safe fixes in one PR to main, naming every restricted-tree edit and where each removed fact went. Never rewrite a decision; merge nothing.
```

## AI review

[`ai-review`](../../../.claude/skills/ai-review/SKILL.md) is read-only: stalled
or `HAND_RUNNING` tasks, items still unproven, metrics anomalies, Scorecard and
Dependabot findings, drift between `.ai/docs` and the workflows, and parked
briefs still marked live.

```text
Run the ai-review skill (.claude/skills/ai-review/SKILL.md) on origin/main in a worktree. Read only: files, agentctl status, agentctl metrics report and gh api GET requests. Report findings ranked most severe first, each with the file and the proposed change, and my questions last. Change no file and open no PR; I will choose which findings to fix.
```
