# fanwire — Phase 2 Manager Agent Brief: posts/ (+ closing the Phase 1 routes gap)

## Status: complete, pending human review — do not redo

Phase 2 shipped as five PRs, stacked on Phase 1's tip (`phase-1-media`), each on its own branch:
- **#6** `phase-2a-routes-gap` — closes the Phase 1 routes gap this brief identified: real FastAPI routes + real `CognitoTokenVerifier` wiring for `events/`, `users/`, `media/` (previously pure Python, no HTTP surface).
- **#7** `phase-2-posts-models` — `Post`/`PostLike`/`EventMention`/`Report` models + migration; resolved the "quote-repost flag" and thread-depth-limit open decisions in the wiki.
- **#8** `phase-2-posts-fk-closure` — closes both FKs Phase 1 deliberately deferred: `Media.post_id → posts.id`, `User.profile_picture_media_id → media.id`.
- **#9** `phase-2-posts-facade` — `PublishPostFacade`, `MentionParser` (`#GameId` Interpreter), the moderation Chain of Responsibility, `PostEventBus` (Observer) — also wired `users/`'s `follow()` to finally publish `UserFollowed`, closing a Phase 1 no-op now that `PostEventBus` exists.
- **#10** `phase-2-posts-routes` — `posts/`'s HTTP routes (create/read/replies/like/unlike/report), wired into `app.main`.

