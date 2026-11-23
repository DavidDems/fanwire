---
type: reference
---

# 0x08a — Frontend: shell, look and feel, build and test harness

**Agent-facing.** Part of [[0x08-frontend]] (index, cross-cutting contracts).

## Look and feel

**Planned in [`wiki/CodeContext/FrontendUI/`](../FrontendUI/index.md)** (2026-10-06).
`src/styles/tokens.css` and `base.css` (`UI-001`) are imported once from
`main.tsx`; `src/styles/tokens.test.ts` recomputes every contrast pair from the
file, unrounded. The rest: CSS Modules plus one global token stylesheet, the system font
stack, and a Director PR (`D1`, `index.html` and the brand files) followed by
eight styling units. The `0x08` files stay the
record of what the frontend *does*; how it looks is recorded there, not here. A
styling unit that changes behaviour (for example "No replies yet.") records
that here as usual.

### Soft-filled controls and the shared primitives (`UI-010`)

- **Every text-like `input`, `select` and `textarea` is soft filled, from
  `base.css` alone.** No border; the `--color-field` fill; `--radius-lg`
  (12 px); 48 px tall when single-line. No feature CSS changed: every form
  takes the style through the element rule, as before. The fill is under
  3:1 against the page and the card in both themes, so a 1 px
  `--color-border-strong` bottom rule (an inset `box-shadow`) is drawn in
  every state (WCAG 1.4.11, `tokens.test.ts` measures it).
- **Focus moves nothing.** `:focus` only changes the fill to
  `--color-field-focus`; the ring is still the global `:focus-visible`
  outline. No focus rule sets a border, padding or size (`base.test.ts`).
- **Invalid is a ring, not a border.** The controls' `[aria-invalid="true"]`
  adds a 2 px `--color-danger` shadow ring beside the bottom rule. The old
  bare `[aria-invalid] { border-color }` is gone, so a checkbox marked invalid
  gets nothing from it. The field's message (`Field`) is unchanged.
- **Forced colors (`accessibility.md` A20).** Shadows are dropped there, so
  under `@media (forced-colors: active)` the bottom rule is a real border, the
  invalid ring an outline (focus still wins), `SegmentedTabs`' selected tab is
  underlined and `FloatingButton` has a 2 px edge (`styles/forced-colors.test.ts`).
- **No CSS file has `url(` or `@import`**, so styling makes no request; the
  select's chevron is two `linear-gradient`s (`base.test.ts`). The
  placeholder is `--color-text-muted` at full opacity, the colour the
  contrast test measures.
- **`SearchInput`** wraps `Field` and an `input type="search"` with a leading
  `aria-hidden` `SearchIcon`. `SearchBar` uses it: the label, `name="q"`, the
  100 cap and `role="search"` are unchanged. Its text-padding rule is two
  classes deep because `base.css` loads after module CSS in the build.
- **`SegmentedTabs`** is an in-page ARIA `tablist` (automatic activation,
  roving tab stop, ids from `useId`). `Tabs` stays the route tabs.
  **`FloatingButton`** is the 56 px fixed action, a `Link` or a button,
  with a required `aria-label`. Both have callers: `SegmentedTabs` in the
  stats navigator, Records, the game page, history and the stats picker;
  `FloatingButton` is compose's + in `AppLayout`.
- **No runtime styling work** in the three primitives or `FormField`: no
  listeners, observers, `matchMedia`, `requestAnimationFrame` or
  `useLayoutEffect` (`components/ui/ui-css.test.ts`).
