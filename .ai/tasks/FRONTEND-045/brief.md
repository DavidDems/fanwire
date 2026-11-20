# FRONTEND-045: test harness on both versions

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

Track 2, unit 1 (`wiki/GeneralContext/Prompts/31-outstanding-work-2-dependencies.md`,
[ADR 0036](../../../wiki/GeneralContext/Decisions/0036-dependency-majors-route.md)).
Four majors are held on the Dependency Dashboard because the suite fails on them:
`@types/node` 26, `vitest` 5, `jsdom` 31 and `msw` 3. This unit makes the
code work on both the old and new versions. After it merges, the human ticks the four
majors and Renovate's PRs merge unchanged. `FRONTEND-048` later removes the
old-version paths.

## What the probe found (2026-11-20, from `main` at `02b36b6`)

All four installed together, suite run alone in three shards: 3,671 tests, **118 failed**.
Typecheck had 2 errors.

| Cause | Failures | Fix |
|---|---|---|
| jsdom 31's default stylesheet hides `[popover]:not(:popover-open)`; jsdom has no `showPopover()` | ~70: every `role="menu"` query (Menu, post menus, account menu, search menu, sidebar, delete focus) | Test-only author rule `[popover]{display:block}` in `setupTests.ts`. Author rules beat UA rules whatever their specificity. |
| jsdom 31 keeps Blob bytes in a private `#impl` and renames `_buffer` → `_bytes` | ~30: image-check, MediaWidget, ComposePage, compose-style, rate-limit, harness | Read the bytes the way Vitest 5 does (`node_modules/vitest/dist/chunks/index.*.js`, `createBlobImplGetter`). |
| jsdom 31 drops the leading space inside the hidden span: the link is named "Postabout …" | 12: games and players post-about, post-about-overlay | `Post{" "}` outside `VisuallyHidden`. |
| msw 3 drops `onUnhandledRequest` for `onUnhandledFrame` | typecheck, plus warn-instead-of-fail | One options object carrying both. |
| `Uint8Array<ArrayBufferLike>` is not a `BlobPart` under `@types/node` 26 | typecheck | `Uint8Array<ArrayBuffer>`. |
| msw 3 only, cause unknown | 1: `deactivated.test.tsx` "the route the viewer was on renders" | Diagnose. |

With the first five applied in the probe, the 21 failing files reran with **1 failure in
314 tests**: the `deactivated` one, which fails 3 runs out of 3 inside its file, passes
alone, and passes on msw 2. Recover account stays disabled, so the recover request is
probably never answered. Look at what the previous tests leave behind (the
`holdRecover` gate in `src/test/account.ts`, a pending request, the handler order after
`server.resetHandlers()`), not at the test's own assertions.

Vitest 5's jsdom bridge still appends every file as a bare `Blob`, so
`form-data-file-names.ts` is still needed. It only needs the new way to read bytes.

## Traps

- The 8 GB machine reaps background jobs. Run the suite in the foreground, alone, and
  shard it (`--shard=1/3 --maxWorkers=2`) for the new-version run.
- `npm install` of `msw@3` writes a lockfile that needs npm 11. That doesn't matter for
  the probe worktree, which is never committed.
- `PlayerPage.tsx` and `BoxScore.tsx` are in `features/`, not `components/`. Touch only
  the two `Post` lines.
