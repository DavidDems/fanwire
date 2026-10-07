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
**The app is built and live** at `https://fanwire.daviddems.com`: the backend (`events/`, `users/`, `media/`, `posts/`, `notifications/`, `feed/`, `search/`), the CDK `infra/` app, and the frontend, styled. **Every planned frontend unit is merged**, the last being `FRONTEND-007` (search, #114, 2026-10-07). It works, with small known issues; what is left is `TODO/02-backlog.md`. Since 2026-10-05 every merge to `main` that changes a deployable path deploys through `.github/workflows/deploy.yml`, behind a human's approval. For the deploy record and what the post-deploy checks proved, see `wiki/CodeContext/Modules/0x00-architecture.md` ("First deploy", "Post-deploy checks, 2026-09-30" and "AWS account state"); before any AWS command, `Architecture/deploy-traps.md`.

**The focus is now the automated agent workflow** (`.ai/`), which is the project's real objective (`.ai/docs/philosophy.md` §2). It ran two tasks end to end in September; every unit since 2026-09-23 was run by hand from Claude Code instead, to avoid metered API cost (`Architecture/director-sessions.md`). Next: review it for safety, performance and cost, decide the changes with the human, and incorporate `jev` as its typed-decision layer (`Prompts/01-agent-workflow-review.md`; `Architecture/human-decisions.md` §6).

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

### Frontend UI (look and feel)
`wiki/CodeContext/FrontendUI/`: the reference for styling units; start at its `index.md`. `decisions.md` (human-owned, outranks the rest) holds the palette (with `--color-accent-on-dark` `#279ab1` and the corrected contrast table), the lowercase-name rule, the brand mark and the look-and-feel choices of 2026-10-06: CSS Modules plus a token stylesheet, the **system font stack**, a raspberry Live accent, no team logos. `branding.md` (2026-10-05) is the brand research and asset how-to; the assets are on `main` under `brand/`. The UI plan (2026-10-06) wrote the rest: `direction.md`, `tokens.md` (every value, measured contrast, distance from all 307 NBA/NFL/MLB team colours) with its scripts in `tokens-check.md`, `typography.md`, `layout.md`, `components.md`, `accessibility.md`, `verification.md` and `implementation-plan.md` (Director PR `D1` for `index.html` and the brand files, then eight styling units). The specs were `.ai/tasks/UI-001`–`UI-008`, all merged by 2026-10-07 and run by hand from Claude Code; `layout.md` and `components.md` now describe the app as built.

### Architecture & operations (GeneralContext-only — not handed to code-change subagents)
- **Business rules**: `wiki/GeneralContext/Architecture/business-rules.md`
- **Incident runbook**: `wiki/GeneralContext/Architecture/incident-runbook.md` — GuardDuty-finding response, priority-of-suspicion order, and concrete containment commands naming the deployed resources (revisited 2026-09-30).
- **Dev auth setup**: `wiki/GeneralContext/Architecture/dev-auth-setup.md`: the human-created real Cognito dev user pool that local dev and browser testing use (decided 2026-09-18, no emulator or fake).
- **Human decisions log**: `wiki/GeneralContext/Architecture/human-decisions.md`: every product or process question agents asked, the human's answer, and the file where each answer now lives as current state. It replaces the decision log the deleted `phase-4-manager-agent.md` held, and keeps the old `TODO/03` section numbers.
- **Director sessions**: `wiki/GeneralContext/Architecture/director-sessions.md`: how a hand-run, human-supervised session does a unit (the loop, the gates, the guard per commit, sibling PRs, browser rows, standing limits) and who pays for which mode. Formerly `Prompts/00-session-protocol.md`.
- **Deploy traps**: `wiki/GeneralContext/Architecture/deploy-traps.md`: what caught the first deploy and the sessions after it. Read before any AWS command.
- **GitHub automation setup**: `wiki/GeneralContext/Architecture/github-automation-setup.md`: the repository settings the `.ai/` pipeline depends on and why — secrets (and the repository-vs-environment trap), the ruleset and its aggregate required checks, the solo-repo approval bypass, `action_required` on bot-authored PRs, and how to run/stop a task. The one part of the agent system not under version control, so not diffable and not testable.

### Task prompts
`wiki/GeneralContext/Prompts/` holds full briefs for Director sessions. Each is self-contained: a fresh session reads its own file plus whatever that file names.

- **`01-agent-workflow-review.md`** is the only prompt: review the automated workflow (safety, performance, cost, and where `jev` fits), then decide the changes with the human before building any.
- **Deleted 2026-10-07:** `00`–`16`, the post-build sessions (the deploy path, the first deploy, the post-deploy checks, `cfn-exec-role` scoping, the NAT AMI pin, the deploy workflow, the branding research, the UI plan and the four styling passes). All were done, or their leftovers moved to `TODO/02-backlog.md`. `00-session-protocol.md` is now `Architecture/director-sessions.md`. Read the rest from git history if you need their reasoning.
- **Deleted 2026-09-29 (commit `2fc5de9`):** the build-pass manager prompts (`first-pass-manager-agent.md`, `phase-2`/`3`/`4-manager-agent.md`, `phase-5a`/`5b-frontend-manager-agent.md`, `frontend-build-handoff.md`). Their settled facts live in the module files, and their decision log is `Architecture/human-decisions.md`.

### Reports
`wiki/GeneralContext/Reports/` — agent-generated output only, never hand-written: `test-runs/`, `context-audit/`, `maintenance/`. Still unwritten by automation: the agent system records machine output as structured state and telemetry under `.ai/` (`agentctl status`, `agentctl telemetry report`) rather than as prose reports here, so these folders are awaiting a use that genuinely needs prose. `wiki/GeneralContext/` is not writable by any agent worker.

## Explicitly out of scope for v1
- Standalone `Player`/`PlayerSeasonStat` tables — see `wiki/CodeContext/Modules/0x02-events.md`.
- Moderation workflow beyond the `Report` flag — see `wiki/CodeContext/Modules/0x03-posts.md`.
- A fallback sports data provider — single-provider until API-SPORTS proves insufficient, per `wiki/GeneralContext/Architecture/business-rules.md`.
