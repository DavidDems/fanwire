# fanwire

**Human-facing.** Sports discussion app — Twitter-style posts about real sports games/teams, with a feed that pulls live data from a real sports API. Full business rules in `wiki/GeneralContext/Architecture/business-rules.md`.

It is also the first project built through an intentional AI development pipeline. The app is the work; the pipeline is the point. See `.ai/docs/philosophy.md`.

## State

| | |
|---|---|
| `backend/` | FastAPI — `users`, `events`, `posts`, `media`, `notifications`, `feed`, `search`. Real, tested. |
| `frontend/` | React + Vite. Scaffold; Phase 5 builds it out. |
| `infra/` | AWS CDK app. Synthesized and tested, **never deployed** — gated on an IAM review. |
| `.ai/` | The agent system that builds this repo. Live: two tasks have run `DRAFT`→`COMPLETE` unattended. Start at `.ai/README.md`, state of play in `.ai/docs/handoff.md`. |
| `wiki/` | Every AI-facing file: per-module decisions, standards, task prompts. Start at `wiki/index.md`. |
| `TODO/` | **Things only you can do.** Start here. |

Live at `https://fanwire.daviddems.com` since 2026-09-30, deployed by hand; no workflow deploys.

## What needs you

`TODO/`, rewritten 2026-10-07 when the frontend's last unit merged:

1. **`TODO/01-for-you.md`**: what only you can do. The agent workflow's remaining human steps (balances around the first run, reviewing the fix PRs, saying go), watching the live site, axe on every route, and SES reapplication (optional, later).
2. **`TODO/02-backlog.md`**: what is left to build, as small units for the automated workflow.

The project's focus is back on that workflow: it was reviewed on 2026-10-08 (`.ai/docs/handoff.md` §10), and `wiki/GeneralContext/Prompts/02-agent-workflow-continue.md` is the next session to run. A finished item does not stay in `TODO/` as a tick; it becomes current-state fact in the wiki.

## Where things are documented

- **For you:** `TODO/`, and this file.
- **For an agent starting work:** `AGENTS.md` → `wiki/GeneralContext/index.md` → the specific module files it needs.
- **For anyone reviewing or improving the agent pipeline:** `.ai/docs/philosophy.md`, then `.ai/README.md`.

Build, test and run commands live in `AGENTS.md` — they are the same commands CI uses, so there is one copy rather than two that drift.
