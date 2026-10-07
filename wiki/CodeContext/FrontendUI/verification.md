# FrontendUI — verification

**Agent-facing.** What a styling unit's tests can honestly assert, what only a
browser can show, and how each is reported. Hand this file to every styling
unit's test agent.

## 1. What jsdom does with this styling (measured 2026-10-06)

A throwaway spike, not committed, ran a CSS Module and a global stylesheet
through this repo's own Vitest 3.2 config:

| Question | Answer |
|---|---|
| Does `import styles from "./x.module.css"` work? | **Yes.** `styles.card` is a stable hashed name (`_card_882842`), and it is what lands in `className` |
| Is any CSS applied? | **No.** `getComputedStyle(el).color` is `canvastext`, padding is empty, `document.styleSheets.length` is 0, and custom properties on `:root` read as empty |
| Do media queries, layout, focus rings or hover apply? | **No.** jsdom has no layout engine |
| Do CSS and SVG imports typecheck? | **Yes.** `tsc -b` passes with no `vite-env.d.ts`; `vitest/globals` pulls in Vite's client types |

**Re-measured on Vitest 4 (2026-10-06, after `#96` upgraded it).** A CSS
Module import is now a proxy: `styles.primary` is `_primary_<hash>`, but so is
`styles.doesNotExist`, which returns `_doesNotExist_<hash>` for a class no
rule defines. So `toHaveClass(styles.x)` proves the component *applies* the
name `x`. It doesn't prove `.x` exists in the CSS. Pair every class assertion
with a static read of the `.module.css` file that the rule is there
(`src/test/module-css.ts` has the readers).

`vite.config.ts` is forbidden to workers, so `test.css` stays off. Don't try to
make jsdom compute styles: it can't do layout even if CSS were processed.

**So a vitest test can never prove that something looks right.** It can prove
three kinds of thing, and a styling unit's acceptance criteria are written so
that each one is one of them:

## 2. What tests assert

### 2a. Static tests over the source files (S)

These read files from disk with `node:fs`, the way `auth/sdk-isolation.test.ts`
and `features/feed/feed-isolation.test.ts` already do (locate `src` from
`process.cwd()`, which works in both the repo and the container). They are
the strongest checks available, because they test the CSS itself.

- **Token contrast (`UI-001`, `src/styles/tokens.test.ts`).** Parse
  `src/styles/tokens.css` (custom properties on `:root`, and again inside the
  `prefers-color-scheme: dark` block; a small regex parser, no dependency).
  Resolve `var()` references. Compute WCAG 2.1 contrast in TypeScript, the same
  formula as `tokens-check.md`. Assert every pair in `tokens.md` §5 meets its
  minimum, **unrounded**, in both themes (A1). Assert no banned pair from §6
  (A4). Assert every semantic token has a dark value (A18). Mutation check: set
  `--color-link` dark to `#1f7a8c`, and the test must fail.
- **Tree scans see test files too.** `src/styles/base.test.ts` (no
  `@keyframes` anywhere), `test/env-usage.test.ts` and
  `auth/sdk-isolation.test.ts` read **every** file under `src/`, test files
  included. A test that writes the forbidden text literally, even in a regex,
  a comment or a test name, fails the scan. Assemble needles from fragments
  (`["@", "key", "frames"].join("")`), as those three files do. This broke
  `UI-002`'s PR once `UI-001` merged.
- **No raw values in modules (every unit).** Reuse `moduleCssViolations` from
  `src/test/module-css.ts` (`UI-003`) instead of writing another scanner. For
  every `*.module.css` under the unit's folder: no `#hex`, `rgb(`, `hsl(` or named colour; no `px` font sizes;
  no `outline: none` / `outline: 0` without a `:focus-visible` rule in the same
  file (A2, A3, A9).
- **Reduced motion (`UI-001`).** `base.css` contains a `prefers-reduced-motion`
  block setting both duration tokens to `0ms`, and no `@keyframes` exists
  anywhere in `src/` (A8).
