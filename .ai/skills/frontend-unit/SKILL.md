---
name: frontend-unit
description: How fanwire's React SPA is laid out, tested and wired to the backend. Load for any task touching frontend/src/.
---

# Frontend unit

## Running

```
docker compose run --rm frontend-test    # what CI runs; authoritative
cd frontend && npm test                  # fast local loop
cd frontend && npm run typecheck && npm run lint && npm run build
```

After any `docker compose run --rm ...`, run `docker compose down` — `run --rm`
leaves the dependency containers holding the host ports, and the next worktree
or agent to start compose collides on them.

CI is authoritative. A local pass is a hint, not a result.

## Layout

```
frontend/src/
├── api/          schema.d.ts (generated), client.ts, nothing hand-typed
├── auth/         AuthService + its Cognito implementation
├── components/   shared UI only — anything two features both need
├── features/<name>/   feed, profile, compose, notifications, search
├── routes/       the router shell and route guards
└── test/         server.ts (msw), render helpers
```

**Connection rule, frontend form:** a feature folder never imports another
feature's internals. Shared UI goes in `components/`, all HTTP goes through
`api/`. If two features need the same thing, it moves to `components/` or
`api/` — it does not get imported sideways.

## The typed client is generated, never written

`src/api/schema.d.ts` is produced by `npm run gen:api-types` from
`backend/openapi.json`. `openapi-fetch` is the only HTTP client.

**Never hand-write a type that duplicates the schema.** If the type you need is
missing, the backend schema is the thing to fix — that is a different task.
A hand-written `interface Post { ... }` is the specific failure this setup
exists to prevent, and it will be rejected in review even if the tests pass.

## Tests mock the network, not the client

`msw` intercepts at the network layer via `src/test/server.ts`, so a test
exercises the real generated client. Handlers are typed against `paths` from
the generated schema.

Do not mock `apiClient`, do not mock `fetch`, do not inject a fake HTTP layer.
If a test needs a response shape, add an msw handler.

Queries use roles and labels (`getByRole`, `getByLabelText`), not test ids or
class names. Every input is labelled, every control is keyboard-reachable, and
focus is visible — that is the accessibility baseline, and it is testable.

## Talking to the backend

- Base URL is `VITE_API_BASE_URL` (`/api`). In dev, Vite's `server.proxy`
  forwards `/api` to `http://localhost:8001` **stripping the prefix**. That is
  the same contract CloudFront implements in production, so no CORS exists
  anywhere and none should be added.
- Auth is a real Cognito pool. The SPA sends the **ID token** as
  `Authorization: Bearer` — the backend verifier checks `aud` against the client
  id and rejects access tokens.
- Cognito ids come from `frontend/.env.local` (untracked). Never commit them,
  never print them, never hardcode a fallback.
- After sign-in, `GET /users/me` returning **404 is not an error** — it means the
  account has no profile yet, and the app routes to profile creation.

Local backend:

```
docker compose up -d --build backend-dev
docker compose exec backend-dev python scripts/seed_dev.py
```

## Configuration is read in one place

Every `import.meta.env.VITE_*` read lives in `src/config.ts`, which validates at
module load and throws on a missing value. Vite bakes these in at build time, so
a missing variable must fail the build loudly rather than produce a bundle that
404s at runtime against `undefined`.

No other file reads `import.meta.env`.

## Traps

- **Never `git stash`.** The stash stack is shared across worktrees and
  sessions. Use `git worktree add --detach` or `git show <rev>:<path>`.
- `dangerouslySetInnerHTML` on user content is forbidden, no exceptions.
- `frontend/package.json` is not writable by the code agent. If you need a
  dependency that is not already there, stop and report it — adding one is a
  Director decision, not a retry-loop decision.
- `frontend/dist/` is gitignored and must stay that way.
