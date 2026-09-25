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

No live AWS deploy exists yet.

## What needs you

`TODO/` — and it is nearly empty now. Nothing in it blocks the pipeline any more.

1. **`TODO/02-deployment-requirements.md`** — the dev S3 buckets (~10 minutes), plus a checklist that only becomes actionable after a first deploy.
2. **`TODO/03-open-decisions.md`** — answered product decisions, four of which still need copying into `wiki/GeneralContext/Prompts/phase-4-manager-agent.md`.

The setup checklist that used to be `TODO/01` is gone: every item was completed, and what is durable about it moved to `wiki/GeneralContext/Architecture/github-automation-setup.md`. A finished item does not stay in `TODO/` as a tick — it becomes current-state fact in the wiki.

## Where things are documented

- **For you:** `TODO/`, and this file.
- **For an agent starting work:** `AGENTS.md` → `wiki/GeneralContext/index.md` → the specific module files it needs.
- **For anyone reviewing or improving the agent pipeline:** `.ai/docs/philosophy.md`, then `.ai/README.md`.

Build, test and run commands live in `AGENTS.md` — they are the same commands CI uses, so there is one copy rather than two that drift.
