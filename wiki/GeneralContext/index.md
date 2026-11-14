---
type: reference
---

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

Current state of that system, including what has actually been proven by running it and what has not: `.ai/docs/handoff.md`. The reasoning behind it, and the protocol for reviewing or improving it: `.ai/docs/philosophy.md`.

`.ai/docs/permissions.md` closes with what is deliberately *not* enforced (read access, the Director's own session, GitHub repo settings a human must switch on). The `rules` branch's prose draft is superseded by `.ai/docs/` and can be retired.

## Project state, architecture, and the full stack

### Current state
**The app is built and live** at `https://fanwire.daviddems.com`: the backend (`events/`, `users/`, `media/`, `posts/`, `notifications/`, `feed/`, `search/`), the CDK `infra/` app, and the frontend, styled. **Every planned frontend unit is merged**, the last being `FRONTEND-007` (search, fanwire-archive#114, 2026-10-07). It works, with small known issues; what is left is `TODO/02-backlog.md`. Since 2026-10-05 every merge to `main` that changes a deployable path deploys through `.github/workflows/deploy.yml`, behind a human's approval. For the deploy record, see the Timeline (`Timeline/2026-09.md`, `2026-10.md`); for account state, `wiki/CodeContext/Modules/0x00c-architecture-aws-account.md`; before any AWS command, `Architecture/deploy-traps.md`.

**The focus is now the automated agent workflow** (`.ai/`), which is the project's real objective (`.ai/docs/philosophy.md` §2). It ran two tasks end to end in September; every unit since 2026-09-23 was run by hand from Claude Code instead, to avoid metered API cost (`Architecture/director-sessions.md`). It was reviewed for safety, performance and cost on 2026-10-08 (`.ai/docs/handoff.md` §10; the human's decisions are ADRs [0023](Decisions/0023-human-gates-on-agent-work.md)–[0026](Decisions/0026-agent-models-cli-pin-and-spend-controls.md)): the agreed fixes are landing one Director PR at a time, `MEDIA-002` ran as the first real task (USD $2.65, handoff §10.5). **Since 2026-10-09 the project is hybrid** (`Architecture/work-modes.md`): code is hand-run on the human's subscription, the automated pipeline is kept for small cheap tasks, and the API pays only for four narrow helper calls. Live briefs: "Task prompts" below.

### Business rules
`wiki/GeneralContext/Architecture/business-rules.md` — the full source requirements (accounts, posts, events, feed, notifications, search, images). The product scope behind them (an NBA discussion app, the stack, media uploads in v1, one sports-data source) is [ADR 0032](Decisions/0032-product-scope-nba-discussion-app.md).

### Module map (implementation decisions — this is what `wiki/CodeContext/Modules/` holds)
| Module | Owns | Depends on | File |
|---|---|---|---|
| `architecture` (no module, cross-cutting) | module boundaries, AWS topology, event bus, connection rule, account state | — | `wiki/CodeContext/Modules/0x00-architecture.md` (index) and its `0x00a`–`0x00c` parts |
| `users/` | Profiles, follows, durable lifecycle authority/work | Cognito (identity), `media/` (profile picture) | `wiki/CodeContext/Modules/0x01-users.md` |
| `events/` | `Team`, `Game` | A Kaggle NBA dataset loaded into Postgres; nothing internal | `wiki/CodeContext/Modules/0x02-events.md` (index) and its `0x02a`–`0x02d` parts |
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
- **Build & Deployment** — container strategy, CI/CD wiring, the deploy workflow: `wiki/CodeContext/Standards/build-deployment.md`, with its packages part and four runbook parts (SPA rebuild, NAT AMI upgrade, post-deploy migrations and sports data, deploy setup)

### Frontend UI (look and feel)
`wiki/CodeContext/FrontendUI/`: the reference for styling units; start at its `index.md`. The human's look-and-feel and brand decisions are ADRs [0010](Decisions/0010-lowercase-brand-name.md)–[0018](Decisions/0018-ui-adjustments-2026-11-07.md) (the lowercase name, the palette and its measured contrast, the `ui-design` skill, the brand mark, the look and feel, `InlineAlert`'s id, team icons, navigation and the home rail, the 2026-11-07 adjustments), and they outrank the folder. `branding.md` and its three parts are the brand research and asset how-to (the assets are under `brand/`, the colour scripts under `brand/tools/`); the rest is `direction.md`, `tokens.md` with `tokens-check.md`, `typography.md`, `layout.md`, `components.md` and its four parts, `accessibility.md`, and `verification.md` with `verification-browser.md`. They describe the app as built.

