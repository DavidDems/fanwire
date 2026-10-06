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

- **Token contrast (`UI-01`, `src/styles/tokens.test.ts`).** Parse
  `src/styles/tokens.css` (custom properties on `:root`, and again inside the
  `prefers-color-scheme: dark` block; a small regex parser, no dependency).
  Resolve `var()` references. Compute WCAG 2.1 contrast in TypeScript, the same
  formula as `tokens-check.md`. Assert every pair in `tokens.md` §5 meets its
  minimum, **unrounded**, in both themes (A1). Assert no banned pair from §6
  (A4). Assert every semantic token has a dark value (A18). Mutation check: set
  `--color-link` dark to `#1f7a8c`, and the test must fail.
- **No raw values in modules (every unit).** For every `*.module.css` under the
  unit's folder: no `#hex`, `rgb(`, `hsl(` or named colour; no `px` font sizes;
  no `outline: none` / `outline: 0` without a `:focus-visible` rule in the same
  file (A2, A3, A9).
- **Reduced motion (`UI-01`).** `base.css` contains a `prefers-reduced-motion`
  block setting both duration tokens to `0ms`, and no `@keyframes` exists
  anywhere in `src/` (A8).
- **Brand files (`UI-02`).** Files exist under `frontend/public/` and
  `frontend/src/assets/brand/`. Each PNG's IHDR width and height (bytes 16–23)
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
  "Primary"; the brand link named `fanwire`; the skip link first in the tab
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
is itself the contract (`variant="primary"` → the primary class). **Don't use
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
