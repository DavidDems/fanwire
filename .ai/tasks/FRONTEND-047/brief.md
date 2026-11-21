# FRONTEND-047: React 19 ready

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

Track 2, unit 3 (`wiki/GeneralContext/Prompts/31-outstanding-work-2-dependencies.md`,
ADR 0036, ADR 0041). Renovate's `react monorepo` major (`react`, `react-dom`,
`@types/react`, `@types/react-dom`, `eslint-plugin-react-hooks` 7) and `eslint` 10
(`eslint`, `@eslint/js`, which waits on react-hooks 7) are held on the Dependency
Dashboard. This unit makes the frontend pass on both versions. After it merges, the human
ticks React, merges its PR, then ticks `eslint` 10.

ADR 0041 (the human's decision, 2026-11-21), in short: React 19's entry growth is all
`react-dom` 19's client build. The unit takes the cheap trim, then declares the remaining
growth as a dependency major. Only a unit file that names the major and the ADR may grow
the entry past 1 kB gzip, and its raw growth lifts the 480 kB raw cap by the same amount.
The growth declared is the measured new entry minus `BASE`, plus at most 1%. Every other
rule stays strict. Folding this unit later resets `ENTRY_JS_RAW_HARD_MAX` to the measured
React 19 entry plus about 1%.

## What the probe found (2026-11-21, `main` at `a777aae`)

React 19.3.1, react-dom 19.3.1, `@types/react` 19.3.0, react-hooks 7.1.1; then eslint
10.15.0 and `@eslint/js` 10.0.1 on top.

- **Typecheck and build:** clean on both.
- **Lint:** 16 errors, all react-hooks 7, the same with eslint 10. eslint 10 adds nothing.

  | Rule | Sites |
  |---|---|
  | `refs` (10) | `features/compose/AttachmentPicker.tsx` 53 ×2, 54, 55, 56 ×2, 85 ×2; `features/feed/useCardReady.ts` 143; `components/stats-nav/StatsNavigator.tsx` 201 |
  | `set-state-in-effect` (3) | `auth/AuthContext.tsx` 58; `features/compose/MediaWidget.tsx` 174; `routes/AppLayout.tsx` 199 |
  | `immutability` (1) | `components/stats-nav/TeamLevel.tsx` 271 (`wins += 1`) |
  | `globals` (2) | `auth/AuthContext.test.tsx` 36; `test/render.test.tsx` 35 (tests capturing render values in a module variable) |

- **Suite** (3 shards): 213 files / 3,683 tests, 2 failed, both in `bundle-budget.test.ts`.
  The extra `GET /users/me` in `AccountSettings.test.tsx` that the 2026-11-18 probe saw is
  gone; don't chase it.
- **Entry closure:** 9 chunks (`index`, `rolldown-runtime`, `react`, `client`,
  `chunk-6KYCQHYJ`, `jsx-runtime`, `InlineAlert`, `useBaseQuery`, `useQuery`), **172,561
  gzip / 554,083 raw**, against `BASE`'s 149,210 / 474,565. The largest file is `index`,
  416,205 raw, under the 500,000 per-file limit.
- **Lazy outputs:** none moves past ±100 B against this `BASE` (largest: `RecordsTab`
  +38). Entry CSS unchanged.

## The trim

`routes.tsx` imports `SearchPage`, `ThreadModal`, `DetailModal` and `ComposeModal`
eagerly. Only `/search` is off the home path. The thread modals open from feed posts, and
`ComposeModal` already lazy-loads the composer inside its dialog. `date-fns` (feed
`PostNode`), Cognito and the `buffer` polyfill stay: that trimming belongs to the frontend
track (backlog row on the entry limit). So the trim is `SearchPage`, lazy like the other
page routes (the named-export adapter in `routes.tsx`), kept only if it saves at least
1 kB gzip on React 19. `SearchRail` lives in the layout, so part of search stays in the
entry either way. Existing `/search` tests must still pass, so any that query
synchronously after navigating become `findBy` in the test commit.

## Traps

- **Both versions, one code.** No React 19-only API: no `useEffectEvent`, `use`, ref as a
  prop, or `<Context>` as provider. The usual fixes: compute derived values during render
  instead of effect-plus-setState; reset on a prop change with the "store the previous
  value in state" pattern or a `key`; move ref writes into effects or handlers; keep a
  mutable counter out of render (`reduce`).
- **`AttachmentPicker`'s ref block (53–56)** resets on `mediator`/`key` change during
  render. A `key` on the component from its parent, or previous-value state, keeps the
  behaviour. Pin the reset with a test first.
- **`useCardReady`** writes `settledRef.current` during render so a callback sees the
  latest value. Move it into a layout effect, and check the callback's timing with a test.
- **Test files are frozen after the test commit.** The two `globals` fixes and every new
  or changed test go in the test commit.
- **The red test commit** includes `FRONTEND-047.ts`, which `combine` rejects today.
  That makes every build assertion red, which is the intended baseline. Measure the trimmed
  React 19 entry before writing its numbers: implement the trim in a scratch worktree,
  measure, then write the test commit.
- Production files are implementation commits (`code_agent`), tests and `src/test/**`
  are test-role (`test_agent`), the module references are `context_maintainer`.
  Guard-check each commit by role.
- Run suites alone and in the foreground; shard the new-version run (`--shard=1/3
  --maxWorkers=2`).
