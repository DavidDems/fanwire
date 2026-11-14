---
type: reference
---

# FrontendUI — components

**Agent-facing.** The index of the component reference: where styles live (§1,
below), then the parts with the shared building blocks, their variants and
states, the sports-specific pieces, and a map from every existing component
and view to the ones it uses. Token names are from `tokens.md`. A styling unit
is handed this file, the part for its area, `tokens.md`, and the section of
`layout.md` for its route.

## 1. Where styles live

| What | Where | Who writes it |
|---|---|---|
| Tokens | `src/styles/tokens.css` | `UI-001` only. Later changes go through the human ([ADR 0011](../../GeneralContext/Decisions/0011-brand-palette.md)) |
| Element defaults (reset, body, headings, links, native form controls, focus, `.visually-hidden`) | `src/styles/base.css` | `UI-001` |
| Shared components | `src/components/ui/<Name>.tsx` + `<Name>.module.css` | `UI-002`; later units may **add** one, never restyle another unit's |
| Feature styles | next to the component: `src/features/feed/PostNode.module.css` etc. | the feature's unit |

**Native controls are styled by `base.css`, keyed on attributes that already
exist.** Every form in the app uses plain `input`, `select`, `textarea` and
`button` inside `FormField`'s `Field`, which already sets `aria-invalid` and
`aria-describedby`. So the error ring is `[aria-invalid="true"]`, the disabled
look is `:disabled`, and the focus ring is `:focus-visible`, with no class on
any control. That's why most auth and settings forms need almost no
feature-level CSS. A native `<button>` (and a file input's
`::file-selector-button`) defaults to the **secondary** look, inside
`:where()` so any module class wins. Until each feature moves its buttons onto
`Button`, they are readable instead of the browser's grey button face, which
in dark mode put Pale Sky on `#6b6b6b` (`src/styles/native-buttons.test.ts`).

**Soft filled (`UI-010`, the human 2026-10-23).** Every text-like `input`,
`select` and `textarea`: no border at rest, a `--color-field` fill,
`--radius-lg`, `--space-4` either side, 48 px (`3rem`) tall for the
single-line ones, the label above (`Field`). The fill alone is under 3:1
(`tokens.md` §5), so a 1 px `--color-border-strong` bottom rule, drawn as an
inset box-shadow, stays in every state. Focus: the fill becomes
`--color-field-focus` and the `:focus-visible` ring appears; nothing moves (no
border, padding or size changes on focus). Invalid: a 2 px `--color-danger`
ring at rest, beside the rule, never a border. A `select` has
`appearance: none` and a chevron drawn with two `linear-gradient`s, with the
end padding widened so the text never runs under it. **No CSS file has a
`url(` or `@import`** (`src/styles/base.test.ts`): no styling makes a request.
**Under forced colors (`accessibility.md` A20)**, which drops shadows and
background images, the bottom rule is a real 1 px border, the invalid ring an
outline (the focus ring still wins), and the select gets its native arrow
back (`src/styles/forced-colors.test.ts`).

**Text that tests read stays one text node.** `"3 likes"`, `"12 followers"` and
`"8 following"` are matched exactly by `getByText` (`FeedPage.test.tsx`,
`ProfileSummary`). Style the whole node; don't split the number into its own
`<span>`. A unit that wants to split one changes the test first, in its own
red commit.

**What needs a Director PR.** Workers may write `frontend/src/**` and
`frontend/public/**`, but never `frontend/index.html`, `frontend/package.json`,
`vite.config.ts` or `tsconfig*.json` (`.ai/policy.json`), so a change to any of
those is a Director PR.

## Parts

- [`components-shared.md`](components-shared.md): §2–§3, the shared components in `src/components/ui/` (variants, states, the props as built, what is deliberately not built) and the icons.
- [`components-sports.md`](components-sports.md): §4, the score block, game state, team identity (`TeamIcon`) and mentions in posts.
- [`components-map-pages.md`](components-map-pages.md): §5, the map for the shell, routes, search, games, schedule, stats and players.
- [`components-map-posts.md`](components-map-posts.md): §5, the map for `FormField`, auth, the feed and posts, threads, compose, notifications and profile.

Section numbers carry over into the parts, so a `components.md` §2–§5
citation elsewhere is found through these headings:

### 2. Shared components

[`components-shared.md`](components-shared.md) §2.

### 3. Icons

[`components-shared.md`](components-shared.md) §3.

### 4. Sports-specific

[`components-sports.md`](components-sports.md) §4.

### 5. Map: every existing component and view

[`components-map-pages.md`](components-map-pages.md) §5 and [`components-map-posts.md`](components-map-posts.md) §5.
