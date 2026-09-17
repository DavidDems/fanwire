# fanwire — GeneralContext (project dictionary)

**Agent-facing, manager/thinking tier only** (category 1–2 — see `wiki/GeneralContext/UsageRules/AgentType/`). Most agents never read this file — it is the lookup for the agent doing the managing/thinking, not for a code-change subagent, which gets a hand-picked slice of `wiki/CodeContext/` instead and never sees this folder at all.

## What `fanwire` is trying to be
`fanwire` is not just a sports discussion app — it's the first project run through an intentional AI-coding-factory process: every fact about the project lives in exactly one place in this wiki, every agent that touches the project is scoped to the narrowest context that lets it do its job, and every non-trivial claim (a schema decision, a pattern choice, a security requirement) is written down as current-state fact rather than left to be re-derived or re-argued each session. The goal is a well-oiled machine — defined rules for every development case, so that adding the next module, the next agent, or the next project reuses the same scaffolding rather than reinventing it. `wiki/` (this folder's parent) is deliberately meant to be a template other projects can copy, not a one-off.

This file is the root of that machine's map: it links to the rules every agent operates under, then to the full state of the project's design and implementation.

## Part 1 — Usage rules (read this before dispatching or becoming any agent)

Full index: `wiki/GeneralContext/UsageRules/index.md`.

Every agent in this project is one of four categories, each with its own narrow, strictly-enforced MUST-NOT list:

| # | Category | Trigger | Rules |
|---|---|---|---|
| 1 | Discussion | interactive, human | `wiki/GeneralContext/UsageRules/AgentType/1-discussion.md` |
| 2 | Code & wiki edits (manager/thinking tier) | interactive, human | `wiki/GeneralContext/UsageRules/AgentType/2-code-wiki-edits.md` |
| 3 | Scripted execution (CI, or a manager-dispatched code-change subagent) | git event, or manager dispatch | `wiki/GeneralContext/UsageRules/AgentType/3-scripted-execution.md` |
| 4 | Scheduled maintenance | cron | `wiki/GeneralContext/UsageRules/AgentType/4-scheduled-maintenance.md` |

Rule areas beyond agent type, each narrowly scoped rather than one broad rules file:
- **Git** — branching/PRs, branch protection, pre-commit, CI actor table: `wiki/GeneralContext/UsageRules/Git/`
- **Coding** — TDD, module boundaries, assigned patterns, design principles & security baseline: `wiki/GeneralContext/UsageRules/Coding/`
- **Context** — just-in-time loading, the CodeContext handoff mechanism, wiki hygiene: `wiki/GeneralContext/UsageRules/Context/`
- **Tasks** — how a unit of work must be scoped before it's dispatched: `wiki/GeneralContext/UsageRules/Tasks/`

When a manager agent starts a working (category 3, CodeContext-flavor) agent, it hands over, in order: (1) that agent's `AgentType/3-scripted-execution.md` rules, (2) the specific `wiki/CodeContext/Modules/*.md` + `wiki/CodeContext/Standards/*.md` files for its task — see `wiki/GeneralContext/UsageRules/Context/codecontext-handoff.md` for the exact mechanism. `wiki/GeneralContext/UsageRules/` itself is editable only by a category 1–2 agent, only in an explicit rules-maintenance task.

## Part 2 — Project state, architecture, and the full stack

### Current state
No application code exists yet. What exists is this wiki (design/decisions) and the repo scaffolding (`backend/pyproject.toml`, `frontend/package.json`, `infra/package.json`, `docker/*.Dockerfile`, `docker-compose.yml`). The first build pass is briefed in `wiki/GeneralContext/Prompts/first-pass-manager-agent.md` (Phases 0–6: scaffold → `events/`/`users/`/`media/` → `posts/` → `notifications/`/`feed/` → `search/` → frontend → CDK infra, `cdk synth`-only). No live AWS deploy — see `wiki/GeneralContext/Architecture/incident-runbook.md`'s "Outstanding" note and `wiki/CodeContext/Modules/0x00-architecture.md`'s "AWS account state" for exactly what is and isn't live today.

