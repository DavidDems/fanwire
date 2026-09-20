# fanwire

**Human-facing.** Sports discussion app — Twitter-style posts about real sports games/teams, with a feed that pulls live data from a real sports API. Full business rules in `wiki/GeneralContext/Architecture/business-rules.md`.

It is also the first project built through an intentional AI development pipeline. The app is the work; the pipeline is the point. See `.ai/docs/philosophy.md`.

## State

| | |
|---|---|
| `backend/` | FastAPI — `users`, `events`, `posts`, `media`, `notifications`, `feed`, `search`. Real, tested. |
| `frontend/` | React + Vite. Scaffold; Phase 5 builds it out. |
| `infra/` | AWS CDK app. Synthesized and tested, **never deployed** — gated on an IAM review. |
| `.ai/` | The agent system that builds this repo. Committed and tested; not yet run live. |
| `wiki/` | Every AI-facing file: per-module decisions, standards, task prompts. Start at `wiki/index.md`. |
| `TODO/` | **Things only you can do.** Start here. |

No live AWS deploy exists yet.

## What needs you

`TODO/` — one folder, three files, ordered:

1. **`TODO/01-ai-workflow-setup.md`** — blocking. The agent system does nothing until this is done: an API key, branch protection, and the first live task. ~30 minutes.
2. **`TODO/02-deployment-requirements.md`** — AWS, domain, the IAM review. Blocks `cdk deploy`, not development.
3. **`TODO/03-open-decisions.md`** — questions agents have asked and are waiting on.

## Where things are documented

- **For you:** `TODO/`, and this file.
- **For an agent starting work:** `AGENTS.md` → `wiki/GeneralContext/index.md` → the specific module files it needs.
- **For anyone reviewing or improving the agent pipeline:** `.ai/docs/philosophy.md`, then `.ai/README.md`.

Build, test and run commands live in `AGENTS.md` — they are the same commands CI uses, so there is one copy rather than two that drift.
