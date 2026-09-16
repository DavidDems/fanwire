## Context rules
- Every file is written for a human reader or an agent reader, never both. State which at the top of agent-facing files.
- Human files: state, decisions needed, open questions. No implementation detail.
- Agent files: same state, plus build/test/run commands, conventions, constraints.
- Inline "why" comments allowed in code. Not self-maintained by the authoring agent — reviewed/pruned by category 4 on schedule.
- No implementation for a new feature/change without a preceding failing test committed first. Test defines the contract; write it against the intended interface even if the entity doesn't exist yet.
- Wiki holds current-state context only. No history, no diary, no superseded decisions — git history is the diary.
- Wiki entries are pruned/merged when they stop being referenced or a correction supersedes them.
- Context audit runs weekly (category 4): flag wiki bloat, stale references, size/performance impact.

## Agent categories

### 1. Discussion
- Trigger: interactive, me.
- Model: highest-reasoning tier available.
- Context: full project context, human-facing files, wiki as needed.
- Output: conversation only. No file writes unless asked.

### 2. Code & wiki edits
- Trigger: interactive, me.
- Model: highest-coding tier available.
- Context: AGENTS.md/equivalent + only the wiki entries relevant to the touched code (just-in-time, not full wiki dump).
- Sequence: (1) write failing test against the requested change, commit, (2) implement until it passes, commit. Never skip (1) or combine into one commit.
- Output: code diff, wiki entries updated/added, commit.

### 3. Scripted execution
- Trigger: git event (e.g. push to `/tests`, PR opened).
- Model: cheapest tier that passes the task.
- Context: task-scoped only (the branch/PR diff).
- Action: run shell/tests/queries. Never feed raw output back into an interactive agent's context.
- Output: distilled result written to `reports/`, fixed low-token format. Raw logs discarded or archived outside context path.

### 4. Scheduled maintenance
- Trigger: cron.
- Model: cheapest tier that passes the task.
- Context: wiki + reports directory metadata only.
- Action: context-size/performance audit, prune stale wiki entries and stale/inaccurate code comments, flag items needing my input.
- Output: report in `reports/maintenance/`. Never edits code.

## Example repo layout

```
project-root/
├── README.md              # human entry point
├── AGENTS.md               # agent entry point: build/test/run, conventions
├── .ai/
│   ├── settings.json
│   ├── skills/
│   └── hooks/
├── wiki/
│   ├── index.md
│   ├── 0x00-architecture.md
│   └── 0x01-auth.md
├── reports/
│   ├── test-runs/
│   ├── context-audit/
│   └── maintenance/
├── .github/
│   └── workflows/
│       ├── test-agent.yml        # category 3, on push to /tests
│       ├── pr-review-agent.yml   # category 3, on PR opened
│       └── context-audit.yml     # category 4, cron
└── code/                   # the actual code repository
    ├── src/
    └── tests/
```

## Maintenance actors (git actions)
- Pre-commit hook: lint/format before any commit reaches an agent's context.
- Push-to-`/tests` workflow: runs category 3, writes `reports/test-runs/`.
- PR-opened workflow: runs category 3 review agent, writes `reports/`, comments on PR.
- Merge-to-main workflow: category 3, reconciles wiki hex refs with the merged diff (new/changed/removed refs).
- Cron workflow: category 4, weekly context audit, opens a PR or report for my review — never auto-merges.
- Branch protection: agent-authored commits/PRs require my approval to merge.
