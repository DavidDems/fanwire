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

**The focus is now the automated agent workflow** (`.ai/`), which is the project's real objective (`.ai/docs/philosophy.md` §2). It ran two tasks end to end in September; every unit since 2026-09-23 was run by hand from Claude Code instead, to avoid metered API cost (`Architecture/director-sessions.md`). It was reviewed for safety, performance and cost on 2026-10-08 (`.ai/docs/handoff.md` §10; the human's decisions are `Architecture/human-decisions.md` §7): the agreed fixes are landing one Director PR at a time, `MEDIA-002` ran as the first real task (USD $2.65, handoff §10.5). **Since 2026-10-09 the project is hybrid** (`Architecture/work-modes.md`): code is hand-run on the human's subscription, the automated pipeline is kept for small cheap tasks, and the API pays only for four narrow helper calls. Live briefs: "Task prompts" below.

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
- **Work modes**: `wiki/GeneralContext/Architecture/work-modes.md`: **read before planning any unit.** The three modes (`hand` on the subscription, the default; `auto` through the pipeline for small cheap tasks; `director` for the system itself), what each costs, the four cheap automations and their constraints, and how work is handed on and planned (decided 2026-10-09).
- **Director sessions**: `wiki/GeneralContext/Architecture/director-sessions.md`: how a hand-run, human-supervised session does a unit (the loop, the gates, the guard per commit, sibling PRs, browser rows, standing limits) and who pays for which mode. Formerly `Prompts/00-session-protocol.md`.
- **Deploy traps**: `wiki/GeneralContext/Architecture/deploy-traps.md`: what caught the first deploy and the sessions after it. Read before any AWS command.
- **GitHub automation setup**: `wiki/GeneralContext/Architecture/github-automation-setup.md`: the repository settings the `.ai/` pipeline depends on and why — secrets (and the repository-vs-environment trap), the ruleset and its aggregate required checks, the solo-repo approval bypass, `action_required` on bot-authored PRs (kept, 2026-10-08), fork-PR approval, the spend controls, and how to run/stop a task. The one part of the agent system not under version control, so not diffable and not testable.

### Task prompts
`wiki/GeneralContext/Prompts/` holds full briefs for Director and hand-run sessions. Each is self-contained: a fresh session reads its own file plus whatever that file names. New prompts start from **`_template.md`**, whose sections are the ones `02` proved out, each with a one-line note on what belongs there.

**Lifecycle** (`Architecture/work-modes.md` "How work is handed on and planned"):

- **One live prompt per active thread** of work. A second session on the same thread continues its prompt instead of starting a new one.
- **A session that stops mid-thread updates its prompt** before it ends: a dated *Update* note at the top, and "Where things stand" corrected, so the next session starts cold from the file.
- **A finished prompt is deleted**, and listed below under "Deleted" with the date and where its results now live (a module file, handoff, `TODO/02-backlog.md`). Git history keeps the text.

Live:

- **`02-agent-workflow-continue.md`**: the review's fix queue is done (D1–D7 merged by 2026-10-12); what remains of it is `jev` as a shadow decision layer, the model upgrade and CLI pin, and bug 17's CI half. `MEDIA-002` has run (handoff §10.5).
- **`04-cheap-automations.md`**: the spec drift check, CI failure summary, criteria coverage check and wiki update proposal on Haiku 5.5 or `jev` (`TODO/02` item 14). Its prerequisite, D4–D7, is met.
- **`19-dependency-upkeep.md`** (2026-10-21): Renovate's first PRs. It covers the `claude CLI` flag check and the `npm non-major` stack diff, both due Monday 2026-10-26, and the red Node 24 runtime PR #202 (multipart uploads under MSW). It continues `09`'s supply-chain thread (handoff §10.6).
- **`10`–`15`, the improvement roadmap (2026-10-19)**, the system track. Order and the reason for it: `TODO/02-backlog.md` "Improvement roadmap". Its app track (`08`, `17`, `16`) is done.
  - System track (Director): `10-docs-structure.md` (typed docs, a doc linter, the WikiUpdate and WikiMaintenance skills) → `11-metrics-every-mode.md` → `12-agent-evals.md` → `13-worker-shell.md` → `14-learning-loop.md` → `15-context-graph.md`.
