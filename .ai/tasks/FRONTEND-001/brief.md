# FRONTEND-001 — foundation, typed client, configuration

## Why this exists

`frontend/src/` is three files and an `<h1>`. Every dependency the app needs is
already installed and none of them is imported anywhere. `npm run gen:api-types`
reads `../backend/openapi.json`, **which does not exist**, so the typed client
cannot be generated at all today.

This unit is the skeleton and the contract. Six more units land on top of it, so
a shortcut here is paid for six times.

## The four things it delivers

**1. A deterministic OpenAPI export.** `backend/scripts/export_openapi.py`
imports the FastAPI app, calls `app.openapi()`, and writes
`backend/openapi.json` with `sort_keys=True`, `indent=2` and a trailing newline.
Determinism is the whole point: the file is committed, and CI regenerates it and
fails on any diff. A dict iteration order that varies run to run turns that gate
into a coin flip.

The backend test that pins this belongs in `backend/tests/test_export_openapi.py`
and must compare the *committed* file to a *freshly exported* one — not the
export function to itself.

**2. The typed client.** `npm run gen:api-types` produces
`frontend/src/api/schema.d.ts`. `frontend/src/api/client.ts` wraps
`openapi-fetch`'s `createClient<paths>` with one middleware that attaches
`Authorization: Bearer <id-token>`.

The token comes from an **injected provider**, not from a module-level import of
the auth layer. `FRONTEND-002` supplies the real one; this unit ships the seam
and a test double. Production code must never branch on environment to decide
where the token comes from.

**3. Configuration, read in exactly one place.** `frontend/src/config.ts` reads
every `import.meta.env.VITE_*` value, validates it, and throws naming the
missing variable.

This is not defensive style, it is the deploy design. Vite inlines `VITE_*` at
build time, and the production Cognito pool id only exists *after*
`Fanwire-Auth` deploys — so the bundle is built once, for one environment, from
stack outputs. A missing variable must break the build loudly; a bundle that
ships `undefined` into a Cognito call fails in a user's browser instead, with no
signal anywhere near the deploy. See `TODO/04-first-deploy.md`.

The test that asserts nothing else reads `import.meta.env` is what keeps this
true after six more units have touched the tree.

**4. The shell.** react-router routes for feed (`/`), compose, notifications,
search, profile and the auth pages; a `QueryClientProvider`; a shared render
helper in `src/test/` that puts both in scope; and `src/test/server.ts`, the msw
server, configured with `onUnhandledRequest: "error"`.

A route that has no unit yet renders a placeholder. That is expected — the shell
is what lets the next six units be independent.

## Constraints that are not negotiable

- **`frontend/vite.config.ts` is in `forbidden_paths` and already correct.** The
  `/api` proxy with the prefix strip is committed. Do not add CORS anywhere, to
  either side. The browser sees one origin in both environments by design.
- **Nothing hand-writes an API type.** If a shape you need is missing from the
  generated schema, the backend is what is wrong, and that is a different task.
- **`frontend/package.json` is forbidden.** Every dependency this unit needs is
  already there. If you believe one is missing, stop and report it.
- `frontend/src/features/**` and `frontend/src/auth/**` are forbidden here. They
  belong to later units, and a placeholder route does not need them.

## A note for whoever runs this unit

This is the one task in the set that has to **execute** a generator —
`export_openapi.py`, then `npm run gen:api-types` — rather than only write files.
Whether a CI-dispatched worker under `--permission-mode acceptEdits` can run a
command at all is recorded as untested in `.ai/docs/handoff.md` §8. If this unit
runs locally with a human present, that question does not arise; if it is
dispatched, expect this to be the task that finds the answer.