### Architecture & operations (GeneralContext-only — not handed to code-change subagents)
- **Business rules**: `wiki/GeneralContext/Architecture/business-rules.md`
- **Incident runbook**: `wiki/GeneralContext/Architecture/incident-runbook.md` (index) and its parts `incident-runbook-response.md` (GuardDuty-finding response, priority-of-suspicion order, containment commands naming the deployed resources), `-rollback.md`, `-restore.md` (the restore drill) and `-inventory.md` (resources, alarms, known gaps).
- **Dev auth setup**: `wiki/GeneralContext/Architecture/dev-auth-setup.md`: the human-created real Cognito dev user pool that local dev and browser testing use (no emulator or fake, [ADR 0020](Decisions/0020-real-aws-services-for-local-development.md)).
- **Decisions**: `wiki/GeneralContext/Decisions/`: the human's product, process and agent-system decisions, one numbered ADR per file (`NNNN-short-title.md`), each with its context, choice and consequences. A decision lives there once; everything else links to it.
- **Work modes**: `wiki/GeneralContext/Architecture/work-modes.md`: **read before planning any unit.** The three modes (`hand` on the subscription, the default; `auto` through the pipeline for small cheap tasks; `director` for the system itself), what each costs, the four cheap automations and their constraints, and how work is handed on and planned ([ADR 0027](Decisions/0027-work-modes.md)).
- **Director sessions**: `wiki/GeneralContext/Architecture/director-sessions.md`: how a hand-run, human-supervised session does a unit (the loop, the gates, the guard per commit, sibling PRs, browser rows, standing limits) and who pays for which mode.
- **Deploy traps**: `wiki/GeneralContext/Architecture/deploy-traps.md`: the traps that catch a deploy or an AWS session. Read before any AWS command.
- **GitHub automation setup**: `wiki/GeneralContext/Architecture/github-automation-setup.md` (index): the repository settings the `.ai/` pipeline depends on and why, in five parts: `github-automation-setup-actions.md` (which workflows run, action pinning, fork-PR approval, `action_required` on bot-authored PRs), `-secrets.md` (and the repository-vs-environment trap), `-ruleset.md` (aggregate required checks, the solo-repo approval bypass), `-renovate.md` and `-tasks.md` (running and stopping a task, its cost). The one part of the agent system not under version control, so not diffable and not testable.
- **Repository cutover**: `wiki/GeneralContext/Architecture/repo-cutover.md`: the human's CUT-12 procedure, from freeze and snapshot (`.ai/bin/cutover_snapshot.py`) to the new repository's settings, deploy trust, first deploy and the private archive.

### Task prompts
`wiki/GeneralContext/Prompts/` holds full briefs for Director and hand-run sessions. Each is self-contained: a fresh session reads its own file plus whatever that file names. New prompts start from **`_template.md`**, whose sections are the ones the early briefs proved out, each with a one-line note on what belongs there.

**Lifecycle** (`Architecture/work-modes.md` "How work is handed on and planned"):

- **One live prompt per active thread** of work. A second session on the same thread continues its prompt instead of starting a new one.
- **A session that stops mid-thread updates its prompt** before it ends: a dated *Update* note at the top, and "Where things stand" corrected, so the next session starts cold from the file.
- **A finished prompt is deleted.** The timeline (`Timeline/`) records when it finished, and git keeps its text.

Live:

- **`25-context-update-track.md`** (2026-11-11): Context-Update-Track. Compact every context file to its budget, write a timeline of the history the move loses, scrub personal addresses, then cut over to a fresh repository (`CUT-00` to `CUT-12`, one Director PR each).
- **`22-launch-adjustments.md`**: [USERS-009](../../.ai/tasks/USERS-009/brief.md) implementation/documentation PR checkpoint and Director handoff under [ADR 0009](Decisions/0009-account-lifecycle-evidence.md). Migration, legacy-adoption and activation gates remain. AUTH-001 and USERS-005 stay parked and preserved.
- **`04-cheap-automations.md`**: the four Haiku 5.5 automations (CI failure summary, criteria coverage, spec drift, wiki update proposal) are built and live; left is proving live the "Fixed" line and `assumed_to_exist` (`TODO/02` item 14). `jev` stays off.
- **`06-nba-data.md`**: sports data on the Eoin Moore Kaggle dataset. Left: the API-SPORTS infra clean-up and the gated `EVENTS-008`.
- **`10`–`15`, the system track** (Director). Order and the reason for it: `TODO/02-backlog.md` "Improvement roadmap".
  - `10-docs-structure.md`: Deliverable 4, the WikiMaintenance skill and `wiki-health.yml`; its corpus migration is absorbed by `25`.
  - `11-metrics-every-mode.md`: the metrics publisher keeps failing on `main`; then Deliverable 4 (VERSION/changelog) and 5 (reporting).
  - `12-agent-evals.md` → `13-worker-shell.md` → `14-learning-loop.md` → `15-context-graph.md`.
- **`19-dependency-upkeep.md`**: Renovate upkeep. Left: the `@types/node` v24 major, then the close-out.

### Timeline
`wiki/GeneralContext/Timeline/`: the project's history as `changelog` volumes, one physical line per milestone with its PRs cited as `fanwire-archive#N`: [2026-09](Timeline/2026-09.md), [2026-10](Timeline/2026-10.md), [2026-11](Timeline/2026-11.md). A volume that would pass 1,000 words is followed by another (`2026-11b.md`), never trimmed.

## Explicitly out of scope for v1
- Standalone `Player`/`PlayerSeasonStat` tables — see `wiki/CodeContext/Modules/0x02-events.md`.
- Moderation workflow beyond the `Report` flag — see `wiki/CodeContext/Modules/0x03-posts.md`.
- A fallback sports data source — NBA data comes from one Kaggle dataset, per [ADR 0032](Decisions/0032-product-scope-nba-discussion-app.md).
