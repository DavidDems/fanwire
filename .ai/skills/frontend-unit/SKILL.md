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
├── auth/         AuthService + its Cognito implementation, the session
│                 context, the five auth pages, the shared profile query
├── components/   shared UI only — anything two features both need
├── features/<name>/   feed, profile, compose, notifications, search
├── routes/       the router shell, the route table and the guards
└── test/         server.ts (msw), render helpers, the AuthService double
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

## What already exists — use it, do not rebuild it

`FRONTEND-001` and `FRONTEND-002` are merged. None of these is named in any
task spec, because none existed when the specs were written:

| | |
|---|---|
| `src/test/auth.tsx` | `FakeAuthService` (a double of the **interface**), `renderWithAuth(ui, { authService, route })`, and msw handler factories for `GET /users/me` and `GET /events/teams` |
| `src/auth/AuthContext.tsx` | `useAuth()` → `{ session, status, signIn, signOut, authService }`. `status` is `"loading" \| "anonymous" \| "authenticated"` |
| `src/auth/profile.ts` | `PROFILE_QUERY_KEY` + `useProfile(enabled)` — the **one** shared react-query entry for `GET /users/me`. Anything that changes the profile invalidates this key; a second key hands one guard a 404 another has already seen answered |
| `src/routes/guards.tsx` | `RequireAuth`, `RequireNewProfile` |
| `src/components/FormField.tsx` | `Field` + `describeField` — the label / `aria-invalid` / `aria-describedby` wiring every form here shares |
| `src/test/render.tsx` | `renderWithProviders` (react-query + memory router) |

Two rules are enforced by tests that walk the source tree from disk, so
breaking either fails wherever you write it: **only
`src/auth/CognitoAuthService.ts` may import the Cognito SDK**, and **only
`src/config.ts` may read `import.meta.env`**.

## The test harness: a plain static `import` works

This is the part that has cost the most time, so it is worth 30 seconds.

- `vite.config.ts`'s `test.env` supplies all five `VITE_*` values. `config.ts`
  throws at module load on a missing one, and `.dockerignore` excludes
  `**/.env.*`, so the container and CI have **no env file at all** — without
  `test.env` a test that imports anything reaching `config.ts` passes locally
  and cannot pass in CI.
- `setupTests.ts` calls `server.listen()` at **module scope**, not in
  `beforeAll`. `openapi-fetch`'s `createClient` captures `globalThis.fetch`
  when constructed and `api/client.ts` constructs `apiClient` at module load,
  so listening from a hook left every statically imported `apiClient` holding
  the unpatched fetch — requests went to the real network as `ECONNREFUSED`.
- Therefore: **import the thing you are testing normally.** Do not copy the
  `vi.resetModules()` + dynamic-import dance in `src/api/client.test.ts`; it
  predates the fix. `src/test/harness.test.ts` pins both properties.
- `setupTests.ts` already calls `cleanup()` in a global `afterEach`. You do not
  need your own.
- A test run never reads `.env.local` — `test.env` outranks it — so the real
  dev pool is unreachable from a test.

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
- Cognito ids come from `frontend/.env.local` (untracked) for `npm run dev` and
  `npm run build`, and from `vite.config.ts`'s `test.env` for a test run. Never
  commit them, never print them, never hardcode a fallback. A pool id and a
  public client id are not secrets — they ship in the bundle — but **a token
  is**: never log one, never render one, never put one in an error message.
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
