# FRONTEND-049: track 2's clean-up

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

Track 2, unit 4 (`wiki/GeneralContext/Prompts/31-outstanding-work-2-dependencies.md`,
ADR 0036): every dual-version unit is followed by one that removes the old version's
support. msw 3 (#31), jsdom 31 (#29), vite 8 (#35) and React 19 (#40) are all on `main`.

## What this spec PR already did (Director)

- **The fold.** Measured on `main` 66fbb9b with the budget test's own build: the entry is
  172,748 gzip / 554,736 raw over nine chunks, CSS 7,341 unchanged, largest file 416,514
  raw. Every lazy output moved by at most +108 B (`ComposePage`, FRONTEND-047's
  `useAttachments`) and most by about +30 (React 19's runtime helpers). `BASE` holds
  those numbers, `bundle-budgets/FRONTEND-047.ts` is deleted (the folder is now empty;
  the glob reads none), and `ENTRY_JS_RAW_HARD_MAX` is 560,300: the measured entry plus
  1%, rounded up to 100 B (ADR 0041, "The fold resets the cap").
- **vite.config.ts.** `optimizeDeps.esbuildOptions.define` became
  `optimizeDeps.rolldownOptions.transform.define`. Vite 8 maps the first to the second
  itself (`vite/dist/node/chunks/node.js`, the deprecation branch) and warns. Proof on a
  forced dev pre-bundle: with the define, `amazon-cognito-identity-js`'s pre-bundle has no
  bare `global.`; with an empty define, it has `global.TYPED` and `global.crypto`. No
  warning in the dev log. `vite.config.ts` is no role's to write, so it is here.

## The unit

- **Red first:** flip `harness.test.ts`'s two dual-version pins (msw's option, the
  `_bytes`/`_buffer` pair) to the new-version-only form. They fail today.
- **msw:** `server.listen({ onUnhandledFrame: "error" })`. msw 3's types know the key,
  so the variable that hid it from msw 2's types goes too.
- **jsdom:** one path to the bytes. The fake `{ [Symbol("impl")]: … }` objects in the
  pins only worked through the Symbol fallback; test with a real `Blob` instead, and
  with a plain object for the throw.
- **dev-server-config.test.ts:** it finds `define` anywhere inside `optimizeDeps`
  today, so it is green on the new config already; tighten it to the Rolldown path and
  to no `esbuildOptions`. Green on arrival is fine here: the red baseline is the harness.
- **AccountSettings race:** `await screen.findByRole("button", { name: "Account menu" })`
  before the listener goes on. That is the whole fix; don't widen the window or filter
  requests.

## Traps

- **Roles.** `setupTests.ts` is outside `src/test/**` and is not a test file, so its
  commit is `code_agent`'s. `form-data-file-names.ts` is under `src/test/**`, so its
  implementation commit is a test-role commit (FRONTEND-045's lesson). Guard-check each
  commit by its role, from the unit's own worktree.
- **Rebuild the test image** before the container run (`docker compose run` reuses it).
- Run the frontend suite alone and in the foreground.
