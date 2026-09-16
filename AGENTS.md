# AGENTS.md

**Agent-facing.** Entry point for any agent working in this repo.

## State
No application code exists yet. This repo currently holds only `wiki/` (entity-by-entity implementation decisions), `reference/` (the principles and stack/security/pattern decisions each wiki entry cites), and this scaffolding. The first work here is initializing the FastAPI backend, React frontend, and AWS CDK infrastructure per `reference/AWS Stack.md` — there is nothing to build/test/run before that.

## Context loading
Load just-in-time, not the whole wiki (per `reference/Usage principals.md`'s Category 2 context rule): read `wiki/index.md` first for the module map, then only the `wiki/0x0N-*.md` file(s) relevant to the module you're touching. Each wiki file already cites the exact `reference/` doc backing its decisions — follow those links instead of re-reading every reference doc up front.

## Conventions
- Every table: bigint identity primary key (`wiki/0x00-architecture.md` Conventions) — not UUID.
- `PostEventBus` (EventBridge) is the one domain event bus for the whole app, not `posts/`-exclusive despite the name.
- No module reaches past its own interface boundary into another module's concrete classes or tables — `wiki/0x00-architecture.md` Connection rule.
- Apply `reference/Design principles.md` on every change: SOLID, DRY/KISS/YAGNI, fail-fast/validate-at-boundaries-only, 12-factor, the security baseline.
- Follow `reference/Gang of Four Example.md` for which pattern implements which piece of behavior — don't introduce a different pattern for something already assigned one there.

## Build / test / run
Not yet defined — no code exists. Add real commands here the moment the first scaffold (FastAPI app, CDK stack, or React app) is created; do not leave this section stale once code exists.

## Workflow (Category 2 — code & wiki edits, per `reference/Usage principals.md`)
1. Write a failing test against the requested change first, against the intended interface even if the entity doesn't exist yet. Commit it alone.
2. Implement until the test passes. Commit separately. Never combine steps 1 and 2 into one commit, never skip step 1.
3. Update the relevant `wiki/0x0N-*.md` file(s) in the same pass if the change alters a documented decision — wiki entries are pruned/merged when they stop being referenced or a correction supersedes them, not left stale.