All five are CI-green (`docker compose run --rm --build backend-test`, 230 tests passing on #10's tip). Every "Definition of done" item this brief lists below is satisfied. **A fresh agent picking up this repo should start from `wiki/GeneralContext/Prompts/phase-3-manager-agent.md`, not this file** — there is nothing left to do here. This status note exists so nobody re-implements `posts/` from scratch after reading the (still-accurate, kept for reference) brief below.

One thing genuinely **not done** and worth a line in Phase 3 (or later) rather than silently forgotten: `wiki/CodeContext/Standards/security.md`'s "posting is rate-limited per user via API Gateway usage plan + a DynamoDB cache check" — the API Gateway half is Phase 6 infra by nature, but the app-level DynamoDB cache-check half was never called out as its own unit here and nothing in `posts/` implements it. Flagging so it doesn't get lost between phases.

**Provenance note**: the subagent executing this brief (dispatched as "Manager Agent 2") hit a session rate limit mid-run once and was resumed from its worktree with full context preserved (see PRs #6-#9, produced across that interruption with no rework needed). It hit a second stall on PR #10's unit (context/session pressure again) after fully implementing and committing the work but before verifying/pushing/opening the PR — the coordinating session picked up that already-clean, fully-committed worktree, ran the verification suite, fixed one trivial lint nit, and opened #10 on its behalf. Worth knowing for future phases: a subagent this size (a whole manager-agent mandate) can run long enough to hit session limits more than once, and resuming from its worktree rather than restarting preserved all prior work both times — prefer that over a fresh restart if it happens again.

---

You are the **manager agent** for the second implementation pass of `fanwire`. Same operating model as `wiki/GeneralContext/Prompts/first-pass-manager-agent.md` (which you should skim once for the operating model/patterns/constraints — don't re-derive them): you break your mandate into small, well-bounded units, delegate each to a lighter/cheaper subagent, review and integrate what comes back, keep TDD discipline and the connection rule enforced, and keep the wiki current. You do not write most of the code yourself.

## State when you start

Phase 0 (scaffold) and Phase 1 (`events/`, `users/`, `media/`) are done — implemented, reviewed, and each opened as its own PR, stacked in this order:
- PR #1 `phase-0-scaffold` → `main`
- PR #2 `phase-1-events` → `phase-0-scaffold`
- PR #3 `phase-1-users` → `phase-1-events`
- PR #4 `phase-1-media` → `phase-1-users`

**Before you do anything else**, run `gh pr list` and `git branch -r` to find the actual current state — these PRs may or may not be merged into `main` by the time you start. Branch your own work off the tip of whichever of those is the latest *unmerged* one, or off `main` if all four have landed by then. Don't assume; check.

## A gap Phase 1 left behind — close it first, before `posts/`

Phase 1 built `events/`, `users/`, and `media/` as pure Python modules (models, business-logic functions, adapters) with **no FastAPI routes wired into `app.main`** — only `/health` exists today. That's a real gap against two things already on record: `events/`'s own business rule ("Create an API to serve the data of these game from the database to the website" — `wiki/GeneralContext/Architecture/business-rules.md` "Events") and Phase 5's frontend plan, which assumes it can run `openapi-typescript` "against the backend's live OpenAPI schema once each module's routes exist." Nobody's routes exist yet.

Treat this as **Phase 2a**, a preliminary unit before `posts/` itself (its own PR, based on wherever Phase 1 landed): add FastAPI routers for the three Phase 1 modules' actual read/write operations. You decide the exact paths/methods/request-response schemas (that's your call to make, not a subagent's — same rule as everywhere else in this brief), but at minimum:
- `events/`: read endpoints for `Team`/`Game` (list/filter, get-by-id) — this is the literal business rule, don't under-scope it.
- `users/`: a profile-creation endpoint called after Cognito confirms a new signup (**judgment call for you to make and document**: a `POST /users` endpoint protected by `get_current_identity` — the verified token's `sub` *is* the `cognito_sub` to create the row for — is simpler than standing up a separate Cognito Post-Confirmation Lambda trigger, and keeps everything in the one Mangum-wrapped app; you can call it differently if you have a better-justified design, just document why), plus read-profile, follow/unfollow, soft-delete.
- `media/`: presigned-upload-URL issuance (creates the `Media` row at `Uploaded`) at minimum; a get-by-id read endpoint if useful for the frontend later.

Wire real `CognitoTokenVerifier` (JWKS source, audience, issuer as `Settings` fields) behind `app.users.dependencies.get_token_verifier` for the first time here — Phase 1 deliberately left it `NotImplementedError` because nothing called it yet. Something now does.

## Read first, then load just-in-time

Read, in order: `AGENTS.md`, `wiki/GeneralContext/index.md`'s module map and Process note (skim, don't re-derive — you already know this shape from the state summary above if you're a fresh agent picking this up, but read it yourself, don't take this brief's word for it). Then, for the units below, pull in only:
- `wiki/CodeContext/Modules/0x03-posts.md` (your primary spec — `Post`, `PostLike`, `EventMention`, `Report`)
- `wiki/CodeContext/Modules/0x00-architecture.md` — Connection rule, `PublishPostFacade`/`PostEventBus` description, Ingestion & processing pipelines (for pattern-shape consistency, not because you're building another ingestion pipeline)
- `wiki/CodeContext/Standards/design-principles.md`, `wiki/CodeContext/Standards/gof-patterns.md` (Facade, Interpreter, Chain of Responsibility, Composite, Observer sections only), `wiki/CodeContext/Standards/security.md` (code-injection / rate-limiting bits)
- `wiki/CodeContext/Modules/0x01-users.md`, `wiki/CodeContext/Modules/0x02-events.md`, `wiki/CodeContext/Modules/0x04-media.md` only for the FK/interface shapes `posts/` touches (`User`, `Game`, `Media`) — never their full internals.

Hand each subagent the exact same narrow slice, per its unit — never the whole wiki, per `AGENTS.md`.

## Carried-forward lessons from Phase 0/1 (don't rediscover these)

- **`docker-compose.yml`'s `backend-test` mounts the host docker socket** so `testcontainers`-based tests (spinning up their own ephemeral Postgres, separate from the `postgres` service) work via docker-outside-of-docker. Already done — don't re-solve this if a subagent hits the same `DockerException` inside a container.
- **`docker compose run --rm backend-test` doesn't rebuild automatically** on file changes if an image already exists — always pass `--build` or you'll silently test a stale image.
- **A cross-module nullable FK to a not-yet-built module is handled as a plain column with no `ForeignKey()` constraint**, with a code comment + wiki note that the real constraint lands once the target module exists — this is exactly your situation for `EventMention.game_id` (fine, `events/` already exists) but also watch for it if anything here ends up wanting to point at a future module. `Media.post_id` and `User.profile_picture_media_id` are two existing deferred FKs **you get to finally close** in this phase (`Post` now exists) — do that as part of your `posts/` unit, in a small dedicated commit, and update both `wiki/CodeContext/Modules/0x01-users.md` and `wiki/CodeContext/Modules/0x04-media.md` to drop their "deferred FK" notes once the real constraints land.
- **`ruff` needs `[tool.ruff.lint.flake8-bugbear] extend-immutable-calls = ["fastapi.Depends", "fastapi.params.Depends"]`** in `backend/pyproject.toml` — already added in Phase 1, so route handlers using `Depends(...)` as a default arg shouldn't trip `B008`. If you add another FastAPI-idiom false positive, fix it the same way (repo-wide config, not scattered `# noqa`).
- **`pip-audit --ignore-vuln PYSEC-2026-1325`** is the standing CI gate (an unfixable `ecdsa`/`python-jose` timing side-channel, accepted risk, documented in `wiki/CodeContext/Modules/0x01-users.md`). Keep using it; re-verify the reasoning still holds (nothing you add should sign/verify with an EC key) rather than blindly carrying it forward forever.
- **State/Template Method precedent**: `app/media/state.py` + `app/media/pipeline.py` and `app/events/ingestion.py` are the two reference implementations for "State" and "Template Method" respectively in this codebase — point subagents at them as style references the same way this brief points you at them.

## Hard constraints — non-negotiable

Identical to the first-pass brief — repeated here because they matter, not because they've changed:
- **TDD** per `AGENTS.md` Workflow: failing test committed alone, implementation committed separately, never combined, never skipped.
- **Connection rule**: no module reaches past its own interface boundary into another module's concrete classes/tables. `posts/` touches `users/`, `events/`, `media/` only via IDs/FKs and the interfaces those modules already expose (`app.users.dependencies.get_current_identity` for authN, `app.media.state`/`MediaStatus` to check a `Media` row is `Processed` before allowing attachment) — never their internals.
- **Patterns as assigned**: `PublishPostFacade` (Facade), `MentionParser` (Interpreter), the moderation *chain* (`ProfanityFilter → SpamScoreCheck → RateLimitCheck → DuplicateContentCheck`, Chain of Responsibility — this is pre-publish checks, **not** the excluded `moderation/` module; see `wiki/CodeContext/Modules/0x03-posts.md`'s explicit note that `Report`'s `ReportPostCommand` is **not** implemented), `Post`/reply-thread as Composite, `PostEventBus` publish (Observer) for `PostCreated`/`PostMentionedEvent`/`PostReported`.
- **Design principles / Security baseline** on every diff.
- **No live AWS** — `moto`/`testcontainers`/`docker-compose` local Postgres+DynamoDB-local only.
- **Wiki stays current** — update the relevant `0x0N-*.md` file(s) in the same pass a documented decision changes; don't leave it stale, don't resolve something silently without updating the doc that flagged it.
- **No moderation/reporting workflow beyond the `Report` flag.** Do not build `moderation/`, `reporting/`, `DeletePostCommand`, `HidePostCommand`, or a review/undo workflow for reports — `wiki/CodeContext/Modules/0x03-posts.md` is explicit this is v1 scope, not a gap.
- **Branch/PR discipline**: feature branch per unit, PR per unit (not one giant PR), based on the correct current tip (see "State when you start"). Branch protection requires human approval before merge — do not attempt to bypass this, and do not merge your own PRs.

## Known blockers — flag, don't invent

1. **Quote-repost flag** (`wiki/CodeContext/Modules/0x03-posts.md` "Open decisions"): make the simplest defensible call (`is_repost=true` with non-empty `text`, no separate flag, per the file's own framing) and document why, or make a different defensible call — either way, resolve it in the wiki rather than leaving it open indefinitely; this is exactly the kind of decision the first-pass brief's blocker #3 already covers.
2. **Unresolved mention tokens** (a `#GameId`/`$TEAM` that doesn't match any known `Game`/`Team`): the wiki flags this as unspecified. Pick one (silently drop the token from `EventMention` creation but keep the post text as-authored is the simplest/least-surprising default) and document it.
3. **Mention count cap, thread-depth/repost-of-repost limits**: not specified; don't invent a limit unless you have a concrete abuse/perf reason to — YAGNI cuts the other way here unless you find one.
4. **`reported`/`PostReported` has no subscriber yet** — `notifications/`/`feed/`/`search/` don't exist until Phase 3. Publish the event (Observer, `PostEventBus`), but don't invent a consumer. Same precedent as Phase 1's `match_to_mentions`/`publish` no-ops and `follow()`'s missing `UserFollowed` publish — except here you're the one *adding* the publish side, since `posts/` is the module that owns `PostEventBus`. Go back and wire `users/`'s `follow()` (currently a documented no-op, see `wiki/CodeContext/Modules/0x01-users.md`) to actually publish `UserFollowed` now that `PostEventBus` exists — that's a small, natural piece of closing the loop you're in the best position to do, since you're the one standing up `PostEventBus` in the first place.
5. **The Kaggle seed-loader is still not built** (`backend/seed-data/` doesn't exist — the human hasn't downloaded `wyattowalsh/basketball` yet). Not your job this phase either; just don't let anything in `posts/` assume real `Game` data exists beyond what your own tests seed.

## Operating model

Same as the first-pass brief: give each subagent the single wiki module file (+ cited Standards excerpts) for its unit, the exact interface/contract (you decide, not the subagent), explicit TDD-first instruction, and its module boundary. Run its tests (`docker compose run --rm --build backend-test`, plus direct `pytest`/`ruff`/`pip-audit` the same way Phase 1 did) before accepting. Don't parallelize units with a shared integration point (e.g. two subagents both touching `PublishPostFacade`, or both generating Alembic migrations against the same head) — sequence those; parallelize only genuinely independent pieces.

Given the deferred-FK closures above (`Media.post_id`, `User.profile_picture_media_id`) both depend on `Post` existing, do the `Post`/`PostLike`/`EventMention`/`Report` models-and-migration unit first, then the FK-closure unit, then `PublishPostFacade`/`MentionParser`/the moderation chain, then routes, then the Phase 2a retroactive-routes-for-Phase-1 unit (or do 2a first if you'd rather establish routing conventions before `posts/`'s own routes need them — your call, just don't parallelize it against anything that also touches `app/main.py`'s router registration).

## Definition of done for this pass

- `posts/` has passing tests, respects the connection rule, implements every pattern assigned to it (Facade/Interpreter/Chain of Responsibility/Composite/Observer), and its wiki file's resolved "Open decisions" are updated in place.
- The two deferred FKs from Phase 1 (`Media.post_id → posts.id`, `User.profile_picture_media_id → media.id`) are closed with real constraints.
- `events/`, `users/`, `media/`, and `posts/` each have real FastAPI routes wired into `app.main`, and `GET /openapi.json` (FastAPI's own auto-generated schema endpoint) reflects all of them.
- `docker compose run --rm --build backend-test` and `docker compose run --rm --build frontend-test` both still pass (frontend shouldn't need any change this phase, but confirm the scaffold isn't broken).
- One PR per unit, each with a description naming which patterns/principles it exercises and any judgment calls made.
- Final summary to the human: what shipped, what's still open, which wiki files changed, and a **process-outcomes report** (see below).

## Process outcomes — required in the final summary

Same ask as the first-pass brief, same reason (deciding which rules are worth a real technical gate later): report every judgment call a written rule would have settled instead, anywhere test/CI feedback was slow/manual enough a script could've caught it, and whether the module boundaries held up once you were actually inside `posts/` touching three other modules' data by FK. Specifically also report: did the "routes gap" fix turn out to be as small as this brief assumed, or did it reveal more missing plumbing (auth wiring, CORS, request validation middleware, etc.) that should get its own explicit line item in the next phase's brief?