- **Brand files (`D1`, `UI-003`).** Files exist under `frontend/public/` (`D1`) and
  `frontend/src/assets/brand/` (`UI-003`). Each PNG's IHDR width and height (bytes 16–23)
  match `branding.md` §8. `manifest.webmanifest` parses as JSON with
  `name: "fanwire"` and the three icons with their `purpose`. **The container
  has no `brand/` folder** (`docker/frontend.Dockerfile` copies `frontend/`
  only), so a test that compares against `brand/out/` passes locally and fails
  in CI. Assert sizes and content, not equality with the source.
- **`index.html` (Director PR `D1`).** Parse `frontend/index.html` with jsdom's
  `DOMParser`. Assert the `<link rel="icon">` pair (SVG and `.ico`),
  `apple-touch-icon`, `manifest`, `theme-color` (two, by `media`),
  `color-scheme`, and the Open Graph tags, with `og:image` exactly
  `https://fanwire.daviddems.com/og-image.png`. Assert it **starts with
  `https://`**, so a relative URL fails.

### 2b. Behaviour and semantics in jsdom (T)

The existing kind of test, now also covering what styling adds to the DOM:

- roles, landmarks and names: one `main`, one `banner`, one `navigation`
  "Primary". **Testing Library gives every `<header>` the banner role**,
  including the ones inside `ProfileSummary` and `PostNode`, so
  `getByRole("banner")` throws on a profile or feed page. Count only headers
  outside `main`/`article`/`section`, as `routes/AppLayout.test.tsx` does, or
  scope with `within(...)`; the brand link named `fanwire`; the skip link first in the tab
  order and moving focus to `main` (A11–A13);
- attributes that carry state: `aria-current="page"` on the current nav link,
  `aria-expanded` on Show replies, `data-active` on Unlike/Unfollow,
  `aria-invalid` on a failed field (A7);
- text that replaces colour: the Live badge contains "Live"; game-state
  mapping (`components.md` §4) for each code, including "an unknown code is
  shown as given and is not Live";
- `alt` values (A19) and `aria-hidden` on icons (A14).

### 2c. Class presence: only where the class *is* the requirement

Assert a class only through the module's own export, never a literal:
`expect(button).toHaveClass(buttonStyles.primary)`. Use it for a mapping that
is itself the contract (`variant="primary"` → the primary class), and pair it
with the static check §1 requires. **Don't use
it as a proxy for "it looks right"**: a test that a card has `styles.card`
passes on an empty `.card {}` rule.

### Snapshots: none (decided)

No snapshot tests, of markup or of CSS. A snapshot pins every attribute at
once, churns on each styling change, and gets re-accepted rather than read,
which is the opposite of a failing-first contract. The suite has none today
(`grep toMatchSnapshot` is empty). A reviewer can read a `*.module.css` diff
directly; that is what CSS Modules buy.

### How a styling unit fails first

Each criterion is written so its test is red before the implementation:

- static tests are red because the file or rule doesn't exist yet;
- semantic tests are red because the attribute or element isn't rendered yet
  (`aria-current`, the skip link, the Live word, "No replies yet.");
- a test of a **new** component (`Button`, `GameScore`) is red because the
  import doesn't resolve. That's this repo's usual red for an entity that
  doesn't exist yet, and it's the right reason;
- a test that **restyles an existing** component is red because the class or
  attribute isn't applied. Have the test agent import the component, never the
  CSS file directly, so a missing stylesheet shows up as the component's
  failure.

Either way, check that the red is red for the right reason and not a broken test
file (`00-session-protocol.md` step 3).

## 3. What needs a browser (B)

`human-decisions.md` §3 stands: **browser verification is reported as NOT DONE
unless a tool or a human really drove the app.** A unit's PR never says "looks
good" on the strength of passing tests.

**Where:** `npm run dev` in `frontend/` against `backend-dev` (`AGENTS.md`
"Build / test / run"), or the live site after the deploy. Seed data:
`docker compose exec backend-dev python scripts/seed_dev.py`.

### 3a. Agent-driven checks: Playwright MCP

Installed by the human on 2026-10-06 as a local Claude Code MCP server
(`claude mcp add playwright -- npx @playwright/mcp@latest`). It isn't a repo
dependency and isn't in CI. It is available to a hand-run Director session
(prompts `13`+). Dispatched workers don't have it. A row it really checked counts as
done: report it as "✅ Playwright MCP, Chromium, <date>" with what was measured.

