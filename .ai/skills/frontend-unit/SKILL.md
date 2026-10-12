---
name: frontend-unit
description: How fanwire's React SPA is laid out, tested and wired to the backend. Load for any task touching frontend/src/.
---

# Frontend unit

## What runs, and who runs it

You have file tools and no shell: no `npm`, `npx`, `docker`, `git` or
browser, so you never see a result before you finish. The workflow commits
your diff, then CI runs these over the whole branch, each a required job, in
`frontend/`:

| Job | What it runs |
|---|---|
| `frontend-test` | `vitest run` in the test container (jsdom) |
| `frontend-typecheck` | `tsc -b` over `src/`, **test files included** |
| `frontend-lint` | `eslint .` |

Before finishing, re-read every file you wrote as its linter would: an unused
import or a stray `any` costs a whole CI run.

## Rules every file must pass, tests included

A test commit that fails lint, or that `tsc` flags for an unused declaration,
is red for the **wrong reason**: the code agent cannot edit tests, so the task
goes to the manager instead of to implementation.

- **eslint** (`eslint.config.js`: `@typescript-eslint` recommended +
  `react-hooks`). What tests trip: `no-explicit-any` (type it, or `unknown`);
  `no-unused-vars` (imports, variables, destructured fields, a `catch (e)`
  never read); `no-unused-expressions` (`expect(x).toBeTruthy` without `()`);
  `ban-ts-comment` (no `@ts-ignore`; `@ts-expect-error` only with a
  description); `no-require-imports`; `no-empty-object-type`; `rules-of-hooks`.
- **tsc** (`tsconfig.app.json`): `strict`, `noUnusedLocals`,
  `noUnusedParameters`, and `verbatimModuleSyntax`, so a type-only import is
  `import type { X }` or `import { type X }`. An import of a module that does
  not exist yet is the right red; every other line must type-check once the
  interface it names exists.
- **Vitest runs with `globals: false`.** Import `describe`, `it`, `expect`,
  `vi` from `"vitest"`. `tsc` accepts the bare globals; the run does not.
