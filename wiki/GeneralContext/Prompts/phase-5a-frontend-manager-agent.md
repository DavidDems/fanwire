# fanwire — Phase 5a Manager Agent Brief: Frontend foundation, auth, profile, compose

> **Status 2026-09-25: superseded as a process. Still correct as facts.**
>
> This brief's seven units are now seven validated task specs in `.ai/tasks/`
> (`FRONTEND-001` … `FRONTEND-007`), where the unit contract is a `task.json`
> whose `allowed_paths` are enforced against the real diff in CI, and the
> acceptance criteria are committed failing tests before they are anything
> else. Unit 1 here is `FRONTEND-001`, **merged** in PR #48.
>
> **Do not run this brief's process.** Read
> [`frontend-build-handoff.md`](frontend-build-handoff.md) instead — it is the
> live one, and it carries what actually went wrong in unit 1.
>
> **Do keep reading this file for its settled facts**, which the specs cite and
> which have not changed: the `/api` prefix strip, the ID-token rule, the 404
> from `GET /users/me`, DOB privacy, the generated-types rule, the local ports,
> and the no-`git stash` rule.

You are the **manager agent** for the first half of `fanwire`'s frontend pass. You delegate each unit to a subagent, review and integrate what comes back, enforce TDD and the connection rule, and keep the wiki current. You write little code yourself. Phase 5b (`phase-5b-frontend-manager-agent.md`) picks up after you; stop where this brief stops.

Operating model and lessons: skim the "Status" section of `wiki/GeneralContext/Prompts/phase-4-manager-agent.md` once. Don't re-derive anything it settled.

## Before anything else
1. Check that the backend actually landed. Run `gh pr list --state all`, `git fetch`, then `git merge-base --is-ancestor origin/<branch> origin/main` for every backend branch you depend on (`phase-3-search` and the backend Lambda-handlers unit). Stacked PRs in this repo were once merged into their parent branches and never reached `main`, so check ancestry rather than PR state. Branch every unit off `main` once it holds the whole backend.
2. Read the human-input checklist at the bottom of `phase-4-manager-agent.md` ("Frontend: human input needed"). Any unanswered item that blocks a unit gets flagged, not guessed.

## Read first, then load just-in-time
- `AGENTS.md`, `wiki/GeneralContext/index.md`
- `wiki/CodeContext/Standards/aws-stack.md` "Frontend" section and `design-principles.md`
- `gof-patterns.md`: Builder, Prototype, Mediator and Memento only (the compose unit)
- `wiki/GeneralContext/Architecture/dev-auth-setup.md`, **mandatory for the auth unit**. It holds the ID-token contract and the real dev Cognito pool.
- `wiki/CodeContext/Modules/0x00-architecture.md` "Frontend ↔ API contract" paragraph (the `/api` prefix strip)
- Per unit, the backend module file it surfaces: `0x01-users.md` for auth/profile, `0x03-posts.md` + `0x04-media.md` for compose. These are for the contract, not to reimplement anything.