- **`06-nba-data.md`**: sports data on the Eoin Moore Kaggle dataset. Done through `EVENTS-002` (the live site has every game since 2003-04, 2026-10-14); `EVENTS-006`/`007` moved to `07`. Left: the API-SPORTS infra clean-up and the gated `EVENTS-008`.
- **Deleted 2026-10-21:** `16-performance-tests.md`, done: the spec and the compose `perf` profile #192, its amendment (only `load` is compared) #199, `PERF-001` #200 (the local test JWKS, fail-closed; synthetic seed; k6 by digest; the baseline comparison; one PowerShell line), and the PR-template line and advisory `perf-advisory` CI job in this PR. Results: `perf/README.md`, `CodeContext/Modules/0x01-users.md` (the perf verifier) and `Architecture/human-decisions.md` §8.
- **Deleted 2026-10-20:** `17-production-hardening-finish.md`, done: `POSTS-003` #188 (the heuristic spam scorer, so the moderation chain holds no fake) and the human's first restore drill (20 min 42 s, recorded in this PR). Results: `CodeContext/Modules/0x03-posts.md` "Security", `0x01-users.md` (`account_created_at`), and `Architecture/incident-runbook.md` "Restore the database", whose steps now carry every id in a variable.
- **Deleted 2026-10-20:** `08-production-hardening.md`, replaced by `17-production-hardening-finish.md`, which logs what it did: the specs #173, the deploy smoke check and the rollback and restore runbooks #172, the exec policy grant #180, `POSTS-002` #183 and `INFRA-004` #182. Results: `CodeContext/Modules/0x03-posts.md` "Security", `0x00-architecture.md` "Alarms", and `Architecture/incident-runbook.md` "Alarms", "Roll back a deploy" and "Restore the database".
- **Deleted 2026-10-19:** `09-supply-chain-and-trust.md`, done: SHA-pinned actions #174, the CLI pinned at 2.1.295 and ruff/mypy pinned exactly #175, Renovate #176, OpenSSF Scorecard #177, the advisory Director-PR reviewer #178, and the repository settings audit. Results: `Architecture/github-automation-setup.md` §1 and §7, `.ai/docs/threat-model.md`, `.ai/docs/permissions.md`, and `.ai/docs/handoff.md` §10.6, which lists what is still unproven live.
- **Deleted 2026-10-16:** `07-stats-and-posts-frontend.md`, done: `FRONTEND-008` #155, `EVENTS-006` #159, `EVENTS-007` #160, `POSTS-001` #161, `FRONTEND-009` #162, `UI-009` #167, `FRONTEND-010` #169, and the `FrontendUI` follow-ups #168 and this PR. Results: `CodeContext/Modules/0x02-events.md`, `0x03-posts.md`, `0x06-feed.md`, `0x08-frontend.md` and `FrontendUI/components.md`; leftovers (the `notifications/` DLQ fix, a frontend tidy-up, the compose game picker) are in `TODO/02-backlog.md`.
- **Deleted 2026-10-13:** `05-nba-history.md`, done: `EVENTS-001` merged as #139, and its `EVENTS-002` proposal (in #139's body) is now a unit of `06`.
- **Deleted 2026-10-13:** `03-work-modes-structure.md`, done (#132–#134 and the close-out PR): the backlog's Mode column is in `TODO/02-backlog.md`, hand runs are recorded by `agentctl hand start|finish` (`.ai/docs/state-machine.md` "Hand runs", `Architecture/director-sessions.md` "The loop, per unit"), and the template and lifecycle are above. `Architecture/work-modes.md` "Status" says what is left.
- **Deleted 2026-10-08:** `01-agent-workflow-review.md`, done; its findings and the agreed plan are `.ai/docs/handoff.md` §10.
- **Deleted 2026-10-07:** `00`–`16`, the post-build sessions (the deploy path, the first deploy, the post-deploy checks, `cfn-exec-role` scoping, the NAT AMI pin, the deploy workflow, the branding research, the UI plan and the four styling passes). All were done, or their leftovers moved to `TODO/02-backlog.md`. `00-session-protocol.md` is now `Architecture/director-sessions.md`. Read the rest from git history if you need their reasoning.
- **Deleted 2026-09-29 (commit `2fc5de9`):** the build-pass manager prompts (`first-pass-manager-agent.md`, `phase-2`/`3`/`4-manager-agent.md`, `phase-5a`/`5b-frontend-manager-agent.md`, `frontend-build-handoff.md`). Their settled facts live in the module files, and their decision log is `Architecture/human-decisions.md`.

### Reports
`wiki/GeneralContext/Reports/` — agent-generated output only, never hand-written: `test-runs/`, `context-audit/`, `maintenance/`. Still unwritten by automation: the agent system records machine output as structured state and telemetry under `.ai/` (`agentctl status`, `agentctl telemetry report`) rather than as prose reports here, so these folders are awaiting a use that genuinely needs prose. `wiki/GeneralContext/` is not writable by any agent worker.

## Explicitly out of scope for v1
- Standalone `Player`/`PlayerSeasonStat` tables — see `wiki/CodeContext/Modules/0x02-events.md`.
- Moderation workflow beyond the `Report` flag — see `wiki/CodeContext/Modules/0x03-posts.md`.
- A fallback sports data provider — single-provider until API-SPORTS proves insufficient, per `wiki/GeneralContext/Architecture/business-rules.md`.