- **Prettier 3 defaults** (there is no config file, and CI does not check it,
  so write in its style): 80 columns, 2-space indent, double quotes,
  semicolons, trailing commas wherever a list breaks across lines, parentheses
  around every arrow parameter. Edit only the files your task is about; never
  reformat a file you are not otherwise changing, and never a committed test
  (`UI-005`'s formatter run reformatted three, which had to be restored).

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

`src/api/schema.d.ts` is generated from `backend/openapi.json`;
`openapi-fetch` is the only HTTP client. **Never hand-write a type that
duplicates the schema.** If the type you need is missing, the backend schema
is the thing to fix — a different task. A hand-written `interface Post { ... }`
is rejected in review even if the tests pass.

## What already exists — use it, do not rebuild it

Earlier units left these; specs written before them do not name them.

| | |
|---|---|
| `src/test/auth.tsx` | `FakeAuthService` (a double of the **interface**), `renderWithAuth(ui, { authService, route })`, and msw handler factories for `GET /users/me` and `GET /events/teams` |
| `src/auth/AuthContext.tsx` | `useAuth()` → `{ session, status, signIn, signOut, authService }`. `status` is `"loading" \| "anonymous" \| "authenticated"` |
| `src/auth/profile.ts` | `PROFILE_QUERY_KEY` + `useProfile(enabled)` — the **one** shared react-query entry for `GET /users/me`. Anything that changes the profile invalidates this key |
| `src/routes/guards.tsx` | `RequireAuth`, `RequireNewProfile` |
| `src/components/FormField.tsx` | `Field` + `describeField` — the label / `aria-invalid` / `aria-describedby` wiring every form shares |
| `src/test/render.tsx` | `renderWithProviders` (react-query + memory router) |
| `src/test/module-css.ts` | readers for `*.module.css`, and `moduleCssViolations` (raw colours, `px` font sizes, `outline: none` with no `:focus-visible`). Reuse it; do not write another scanner |

## Tree scans read your test file too

Some tests walk every file under `src/` from disk, **test files included**:
`styles/base.test.ts` (no keyframes at-rule anywhere), `test/env-usage.test.ts`
(the Vite env object read only in `config.ts`), `auth/sdk-isolation.test.ts`
(the Cognito SDK package imported only by `auth/CognitoAuthService.ts`), and
the `*-isolation.test.ts` files under `features/` (no sideways imports). A test
that writes the forbidden text literally — in an assertion, a regex, a comment
or a test name — fails that scan, and the baseline is red for the wrong
reason. Build the needle from fragments, as those files do:
`["@", "key", "frames"].join("")`.

A scan you write reads every other test the same way, including ones a sibling
task adds later. Find `src` from `process.cwd()` (try `src`, then
`frontend/src`, as the existing scans do) and assert the walk found files, so
it cannot pass vacuously.

## The test harness

- `vite.config.ts`'s `test.env` supplies all five `VITE_*` values; the CI
  container has no env file, and `config.ts` throws at load on a missing one.
  `vite.config.ts` is not yours to change.
- `setupTests.ts` starts msw at module scope with
  `onUnhandledRequest: "error"` (a request no handler matches fails the test)
  and calls `cleanup()` after each test. **Import what you test normally**;
  do not copy the `vi.resetModules()` + dynamic-import dance in
  `src/api/client.test.ts`, which predates the fix.
- The test container copies `frontend/` only. A test that reads a file outside
  it (`brand/`, `backend/`) cannot pass in CI.

## Tests mock the network, not the client

`msw` intercepts at the network layer via `src/test/server.ts`, so a test
exercises the real generated client; handlers are typed against `paths` from
the schema. Do not mock `apiClient` or `fetch`; add an msw handler.

Query by role and label (`getByRole`, `getByLabelText`), not test ids or class
names. Testing Library gives **every** `<header>` the `banner` role, including
those inside cards, so `getByRole("banner")` throws on a page that renders
one; scope with `within(...)`.

## What jsdom can and cannot show (Vitest 4)

- **No CSS is applied.** Computed styles, custom properties, layout, media
  queries, hover and focus rings read empty or default. Never assert how
  something looks, and do not try to switch CSS processing on.
- **A CSS Module import is a proxy.** `styles.primary` is a hashed name, and
  so is `styles.doesNotExist`. `toHaveClass(styles.x)` proves the component
  applies `x`, not that `.x` exists. Assert a class only through the module's
  export (never a literal), only where the mapping is the requirement
  (`variant="primary"` → the primary class), and pair it with a static read of
  the `.module.css` that the rule is there.
- Import the component, never its CSS file, so a missing stylesheet shows up
  as the component's failure. No snapshot tests, of markup or of CSS.
- You cannot open a browser. If a criterion needs one, say so in your final
  message; never claim it was checked.

## Talking to the backend

- Base URL is `VITE_API_BASE_URL` (`/api`). The dev proxy and CloudFront both
  forward `/api` with the prefix stripped, so no CORS exists and none should be
  added.
- The SPA sends the Cognito **ID token** as `Authorization: Bearer`; the
  backend rejects access tokens. A token is a secret: never log, render or put
  one in an error message. Never commit or hardcode a pool or client id.
- After sign-in, `GET /users/me` returning **404 is not an error**: the
  account has no profile yet, and the app routes to profile creation.
- Every `VITE_*` read lives in `src/config.ts`, which throws at load on a
  missing value. No other file reads the Vite env object.

## Traps

- `dangerouslySetInnerHTML` on user content is forbidden, no exceptions.
- `frontend/package.json` is not writable by the code agent. A missing
  dependency is a reason to stop and report.
- `frontend/dist/` is gitignored and must stay that way.