## Settled facts (don't re-litigate)
- **API**: the SPA calls `VITE_API_BASE_URL` (`/api`). In dev, Vite's `server.proxy` sends `/api` to `http://localhost:8001` with the prefix stripped. That's the same contract CloudFront implements in prod, so no CORS is needed. The local backend is `docker compose up -d --build backend-dev`, then `docker compose exec backend-dev python scripts/seed_dev.py`.
- **Auth is real Cognito**, a dev pool (never an emulator or an in-house fake: human decision). The ids are in `frontend/.env.local` (`VITE_COGNITO_REGION`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`) and `backend/.env`. Both are untracked; never commit or print them. The SPA sends the **ID token** as `Authorization: Bearer`, because the backend rejects access tokens. After sign-up + email confirmation, call `GET /users/me`: a 404 means there's no profile yet, so route to profile creation (`POST /users`, which requires `username` and `date_of_birth`).
- **DOB is private**: shown only on the user's own profile/settings, never on public profile views.
- **Typed client**: `openapi-typescript` generates `src/api/schema.d.ts` from `backend/openapi.json`, and `openapi-fetch` is the only HTTP client. Never hand-write types that duplicate the schema.
- Local ports: dynamodb-local 8000, backend-dev 8001, postgres 5432. All three are overridable via `DYNAMODB_HOST_PORT`, `BACKEND_DEV_PORT` and `POSTGRES_HOST_PORT` when running compose from several worktrees at once. After `docker compose run --rm ...`, **always** run `docker compose down`, because `run --rm` leaves the dependency containers holding the ports.
- Never use `git stash` for checks; the stash stack is shared across worktrees and sessions. Use `git worktree add --detach` or `git show rev:path` instead.

## Units, sequential, one branch and PR per unit, each PR based on `main`
1. **Foundation + typed client.**
   - `backend/scripts/export_openapi.py` writes `backend/openapi.json` deterministically (sorted keys, trailing newline); commit the JSON.
   - A CI job regenerates it and fails on any diff, so a backend route change without a regenerated schema breaks the build. It's a technical gate, not prose.
   - `npm run gen:api-types`; a single `apiClient` module (openapi-fetch) with an auth-header middleware fed by an injected token provider.
   - The Vite proxy; react-router shell with routes for feed, profile, compose, notifications, search, auth; react-query provider; an `msw` test harness (`src/test/server.ts`) whose handlers are typed against `paths` from the generated schema.
   - Also add a `ruff check` + `ruff format --check` backend CI job. Pre-existing lint debt exists (`tests/notifications/test_channels.py` I001 among others), so fix it in the same PR so the gate starts green.
2. **Auth**.
   - An `AuthService` interface with one real implementation over `amazon-cognito-identity-js`: sign-up, confirm code, resend code, sign-in (SRP), sign-out, forgot/confirm password, session refresh, current ID token. Tests inject a test double of the *interface*; production code never branches on environment.
   - Pages: sign-up, confirm, sign-in, forgot password, and profile creation (username + DOB + optional description/preferred team, with teams from `GET /events/teams`).
   - A route guard: protected routes redirect to sign-in; a signed-in user without a profile goes to profile creation.
   - Token storage: the library's default localStorage is acceptable for v1. Note the XSS trade-off in the PR and wiki; don't invent a cookie backend.
3. **Profile / follow.**
   - Own profile: `GET /users/me` and `PATCH /users/me` for description, preferred team and profile picture. The picture reuses the compose unit's upload widget if it already exists; otherwise ship without the picture control and note it.
   - Other users: `GET /users/{id}` (public, no DOB), follower/following counts, follow/unfollow with state from `GET /users/me/following`, optimistic update with rollback on error.
4. **Compose.**
   - `PostBuilder` (Builder): assembles `CreatePostRequest` across steps (text, media ids, reply/repost context), and `build()` validates.
   - `ComposeMediator` (Mediator): text box, `#GameId`/`$TEAM` mention autocomplete (teams from `/events/teams`, games from `/events/games`) and the media widget communicate only through it.
   - `DraftSnapshot` (Memento): snapshot before attaching live-event data; undo restores it.
   - `PostTemplate.clone()` (Prototype): a small set of quick-post templates such as "final score reaction" and "pre-game hype".
   - Media: `POST /media/uploads` returns a presigned **POST** (`upload_url` + `fields` + `max_bytes`; S3's policy enforces size and type). The browser sends a multipart POST of `fields` + `file` straight to S3, never through the API. Pre-check jpeg/png/webp and `max_bytes` client-side for UX; S3 and the backend enforce both regardless. Only `Processed` media can be attached, so poll `GET /media/{id}` until processed.
   - **Check the human-input checklist**: whether media upload can be verified in a browser depends on the human's answer about dev S3. If it isn't answered, build and test with msw, and report the manual browser verification of upload as not done.

## TDD and verification (every unit)
- A failing `vitest` + `@testing-library` test against the intended behaviour, committed **alone**; then the implementation, committed separately. msw mocks at the network layer, so tests exercise the real generated client and never a hand-mocked one.
- Gates: `docker compose run --rm --build frontend-test` (then `docker compose down`), `npm run typecheck`, `npm run lint`, `npm run build`.
- **Real browser check** (repo-wide rule): with `backend-dev` running and `npm run dev`, click through the golden path plus at least one edge case, using the `claude-in-chrome` skill if it's available. Auth is against the real dev pool. Say plainly in the PR if you couldn't, and why; never claim it otherwise.
- Accessibility baseline: labelled inputs, keyboard-reachable controls, visible focus. Test queries use roles and labels.

## Hard constraints
Connection rule on the frontend: API types come only from the generated schema, and feature folders don't import each other's internals (shared UI goes in `src/components/`, API access in `src/api/`). Patterns as assigned above. No `dangerouslySetInnerHTML` on user content. No secrets or ids in git. No deploy. No self-merge; state the merge order in every PR body.

## Definition of done (5a)
Units 1–4 merged or open with green gates; the typed client and CI schema gate exist; the wiki is updated (a frontend section in `0x00-architecture.md` or a new `wiki/CodeContext/Modules/0x08-frontend.md`, your call, recording layout, patterns and the auth flow). Update this file's top with a Status note, then hand off to 5b with a short report: what shipped, what couldn't be browser-verified, judgment calls, and **process outcomes**. For process outcomes, report every judgment call a written rule would have settled, every slow or manual check a script could run, and whether the module seams held.