- **What it can drive:** viewport size (`browser_resize`: 360 and 1280 wide),
  light and dark mode, forced colours and reduced motion
  (`browser_emulate_media`), screenshots, the accessibility tree
  (`browser_snapshot`), and computed styles through `browser_evaluate`. With
  those, an agent can measure a contrast ratio from the computed `color` and
  `background-color`, and check `scrollWidth == clientWidth` for horizontal
  overflow. That is how the native-button contrast defect was found
  (2026-10-06).
- **What to point it at:** a local `npm run build` then
  `npx vite preview --port <n> --strictPort` from the unit's worktree. That's the
  production bundle, which needs `frontend/.env.local` copied into the worktree;
  never commit it. The live site is fine for read-only looks after a deploy.
  Stop the preview server afterwards. On Windows, find it by its command line
  (`Get-CimInstance Win32_Process`) and `Stop-Process` it, because `pkill`
  doesn't work there, and a leftover server locks `esbuild.exe` so its worktree
  can't be removed.
- **Files:** screenshots and snapshots may only be written under the repo root
  (the server's allowed roots), so use `.playwright-mcp/`, which is gitignored.
  Read a screenshot back to look at it.
- **The browser profile persists between sessions and is visible on screen.**
  Whatever the human types into that window, a sign-in included, can still be
  there next time. An agent never submits credentials it was not given, and
  never acts on the live site as a signed-in user.
- **Not covered:** axe, because there is no axe dependency and loading it from a
  CDN would put a third-party script into the check. The axe row stays NOT DONE
  until the human runs the axe browser extension. 
- **Signed-in states** use the two dev-pool test accounts (`fwtest1` and
  `fwtest2`), whose credentials are in the untracked
  `frontend/.env.test-accounts.local`. How to start the stack, recreate their
  profiles after a `docker compose down`, and sign out (there is no sign-out
  button yet) is in `wiki/GeneralContext/Architecture/dev-auth-setup.md`
  "Test accounts". Use them against `npm run dev` with `backend-dev` only,
  never the live site, and sign out at the end, because the browser profile
  persists. Two accounts make "someone else's profile" and following
  checkable.
- **What the checks have taught (`UI-004`, `UI-008`, 2026-10-07).** A newcomer
  signed in on a fresh stack lands on the feed, not `/create-profile` (the
  feed is public): go to `/create-profile` yourself, and expect no "Your
  profile" nav link until the profile exists. `browser_run_code_unsafe` runs
  in a sandbox with no `import`, so it can't read files: read the account file
  with the Read tool and pass the values in. A date input takes three Tab
  stops in Chromium (day, month, year), so a script that reads the outline per
  stop can report a false "no ring"; look at it before calling it a defect.
  The keyboard script's own header links are not "under the header".

**The per-unit checklist.** Every styling unit's PR body carries this table for
the routes it touched, filled in or marked NOT DONE:

| Check | Light | Dark | How |
|---|---|---|---|
| 360 px wide: nothing overflows horizontally; bottom bar doesn't cover content (A9) | | | DevTools device mode |
| 1280 px wide: 640 px column, header nav (layout) | | | |
| Keyboard only: every control reachable, ring visible, never hidden under the header (A3, A5) | | | Tab through |
| 200 % zoom reflows (A9) | | | Ctrl + |
| Reduced motion: nothing moves (A8) | | | OS setting or DevTools rendering emulation |
| Forced colors: focus, button edges and current nav visible (A20) | | n/a | Windows contrast theme or DevTools emulation |
| Targets ≥ 24 px; primary and nav ≥ 44 px (A6) | | | DevTools inspector |
| axe DevTools: 0 serious or critical on the route | | | Browser extension; paste the count |

Each row is ✅, ❌ (with what was seen), or **NOT DONE**, plus who checked it,
in which browser and OS, on which date. Unfilled means NOT DONE.

**Gates, unchanged:** `npm test`, `npm run typecheck`, `npm run lint` and
`npm run build`, then `docker compose run --rm frontend-test`
(`00-session-protocol.md`). A local pass is a hint; the container is the
result.