- **The bundle has a budget test**, `src/test/bundle-budget.test.ts`. It
  runs Vite's `build()` in vitest and pins the entry JS (`BASE` in
  `src/test/bundle-budget.ts`: 172.7 kB gzip, 554.7 kB raw on vite 8 and
  React 19, never past `ENTRY_JS_RAW_HARD_MAX`, 560.3 kB raw), the entry CSS (7.34 kB gzip, `index.css` plus
  `InlineAlert.css`), every other chunk to within
  0.1 kB of its recorded size (and no new one), and no file of 500,000 bytes.
  **The entry is the entry chunk plus every chunk it imports statically**
  (`entryClosure`, FRONTEND-046): Rolldown (vite 8) splits the entry into
  chunks `index.html` preloads, so they are summed as the entry, never named
  as lazy outputs; on vite 7 it is the entry chunk alone. **A unit that adds
  or grows a lazy chunk declares it in `src/test/bundle-budgets/<UNIT>.ts`,
  in its test commit, with the reason** (brief 20, R1, R12). A unit grows
  the entry by at most 1 kB gzip, **except a dependency major**: a unit file
  that names the major and its decision (`dependencyMajor`, "ADR NNNN") may
  declare more, and its raw growth lifts the raw cap by as much
  (FRONTEND-047). React 19 was the first (+23.4 kB gzip, all `react-dom` 19's);
  its fold reset the cap from 480 kB to the measured entry plus 1% (ADR 0041). `/search` stays in the
  entry: `SearchPage` shares its code with the home page's search rail, and
  lazy-loading it made the entry larger.
- **The react-hooks 7 rules hold on React 18 and 19** (FRONTEND-047): no ref
  read or written while rendering, no module variable reassigned, no
  synchronous `setState` in an effect body. A reset on a prop change keeps the
  previous value in state and sets during render (`AuthProvider`'s service,
  `MediaWidget`'s reset count, `AppLayout`'s finishing deletion), and a ref
  the effects read is kept current by an effect (`useCardReady`). No
  `eslint-disable` for a react-hooks rule.

### Team icons (`FRONTEND-031`)

- **`components/ui/TeamIcon`** takes `abbreviation` (the stored one, BOS),
  `size` (`sm` 32 px, `lg` 64 px) and an optional `label`: with it the icon is
  `role="img"` named by it, without it `aria-hidden` (the team is adjacent
  text). It draws the abbreviation in black on the inner colour inside the
  outer ring, text and CSS only. An unknown or null abbreviation gets the
  neutral form, no team colours.
- **`lib/teamColors.ts`** is the data: `INNER_COLORS` (8) and `OUTER_COLORS`
  (5) as ordered `{key, name}` lists, `TEAM_COLORS` (one pair per team) and
  `teamColors()` (the pair, or null). Keys name the `--team-inner-*` /
  `--team-outer-*` tokens in `tokens.css`, fixed across themes. `USERS-005`'s
  avatar picker reads the two lists, so they stay exported and in order.
- **Where:** standings (`SeasonLevel`), `TeamLevel` and the team level's
  heading in `StatsNavigator`, `TeamSearch`, the `GamePage` header,
  `BoxScore` headings, team records only in `RecordLevel`/`RecordsLevel`,
  the feed's `GamePreview` and `PlayerGamePreview`, `StatsPicker` rows,
  `RecentGames` cards, and
  `PlayerPage`'s "Team" fact (the last team of the newest season line).
  Dense opponent cells stay text. Nothing reads `TeamOut.logo_url`.

## Build facts the frontend depends on

None lives in `frontend/`:

- **CI enforces the contract.** The `openapi-drift` job in
  `.github/workflows/test-agent.yml` regenerates `backend/openapi.json`, then
  regenerates `src/api/schema.d.ts` from that fresh export, and fails if either
  committed file differs. It runs on any backend or frontend change and is part
  of the required `gate` check. A unit that changes a route must commit both
  regenerated files.

- **`backend/openapi.json` is pinned to LF** in `.gitattributes`. It is compared
  byte-for-byte against a fresh export, and `core.autocrlf=true` on Windows
  checked it out as CRLF — 2429 carriage returns, the drift gate red on a clean
  clone where nothing was wrong.
- **`docker/backend.Dockerfile`'s `test` stage copies `scripts/` and the
  committed schema.** Without them that suite passes locally and fails in CI,
  reporting a missing file rather than the missing `COPY`. The `jso[n]` glob is
  deliberate — see the comment there.

## Test harness facts

These exist so a test can use an ordinary static `import` of the thing it tests,
and an ordinary `FormData` to upload a file. Each was found by a test that passed
locally and could not pass in `frontend-test`, which is the same shape as the two
build facts above. `src/test/harness.test.ts` pins them, so none is a rule
anybody has to remember:

- **`vite.config.ts`'s `test.env` supplies all five `VITE_*` values.**
  `config.ts` throws at module load on a missing one, and `.dockerignore`
  excludes `**/.env.*` — so the container and CI have no env file, while a
  developer's machine has `.env.local` and hides the failure. `test.env` also
  outranks `.env.local` (`.env.[mode]` beats `.env.local`), so a test run reads
  the same fake pool id everywhere and the real dev pool is never reachable
  from a test.
- **`setupTests.ts` calls `server.listen()` at module scope, not in
  `beforeAll`.** `openapi-fetch`'s `createClient` captures `globalThis.fetch`
  when it is constructed, and `api/client.ts` constructs `apiClient` at module
  load. A setup file's `beforeAll` runs *after* the test file's whole import
  graph, so listening from a hook left every statically imported `apiClient`
  holding the unpatched fetch: its requests left for the real network and
  failed as `ECONNREFUSED`, with nothing pointing at msw.
- **`setupTests.ts` gives jsdom's `Blob` the readers it does not implement** —
  `arrayBuffer()`, `text()` and `stream()`, built on the `FileReader` jsdom does
  provide, and installed only when absent so a future jsdom wins over the patch.
  jsdom stops at `slice`, `size` and `type`, and every path that serializes a
  body containing a file reaches for one of the three — so without them a
  `FormData` carrying a `File` cannot be sent from a test and a handler cannot
  read one back. **It has to live in the setup file**: the body is serialized by
  the runtime, long after any per-test setup, so no fixture can reach it, which
  is why `FRONTEND-004` could not fix it from inside its own permitted paths.
  On a developer's Node
  22 the failure survives; on the Node 20 in `docker/frontend.Dockerfile` and CI it throws
  `AssertionError [ERR_ASSERTION]: false == true` from inside msw's handler
  lookup, so the test fails as an empty recording, points nowhere near the cause,
  and does so only in the container. Neither the multipart encoding nor Node 20
  is at fault — that same body parses under both versions with plain undici; it
  is the jsdom interaction.
  `MediaWidget` builds an ordinary
  `FormData` and `src/test/compose.ts` reads it back with `request.formData()`.
  An upload is written the plain way here.
- **`src/test/form-data-file-names.ts` keeps a file's name across Vitest 4's
  jsdom/Node bridge**. Under Vitest 4, `FormData`, `File` and `Blob`
  are jsdom's while `Request` and `fetch` are Node's, and Vitest converts a
  jsdom `FormData` into a Node one by appending each file as a bare `Blob`, so
  every upload reached msw named `blob`. The module wraps the global `Request`
  and does the conversion itself, names included; `setupTests.ts` imports it
  **before** msw, which builds its `Request` from the global. It reads the
  bytes the way Vitest's own bridge does, because a request body is built
  synchronously: jsdom 31 keeps them as `_bytes` behind a private field that
  only its generated `implForWrapper` reaches, and jsdom 25 as `_buffer` under
  an own `Symbol("impl")`. `bytesOf` tries both (`FRONTEND-045`, until
  `FRONTEND-048` drops jsdom 25's). `harness.test.ts` and
  `MediaWidget.test.tsx` pin it. Vitest 5 has the
  same bridge, so this stays until upstream keeps file names.
- **The harness carries three things for Node 24 and later** (`FRONTEND-025`).
  undici 7 builds each multipart part with the global `File`, jsdom's, then
  asserts `instanceof` against the `File` it loaded with, Node's, so
  `setupTests.ts` makes jsdom's `Blob.prototype` inherit from Node's
  `File.prototype`. That is after the reader shims, or Node's readers look
  present and the shims stand down, and only when `globalThis.jsdom` is defined,
  because under `@vitest-environment node` the chain would be a cycle. undici
  also rewraps a part given a filename or a bare `Blob` through that same global,
  which turns the body into the 13 bytes of `[object File]`, so
  `form-data-file-names.ts` always appends an already named Node `File` with no
  third argument. Node 26 defines a global `localStorage` that is `undefined`
  without `--localstorage-file`, and Vitest copies a jsdom key only when the
  global lacks it, so `setupTests.ts` copies jsdom's storage over a global that is
  `undefined`. Node 20 rejects that flag, so it cannot be the fix.
- **`setupTests.ts` passes msw both versions' unhandled-request key**
  (`FRONTEND-045`). msw 2 reads `onUnhandledRequest`, msw 3 `onUnhandledFrame`,
  and each ignores the other's, so one options object, held in a variable so
  neither version's types reject the key they lack, carries both as `"error"`.
  `FRONTEND-048` drops msw 2's.
- **A test-only author rule, `[popover] { display: block }`**, is appended to
  the document by `setupTests.ts` (`FRONTEND-045`). jsdom 31's default
  stylesheet hides `[popover]:not(:popover-open)`, and jsdom implements no
  `showPopover()`, so an open `Menu` list was missing from every role query.
  An author rule outranks a user-agent one whatever its specificity. The
  browser opens the popover for real; no production CSS changes.
- **A test that holds an element across a re-mount reads a detached copy.**
  Recovering on `/compose` inside `ComposeModal`'s 500 ms grace unmounts the
  dialog until the composer's chunk arrives, so `deactivated.test.tsx` finds
  the Compose dialog *after* recovery. It surfaced on msw 3, where a warm
  earlier test makes the recovery land at about 90 ms.
- **`tsconfig.app.json` lists `vite/client` and `node` in `types` explicitly.**
  Vitest 4's `vitest/globals` does not pull them in, and without them the
  disk-reading tests (`node:fs`, `process.cwd()`) and CSS/SVG imports do not
  type-check.
