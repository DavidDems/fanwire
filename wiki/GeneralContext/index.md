# fanwire — GeneralContext (project dictionary)

**Agent-facing, manager/thinking tier.** Most agents never read this file — it is the lookup for the agent doing the managing/thinking, not for a code-change subagent, which gets a hand-picked slice of `wiki/CodeContext/` instead.

## What `fanwire` is trying to be
`fanwire` is not just a sports discussion app — it's the first project run through an intentional AI-coding-factory process: every fact about the project lives in exactly one place in this wiki, and every non-trivial claim (a schema decision, a pattern choice, a security requirement) is written down as current-state fact rather than left to be re-derived or re-argued each session. `wiki/` (this folder's parent) is deliberately meant to be a template other projects can copy, not a one-off. The factory itself now exists as running infrastructure in `.ai/` — a Git-backed, CI-driven workflow with an explicit state machine, enforced per-role permissions and telemetry; start at `.ai/README.md`, and see the Process note below for what changed.

This file is the root of the project's map: the full state of its design and implementation.

## Process note

The agent-governance process that was drafted and deferred — because instruction-only "MUST NOT" rules have no technical backing — now exists as enforcement rather than prose, in `.ai/`:

- **Per-role write permissions** (`.ai/policy.json`) checked against the actual diff by `agentctl guard check`, in CI, in a workflow agents cannot modify. `.ai/`, `.github/`, `wiki/GeneralContext/` and `AGENTS.md` are never writable by an agent.
- **Test-first as a machine property**: after the test agent commits, CI must go *red* before any implementation is dispatched. A green baseline routes to manager review. See `.ai/docs/state-machine.md`.
- **Bounded retries** with a hard cap no task or manager can raise, and an explicit `ESCALATED` state.
- **No merge permission** anywhere in the system; every agent branch reaches `main` through a human-approved PR.
- **Telemetry** that agents cannot write, amend or under-report (`.ai/telemetry/`).

`.ai/docs/permissions.md` closes with what is deliberately *not* enforced (read access, the Director's own session, GitHub repo settings a human must switch on). The `rules` branch's prose draft is superseded by `.ai/docs/` and can be retired.

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
- **Dev auth setup**: `wiki/GeneralContext/Architecture/dev-auth-setup.md`: the human-created real Cognito dev user pool that local dev and browser testing use (decided 2026-09-18, no emulator or fake).

### Task prompts
`wiki/GeneralContext/Prompts/` — full briefs for agents kicking off a build pass. The first full pass is split across four sequential manager-agent handoffs, each self-contained (a fresh agent reads only its own file plus whatever it names) and each meant to minimize any one agent's mandate rather than one agent running the whole pass:
- `first-pass-manager-agent.md` — Phase 0 (scaffold) + Phase 1 (`events/`, `users/`, `media/`).
- `phase-2-manager-agent.md` — Phase 2 (`posts/`), plus closing the Phase 1 routes gap it documents.
- `phase-3-manager-agent.md` — Phase 3 (`notifications/`, `feed/`, `search/`).
- `phase-4-manager-agent.md` — Phase 4 (frontend + CDK infra) — the final pass; `cdk deploy` stays out of scope even here, gated on human IAM review.

Each brief's "Process outcomes" section feeds the next one and, eventually, the decision on which drafted `rules`-branch item is worth real technical enforcement (see Process note above).

### Reports
`wiki/GeneralContext/Reports/` — agent-generated output only, never hand-written: `test-runs/`, `context-audit/`, `maintenance/`. Still unwritten by automation: the agent system records machine output as structured state and telemetry under `.ai/` (`agentctl status`, `agentctl telemetry report`) rather than as prose reports here, so these folders are awaiting a use that genuinely needs prose. `wiki/GeneralContext/` is not writable by any agent worker.

## Explicitly out of scope for v1
- Standalone `Player`/`PlayerSeasonStat` tables — see `wiki/CodeContext/Modules/0x02-events.md`.
- Moderation workflow beyond the `Report` flag — see `wiki/CodeContext/Modules/0x03-posts.md`.
- A fallback sports data provider — single-provider until API-SPORTS proves insufficient, per `wiki/GeneralContext/Architecture/business-rules.md`.
