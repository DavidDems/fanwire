# 0x08 — Frontend

**Agent-facing.** Current-state only — see [[wiki/GeneralContext/index|index]] for how this wiki is organized.

The React SPA. Backend module contracts live in `0x01`–`0x07`; this file records
what the frontend does with them, and nothing that belongs to a backend module.

## State

**Scaffold only.** `frontend/src/` is `main.tsx`, an `App.tsx` rendering
`<h1>fanwire</h1>`, and one test. Every dependency the build needs is already in
`frontend/package.json` (react-router-dom, @tanstack/react-query, zustand,
openapi-fetch, amazon-cognito-identity-js, date-fns, msw, openapi-typescript),
and none of them is imported anywhere yet.

Nothing reads `import.meta.env`. There is no typed API client, no router, no
auth, and `backend/openapi.json` — which `npm run gen:api-types` reads — does not
exist.

The build pass that fills this in is sequenced in `TODO/04-first-deploy.md` and
specified as tasks `FRONTEND-001` … `FRONTEND-007`.

## Settled contracts

These are decided and are not re-litigated by a unit that finds them
inconvenient:

- **API base URL** is `VITE_API_BASE_URL` = `/api`, same origin in both
  environments. Vite's `server.proxy` strips `/api` in dev; a CloudFront Function
  strips it in production ([[0x00-architecture]] "Frontend ↔ API contract").
  There is no CORS anywhere and none is to be added.
- **Types are generated**, never hand-written: `openapi-typescript` produces
  `src/api/schema.d.ts` from `backend/openapi.json`, and `openapi-fetch` is the
  only HTTP client.
- **Auth is real Cognito** — a hand-made dev pool locally, `Fanwire-Auth`'s pool
  in production. Never an emulator or an in-house fake. The SPA sends the
  **ID token** as `Authorization: Bearer`; the backend rejects access tokens
  ([[0x01-users]]).
- **A 404 from `GET /users/me`** means "authenticated, no profile yet" and routes
  to profile creation. It is a state, not an error.
- **Date of birth is private**: the user's own profile and settings only, never a
  public profile view.
- **Configuration is read in exactly one module** (`src/config.ts`), which
  validates at load and throws on a missing value. Vite inlines `VITE_*` at build
  time, so the production bundle is only correct for the environment it was built
  against — see `TODO/04-first-deploy.md` for why that forces a two-phase deploy.

## Open decisions

- Whether the frontend wiki grows past this file into per-feature sections, or
  stays one file, is the call of whoever finishes `FRONTEND-007`.
