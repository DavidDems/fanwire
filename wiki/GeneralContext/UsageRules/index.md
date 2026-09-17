# Usage Rules — index

**Agent-facing, manager/thinking tier only.** How AI agents are used to build and maintain `fanwire`. Read alongside `wiki/GeneralContext/index.md`. This folder is modifiable only by a manager/thinking-tier (category 1–2) agent, and only in an explicit rules-maintenance task — never as a side effect of a code-delivery task.

Every file below is a short, strictly-scoped list of what an agent in that category/area **must not do**. When a manager starts a working agent, it lists that agent's `AgentType/` rules first, then the design/coding rules from `wiki/CodeContext/` relevant to the task — see `wiki/GeneralContext/UsageRules/Context/codecontext-handoff.md`.

## Context rules (apply everywhere)
- Every file is written for a human reader or an agent reader, never both. State which at the top of agent-facing files.
- Human files: state, decisions needed, open questions. No implementation detail.
- Agent files: same state, plus build/test/run commands, conventions, constraints.
- Inline "why" comments allowed in code. Not self-maintained by the authoring agent — reviewed/pruned by category 4 on schedule.
- No implementation for a new feature/change without a preceding failing test committed first. Test defines the contract; write it against the intended interface even if the entity doesn't exist yet.
- Wiki holds current-state context only. No history, no diary, no superseded decisions — git history is the diary.
- Wiki entries are pruned/merged when they stop being referenced or a correction supersedes them.
- Context audit runs weekly (category 4): flag wiki bloat, stale references, size/performance impact.

Full detail: `wiki/GeneralContext/UsageRules/Context/`.

## Agent categories
1. **Discussion** — `wiki/GeneralContext/UsageRules/AgentType/1-discussion.md`
2. **Code & wiki edits** — `wiki/GeneralContext/UsageRules/AgentType/2-code-wiki-edits.md`
3. **Scripted execution** — `wiki/GeneralContext/UsageRules/AgentType/3-scripted-execution.md`
4. **Scheduled maintenance** — `wiki/GeneralContext/UsageRules/AgentType/4-scheduled-maintenance.md`

## Rule areas
- **Agent type** (what each of the 4 categories may/may not do): `wiki/GeneralContext/UsageRules/AgentType/`
- **Git** (branching, PRs, branch protection, pre-commit, CI actors): `wiki/GeneralContext/UsageRules/Git/`
- **Coding** (TDD, module boundaries, patterns, design principles & security): `wiki/GeneralContext/UsageRules/Coding/`
- **Context** (loading discipline, CodeContext handoff, wiki hygiene): `wiki/GeneralContext/UsageRules/Context/`
- **Tasks** (scoping a unit of work): `wiki/GeneralContext/UsageRules/Tasks/`

## Repo layout

```
fanwire/
├── README.md               # human entry point
├── AGENTS.md                # agent entry point: build/test/run, conventions
├── .ai/
│   ├── settings.json
│   ├── skills/
│   └── hooks/
├── wiki/
│   ├── index.md              # top-level router: CodeContext vs GeneralContext
│   ├── CodeContext/          # restricted — see Context/codecontext-handoff.md
│   │   ├── Modules/           # 0x00 .. 0x07, one per entity/piece
│   │   └── Standards/         # design-principles, security, gof-patterns, aws-stack, build-deployment
│   └── GeneralContext/        # manager/thinking tier only
│       ├── index.md            # project dictionary
│       ├── UsageRules/          # this folder
│       ├── Architecture/        # business rules, incident runbook, deployment state
│       ├── Prompts/             # task briefs for manager agents
│       └── Reports/             # test-runs/, context-audit/, maintenance/
├── .github/
│   └── workflows/
│       ├── test-agent.yml        # category 3, on push to /tests
│       ├── pr-review-agent.yml   # category 3, on PR opened
│       └── context-audit.yml     # category 4, cron
└── code/                   # the actual code repository (backend/, frontend/, infra/)
```

## Maintenance actors (git actions)
Full table: `wiki/GeneralContext/UsageRules/Git/maintenance-actors.md`.
- Pre-commit hook: lint/format before any commit reaches an agent's context.
- Push-to-`/tests` workflow: runs category 3, writes `wiki/GeneralContext/Reports/test-runs/`.
- PR-opened workflow: runs category 3 review agent, writes `wiki/GeneralContext/Reports/`, comments on PR.
- Merge-to-main workflow: category 3, reconciles wiki hex refs with the merged diff (new/changed/removed refs).
- Cron workflow: category 4, weekly context audit, opens a PR or report for review — never auto-merges.
- Branch protection: agent-authored commits/PRs require human approval to merge.
