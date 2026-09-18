# AGENTS.md

**Agent-facing.** Entry point for any agent working in this repo.

## State
No application code exists yet. This repo currently holds `wiki/` (all AI-facing context — implementation decisions, standards, rules, prompts, reports) and this scaffolding. The first work here is initializing the FastAPI backend, React frontend, and AWS CDK infrastructure per `wiki/CodeContext/Standards/aws-stack.md` — there is nothing to build/test/run before that.

## Wiki structure — read this before touching `wiki/`
`wiki/` has two folders, split by audience (not by technical access control — see Process note below):
- **`wiki/GeneralContext/`** — manager/thinking-tier context. Full project dictionary, start at `wiki/GeneralContext/index.md`.
- **`wiki/CodeContext/`** — the module/standards content a code-change agent needs for its unit of work.

## Process note
There is no formal agent-governance/usage-rules process on this branch. It was drafted, then deliberately deferred until it can be backed by real technical enforcement (permissions, CI, hooks) rather than prose instructions an agent could ignore — see `wiki/GeneralContext/index.md`'s Process note. The drafted version lives on a separate `rules` branch for later.

## Context loading
Load just-in-time, not the whole wiki. A manager-tier agent reads `wiki/GeneralContext/index.md` first for the module map and rule index, then only the specific `wiki/CodeContext/Modules/0x0N-*.md` file(s) and `wiki/CodeContext/Standards/*.md` excerpts relevant to the module it's touching. Hand a subagent that exact small file set — never the whole wiki.

## Conventions
- Every table: bigint identity primary key (`wiki/CodeContext/Modules/0x00-architecture.md` Conventions) — not UUID.
- `PostEventBus` (EventBridge) is the one domain event bus for the whole app, not `posts/`-exclusive despite the name.
- No module reaches past its own interface boundary into another module's concrete classes or tables — `wiki/CodeContext/Modules/0x00-architecture.md` Connection rule.
- Apply `wiki/CodeContext/Standards/design-principles.md` on every change: SOLID, DRY/KISS/YAGNI, fail-fast/validate-at-boundaries-only, 12-factor, the security baseline.
- Follow `wiki/CodeContext/Standards/gof-patterns.md` for which pattern implements which piece of behavior — don't introduce a different pattern for something already assigned one there.

## Build / test / run
Backend (`backend/`), frontend (`frontend/`), infra (`infra/`) each have their own scaffold now (Phase 0). Prefer the `docker-compose` commands below — they run in the same containers CI uses. Direct commands are for fast local iteration.

**Backend**
- Test (containerized, matches CI): `docker compose run --rm backend-test`
- Test (direct, from `backend/`): `.venv/Scripts/python -m pytest tests/` (create the venv once: `python -m venv .venv && .venv/Scripts/python -m pip install -e ".[dev]"`)
- Alembic migration: `DATABASE_URL=... .venv/Scripts/python -m alembic upgrade head` (or `revision --autogenerate -m "..."`)
- Lint/type-check: `.venv/Scripts/python -m ruff check .`, `.venv/Scripts/python -m mypy app`

**Frontend** (from `frontend/`)
- Test (containerized, matches CI): `docker compose run --rm frontend-test`
- Test (direct): `npm test` / `npm run test:watch`
- Dev server: `npm run dev`
- Build: `npm run build`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`

**Infra** (from `infra/`) — not yet scaffolded (Phase 6): `npm run synth` will run `cdk synth` once the CDK stacks exist. `cdk deploy` is out of scope until a human reviews the generated IAM policy.

**CI**: `.github/workflows/test-agent.yml` builds and runs both `backend-test` and `frontend-test` targets on every PR.

## Workflow
1. Write a failing test against the requested change first, against the intended interface even if the entity doesn't exist yet. Commit it alone.
2. Implement until the test passes. Commit separately. Never combine steps 1 and 2 into one commit, never skip step 1.
3. Update the relevant `wiki/CodeContext/Modules/0x0N-*.md` file(s) in the same pass if the change alters a documented decision — wiki entries are pruned/merged when they stop being referenced or a correction supersedes them, not left stale.
