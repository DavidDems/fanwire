---
type: reference
---

# FrontendUI — verification

**Agent-facing.** What a styling unit's tests can honestly assert and how a
unit fails first. What only a browser can show, and how it is reported, is
[`verification-browser.md`](verification-browser.md). Hand this file to every
styling unit's test agent.

## 1. What jsdom does with this styling (measured 2026-10-06)

A throwaway spike, not committed, ran a CSS Module and a global stylesheet
through this repo's own Vitest 3.2 config:

| Question | Answer |
|---|---|
| Does `import styles from "./x.module.css"` work? | **Yes.** `styles.card` is a stable hashed name (`_card_882842`), and it is what lands in `className` |
| Is any CSS applied? | **No.** `getComputedStyle(el).color` is `canvastext`, padding is empty, `document.styleSheets.length` is 0, and custom properties on `:root` read as empty |
| Do media queries, layout, focus rings or hover apply? | **No.** jsdom has no layout engine |
| Do CSS and SVG imports typecheck? | **Yes.** `tsc -b` passes with no `vite-env.d.ts`; `vitest/globals` pulls in Vite's client types |

**On Vitest 4, a CSS Module import is a proxy:** `styles.primary` is `_primary_<hash>`, but so is
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
  minimum, **unrounded**, in both themes (A1). Assert no banned pair from `tokens.md`
  §6 (A4). Assert every semantic token has a dark value (A18). Mutation check: set
  `--color-link` dark to `#1f7a8c`, and the test must fail.
- **Tree scans see test files too.** `src/styles/base.test.ts` (no
  `@keyframes` anywhere), `test/env-usage.test.ts` and
  `auth/sdk-isolation.test.ts` read **every** file under `src/`, test files
  included. A test that writes the forbidden text literally, even in a regex,
  a comment or a test name, fails the scan. Assemble needles from fragments
  (`["@", "key", "frames"].join("")`), as those three files do.
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
  `aria-pressed` on the post card's Like
  and Repost, `data-active` on Unfollow,
  `aria-invalid` on a failed field (A7);
- text that replaces colour: the Live badge contains "Live"; game-state
  mapping (`components-sports.md` §4) for each code, including "an unknown code is
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
file (`wiki/GeneralContext/Architecture/director-sessions.md`, loop step 3).

## Parts

- [`verification-browser.md`](verification-browser.md): §3 and §3a, what needs a browser: the Playwright MCP checks, the per-unit checklist and the gates.

Section numbers carry over, so a `verification.md` §3 or §3a citation
elsewhere is found through these headings:

### 3. What needs a browser (B)

[`verification-browser.md`](verification-browser.md) §3.

### 3a. Agent-driven checks: Playwright MCP

[`verification-browser.md`](verification-browser.md) §3a.
