# FrontendUI — implementation plan

**Agent-facing, for the session that writes the task specs** (the prompt after
`11`) and for each unit's Director. One Director PR, then eight worker units,
each the size of a `FRONTEND-00N` task. **No `.ai/tasks/` spec exists for any of
them yet.** Writing those is the next prompt's job, after the human approves this
plan.

Each unit lists: objective; acceptance criteria phrased to fail first (the kind
of test each needs is in `verification.md`); an `allowed_paths` sketch; the
FrontendUI files to hand it (never the whole folder, `AGENTS.md` "Context
loading"); and whether a Director PR must land first.

## Order

```
D1 (Director: index.html + public/ brand files)
UI-01 tokens + base ──▶ UI-02 shared components ──▶ UI-03 shell
                                         │
                                         ├──▶ UI-04 auth        ┐
                                         ├──▶ UI-05 feed        │ any order, one at a time
                                         ├──▶ UI-06 compose     │ or in parallel: disjoint
                                         ├──▶ UI-07 notifications│ folders
                                         ├──▶ UI-08 profile     ┘
                                         └──▶ FRONTEND-007 search (uses UI-02)
```

- **D1 can land any time**, independently of UI-01; it has no CSS.
- **UI-03 and `FRONTEND-007` both write `frontend/src/routes/**`.** Never run
  them concurrently: whichever lands second rebases. `FRONTEND-007`'s spec
  should be amended to require `src/components/ui/` and `GameScore` for its
  results. That goes in its own Director PR, merged before the task runs,
  because `agent-guard` reads the spec from the merge ref.
- **What needs a Director PR, and what doesn't.** Workers may write
  `frontend/src/**` and `frontend/public/**`, but never `frontend/index.html`,
  `frontend/package.json`, `vite.config.ts` or `tsconfig*.json` (code-agent
  role in `.ai/policy.json`, plus each spec's `forbidden_paths`). This plan
  adds **no dependency**: CSS Modules are built into Vite, icons are copied
  (`components.md` §3), and there is no font file (`typography.md`). So D1 is
  the only Director PR, and it is there only because of `index.html`.

**A change from the checkpoint, for the human to see.** The checkpoint approved
"one Director PR, then nine worker units", with brand placement as a worker
unit. Writing the plan showed placement can't be split cleanly: the worker can
copy files to `public/` but can't add the `index.html` tags, and every merge to
`main` deploys (`deploy.yml`). Split, there is a window where the live site
links to icons that aren't there, or ships icons nothing links to. So the
`public/` half joins D1, and the two bundled wordmarks and the symbol move into
the shell unit that first imports them. That makes eight worker units.

---

## D1 — Brand files and `index.html` (Director PR)

**Objective:** serve the approved brand exports at fixed URLs, and declare
them, the manifest, the theme colours and the Open Graph card in `index.html`.

Copy from `brand/out/` (`branding.md` §8), unchanged. `favicon.svg` and
`favicon.ico` are the deliberately bolder small-size cut (`branding.md` §7.2),
not a copy of the 512 tile.

| File | Destination |
|---|---|
| `favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `og-image.png` | `frontend/public/` |
| new: `manifest.webmanifest` | `frontend/public/` |

`index.html` head, in addition to what is there:

```html
<meta name="description" content="Talk about the game while it's on.">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#022b3a" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta property="og:type" content="website">
<meta property="og:site_name" content="fanwire">
<meta property="og:title" content="fanwire">
<meta property="og:description" content="Talk about the game while it's on.">
<meta property="og:url" content="https://fanwire.daviddems.com/">
<meta property="og:image" content="https://fanwire.daviddems.com/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="fanwire">
<meta name="twitter:card" content="summary_large_image">
```

The description line is a placeholder for the human to word. `og:title` and
`og:site_name` are lowercase (`decisions.md`). The manifest:

```json
{
  "name": "fanwire", "short_name": "fanwire", "start_url": "/", "display": "standalone",
  "background_color": "#022b3a", "theme_color": "#022b3a",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

**Acceptance criteria (static tests, `src/brand-assets.test.ts`):**
1. Each of the seven files exists under `frontend/public/`.
2. Each PNG's IHDR dimensions are exactly 180×180, 192×192, 512×512, 512×512 and 1200×630.
3. `favicon.ico` holds 16, 32 and 48 px images (ICONDIR entries).
4. `manifest.webmanifest` parses, `name` and `short_name` are `fanwire`, and it lists the three icons with those `sizes` and `purpose` values.
5. `index.html` has every tag above; `og:image` and `og:url` start with `https://fanwire.daviddems.com/`, and no `og:*` URL is relative.
6. `<title>` is still exactly `fanwire`.

**Not asserted against `brand/out/`:** the container has no `brand/` folder
(`verification.md` §2a).

**PR body:** states that it writes `frontend/index.html` (not a restricted tree,
but not worker-writable either). Browser check: favicon in a tab, light and
dark; share-card preview via a crawler preview tool after deploy, otherwise NOT
DONE.

---

## UI-01 — Tokens and base styles

**Objective:** `tokens.css` and `base.css` exactly as `tokens.md` specifies,
imported once in `main.tsx`, with the token-contrast test guarding them.

**Acceptance criteria:**
1. `src/styles/tokens.css` declares every token in `tokens.md` §2, §4 and §8 on `:root`, and every semantic colour again under `@media (prefers-color-scheme: dark)` (static parse).
2. Every pair in `tokens.md` §5 meets its minimum, unrounded, in both themes. The test computes WCAG 2.1 contrast itself and fails when `--color-link` dark is set to `#1f7a8c` (A1, mutation-checked).
3. No banned pair from `tokens.md` §6 is declared (A4).
4. `base.css` gives `:focus-visible` the `--focus-ring` outline, and contains no bare `outline: none` (A3).
5. `base.css` sets `color-scheme: light dark`, styles `[aria-invalid="true"]` controls with `--color-danger`, `:disabled` with `--opacity-disabled`, and defines `.visually-hidden` (A16–A18).
6. Under `prefers-reduced-motion: reduce`, `--duration-fast` and `--duration-base` are `0ms`, and there is no `@keyframes` in `src/` (A8).
7. `main.tsx` imports `styles/tokens.css` then `styles/base.css`; the existing suite stays green.

**allowed_paths:** `frontend/src/styles/**`, `frontend/src/main.tsx`, `frontend/src/test/**`.
**Hand it:** `tokens.md`, `accessibility.md`, `verification.md`.
**Director PR first:** none.

---

## UI-02 — Shared components

**Objective:** the components in `components.md` §2 and the thirteen icons in
§3, in `src/components/ui/`, with no feature using them yet.

**Acceptance criteria:**
1. `Button` renders a native `<button>`, passes every prop through, and maps `variant` (`primary`, `secondary`, `ghost`) and `size` (`md`, `sm`) to its module classes; `buttonClass()` returns the same classes for a `Link`.
2. `InlineAlert` renders `role="alert"` and `StatusLine` renders `role="status"`, each with its children as the text.
3. `Badge variant="live"` renders the visible word passed to it with a dot that is `aria-hidden`.
4. `GameScore` renders home and away scores in that order with an en dash. The game-state mapping in `components.md` §4 holds for every listed code, and an unknown code is shown as given with no "Live".
5. `Avatar` renders the first character of the username as typed and is `aria-hidden`.
6. Every icon component renders an `<svg aria-hidden="true">` using `currentColor`; `icons/LICENSE` holds Lucide's ISC text.
7. No `*.module.css` under `src/components/ui/` contains a raw colour, `px` font size, or `outline: none` without `:focus-visible` (A2, A3, A9).
8. `Button size="md"` uses `--target-min` for its minimum height (static).

**allowed_paths:** `frontend/src/components/**`, `frontend/src/test/**`.
**Forbidden:** `frontend/src/styles/**` (UI-01's), every `features/**`.
**Hand it:** `components.md`, `tokens.md` §8, `accessibility.md`, `verification.md`.
**Director PR first:** none.

---

## UI-03 — App shell and brand in the header

**Objective:** `AppLayout` as `layout.md` §2 describes it, with the symbol and
wordmarks bundled from `src/assets/brand/`.

Copy `brand/out/wordmark-light.svg` and `wordmark-dark.svg` to
`frontend/src/assets/brand/`, and `brand/out/favicon.svg` to
`frontend/src/assets/brand/symbol.svg`. The header uses the bolder small-size
cut, which is what reads at 28 px.

**Acceptance criteria:**
1. The page has exactly one `main` (`id="main"`), one `banner` and one `navigation` named "Primary", at any viewport (A12).
2. A "Skip to content" link is the first focusable element and moves focus to `main` (A11).
3. The brand link goes to `/` and its accessible name is exactly `fanwire`. It contains the wordmark `<img alt="fanwire">` inside a `<picture>` whose dark `<source>` uses `media="(prefers-color-scheme: dark)"`, and the symbol `<img alt="">` (A13, A19).
4. The nav link for the current route has `aria-current="page"`, and no other nav link does (A7).
5. Every nav link keeps its accessible name, and each has an `aria-hidden` icon (A14).
6. An anonymous visitor sees a "Sign in" link to `/sign-in` in the header; a signed-in one doesn't.
7. The three files exist under `src/assets/brand/`.
8. Static: `AppLayout.module.css` places the nav fixed to the bottom by default and in the header at `min-width: 40em`, and has no raw values.

**allowed_paths:** `frontend/src/routes/**`, `frontend/src/assets/brand/**`, `frontend/src/test/**`.
**Hand it:** `layout.md`, `components.md` §1–3, `accessibility.md`, `verification.md`.
**Director PR first:** none, but must not run concurrently with `FRONTEND-007`.

---

## UI-04 — Auth pages

**Objective:** the five auth pages and `FormField` in the narrow-card template.

**Acceptance criteria:**
1. Each of the five pages renders its form inside a `Card` (asserted by the card class on the form's container, through the `Card` module export).
2. Each request failure renders through `InlineAlert`: same text, still `role="alert"`.
3. Every submit button is `Button variant="primary"`; Resend code is `secondary`.
4. `Field` renders label, hint and error in the same order with the same ids; the error has an `aria-hidden` icon and its text unchanged.
5. Static: no raw values in `src/auth/**/*.module.css` or `src/components/FormField.module.css`.
6. The existing auth suite (`accessibility.test.tsx`, `no-secret-leak.test.tsx`, each page's tests) is unchanged and green.

**allowed_paths:** `frontend/src/auth/**`, `frontend/src/components/FormField*`, `frontend/src/test/**`.
**Forbidden:** `frontend/src/auth/CognitoAuthService.ts`, `AuthService.ts` (no logic change).
**Hand it:** `layout.md` §3, `components.md`, `verification.md`.
**Director PR first:** none.

---

## UI-05 — Feed, posts and the live score

**Objective:** the stream template, the `PostNode` card and thread, the
`GameScore` ticker in the decorator, and the like control.

**Acceptance criteria:**
1. A top-level `PostNode` renders as a `Card` with `as="article"`; a nested reply is an `article` without the card class (`layout.md` §4).
2. `LiveScoreTickerDecorator` still renders its children first and unchanged, keeps `role="status"` named "Live score", and renders one `GameScore` per entry, with a "Live" badge for `Q1`–`Q4`/`OT`/`BT`/`HT` and none for an unknown code.
3. While the feed loads, a `StatusLine` and three `aria-hidden` skeletons render; failure is an `InlineAlert`; an empty feed is an `EmptyState`.
4. An expanded post with zero replies shows "No replies yet." (new behaviour: red today, since it renders nothing).
5. Unlike carries `data-active`, Like doesn't. "N likes" is still one text node.
6. Show replies has the chevron icon, and its `aria-expanded` behaviour is unchanged.
7. Static: no raw values in `features/feed/**/*.module.css`; `GameScore` figures use `tabular-nums`.

**allowed_paths:** `frontend/src/features/feed/**`, `frontend/src/test/**`.
**Forbidden:** `frontend/src/components/**` (consume, don't change), `features/compose/**`.
**Hand it:** `layout.md` §3–4, `components.md` §2 and §4, `verification.md`.
**Director PR first:** none.

---

## UI-06 — Composer

**Objective:** the single-form-card template, the mention panel and the media
widget's states.

**Acceptance criteria:**
1. The form is a `Card`; Post is `Button primary`, Undo mention `ghost`, and each quick post `secondary`.
2. The mention suggestions panel keeps its accessible name ("Game suggestions" / "Team suggestions") and its buttons.
3. MediaWidget shows a `StatusLine` while `uploaded`/`scanning`, the ready line when `processed`, and an `InlineAlert` for a wrong type, an oversize file and `rejected`, with the same text as now.
4. The failure alert after a failed post is an `InlineAlert`, and the draft is still preserved.
5. Static: no raw values in `features/compose/**/*.module.css`; the panel uses `--z-dropdown`.
6. `component-isolation.test.ts` stays green (no control imports another).

**allowed_paths:** `frontend/src/features/compose/**`, `frontend/src/test/**`.
**Hand it:** `layout.md` §3, `components.md`, `verification.md`.
**Director PR first:** none.

---

## UI-07 — Notifications

**Objective:** the settings strip plus the divided list.

**Acceptance criteria:**
1. The list renders inside one `Card`, one `li` per entry, with dividers between rows (static).
2. Clear is `Button variant="ghost" size="sm"` with an `aria-hidden` `x` icon, and its accessible name is unchanged.
3. Loading, error and empty render through `StatusLine`, `InlineAlert` and `EmptyState`, with the same text.
4. The email preference is a one-row `Card`; the checkbox stays native and its label is unchanged.
5. Static: no raw values in `features/notifications/**/*.module.css`.

**allowed_paths:** `frontend/src/features/notifications/**`, `frontend/src/test/**`.
**Hand it:** `layout.md` §3, `components.md`, `verification.md`.
**Director PR first:** none.

---

## UI-08 — Profile

**Objective:** the identity header plus body, for both variants and the
settings card.

**Acceptance criteria:**
1. `ProfileSummary` renders an `Avatar` and the username as the `h1` inside a header `Card`; "N followers" and "N following" are still single text nodes.
2. Follow is `Button primary`; Unfollow is `secondary` with `data-active`.
3. Settings is a `Card` with its `h2`; the saved note is a `StatusLine` with `variant="success"`.
4. The date of birth still appears only on the own profile (the existing privacy tests stay green).
5. Static: no raw values in `features/profile/**/*.module.css`.

**allowed_paths:** `frontend/src/features/profile/**`, `frontend/src/test/**`.
**Hand it:** `layout.md` §3, `components.md`, `verification.md`.
**Director PR first:** none.

---

## After the units

- The browser checklist (`verification.md` §3) for every route, light and
  dark, by the human or a confirmed tool; until then, NOT DONE.
- Follow-ups this plan surfaced but doesn't own (they are in the PR body too):
  a username character rule (`typography.md` §1); team abbreviations on
  `LiveScoreView` (`components.md` §4); the game page that would make
  `#GameId<n>` a link.
