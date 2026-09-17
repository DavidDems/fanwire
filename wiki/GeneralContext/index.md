# fanwire — GeneralContext (project dictionary)

**Agent-facing, manager/thinking tier.** Most agents never read this file — it is the lookup for the agent doing the managing/thinking, not for a code-change subagent, which gets a hand-picked slice of `wiki/CodeContext/` instead.

## What `fanwire` is trying to be
`fanwire` is not just a sports discussion app — it's the first project run through an intentional AI-coding-factory process: every fact about the project lives in exactly one place in this wiki, and every non-trivial claim (a schema decision, a pattern choice, a security requirement) is written down as current-state fact rather than left to be re-derived or re-argued each session. `wiki/` (this folder's parent) is deliberately meant to be a template other projects can copy, not a one-off. The formal agent-governance process that name implies is currently deferred — see the Process note below.

This file is the root of the project's map: the full state of its design and implementation.

## Process note

There is no formal agent-governance/usage-rules process on `main` right now. It was drafted, then deliberately deferred: soft, instruction-only "MUST NOT" rules have no technical backing, so they were pulled off `main` onto a separate `rules` branch to be revisited once real enforcement (permissions, CI, hooks — not prose) makes sense, after a few iterations of actual development. Until then, treat this repo as ungoverned beyond ordinary git branch protection and code review.

## Project state, architecture, and the full stack

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
`wiki/GeneralContext/Prompts/` — full briefs for agents kicking off a build pass. Currently:
- `first-pass-manager-agent.md` — the first implementation pass build brief.

### Reports
`wiki/GeneralContext/Reports/` — agent-generated output only, never hand-written: `test-runs/`, `context-audit/`, `maintenance/`. No automation writes here yet (see Process note above).

## Explicitly out of scope for v1
- Standalone `Player`/`PlayerSeasonStat` tables — see `wiki/CodeContext/Modules/0x02-events.md`.
- Moderation workflow beyond the `Report` flag — see `wiki/CodeContext/Modules/0x03-posts.md`.
- A fallback sports data provider — single-provider until API-SPORTS proves insufficient, per `wiki/GeneralContext/Architecture/business-rules.md`.