### Business rules
`wiki/GeneralContext/Architecture/business-rules.md` — the full source requirements (accounts, posts, events, feed, notifications, search, images) and the two standing project-level decisions (media uploads in scope for v1, single sports data provider until proven insufficient).

### Module map (implementation decisions — this is what `wiki/CodeContext/Modules/` holds)
| Module | Owns | Depends on | File |
|---|---|---|---|
| `architecture` (no module, cross-cutting) | module boundaries, AWS topology, event bus, connection rule, account state | — | `wiki/CodeContext/Modules/0x00-architecture.md` |
| `users/` | `User`, `Follow` | Cognito (identity), `media/` (profile picture) | `wiki/CodeContext/Modules/0x01-users.md` |
| `events/` | `Team`, `Game` | API-SPORTS (external), nothing internal | `wiki/CodeContext/Modules/0x02-events.md` |
| `posts/` | `Post`, `PostLike`, `EventMention`, `Report` | `users/`, `events/`, `media/` (via IDs/interfaces only) | `wiki/CodeContext/Modules/0x03-posts.md` |
| `media/` | `Media` | S3, GuardDuty Malware Protection, Pillow | `wiki/CodeContext/Modules/0x04-media.md` |
| `notifications/` | `Notification`, `NotificationPreference` | `PostEventBus`, SES | `wiki/CodeContext/Modules/0x05-notifications.md` |
| `feed/` | nothing (computes over `posts/`, `users/`) | — | `wiki/CodeContext/Modules/0x06-feed.md` |
| `search/` | nothing (indexes `users/`, `posts/`, `events/`) | Postgres `tsvector` | `wiki/CodeContext/Modules/0x07-search.md` |

No module reaches into another module's tables directly — see `wiki/CodeContext/Modules/0x00-architecture.md` "Connection rule."

### Standards (the "why" behind every module decision)
- **Design principles** — SOLID, DRY/KISS/YAGNI, fail-fast, 12-factor, security baseline: `wiki/CodeContext/Standards/design-principles.md`
- **Security** — self-managed AWS security requirements: `wiki/CodeContext/Standards/security.md`
- **Gang of Four patterns** — all 23 GoF patterns mapped to this app's domain, module layout, connection rule: `wiki/CodeContext/Standards/gof-patterns.md`
- **AWS Stack** — backend/frontend language choices, AWS services, sports-data ingestion pipeline: `wiki/CodeContext/Standards/aws-stack.md`
- **Build & Deployment** — package inventory, container strategy, CI/CD wiring: `wiki/CodeContext/Standards/build-deployment.md`

### Architecture & operations (GeneralContext-only — not handed to code-change subagents)
- **Business rules**: `wiki/GeneralContext/Architecture/business-rules.md`
- **Incident runbook**: `wiki/GeneralContext/Architecture/incident-runbook.md` — interim, GuardDuty-finding response, priority-of-suspicion order; revisit once Phase 6 CDK stacks land.

### Task prompts
`wiki/GeneralContext/Prompts/` — full briefs for agents kicking off a build pass (category 2) or a discussion (category 1). Currently:
- `first-pass-manager-agent.md` — category 2, the first implementation pass build brief.
- `architecture-skepticism-review.md` — category 1, a deliberately skeptical discussion brief on whether this project's own agent-delegation process is over-optimized for its current scale.

### Reports
`wiki/GeneralContext/Reports/` — category 3/4 output only, never hand-written: `test-runs/`, `context-audit/`, `maintenance/`.

## Explicitly out of scope for v1
- Standalone `Player`/`PlayerSeasonStat` tables — see `wiki/CodeContext/Modules/0x02-events.md`.
- Moderation workflow beyond the `Report` flag — see `wiki/CodeContext/Modules/0x03-posts.md`.
- A fallback sports data provider — single-provider until API-SPORTS proves insufficient, per `wiki/GeneralContext/Architecture/business-rules.md`.
