# FrontendUI — accessibility

**Agent-facing.** WCAG 2.2 AA is the floor. Each requirement below is a
statement that is true or false of the running app, with an id, so a unit's
acceptance criteria can cite it (for example "meets A3 and A7"). The **Check**
column says how it's verified, per `verification.md`: **T** for a vitest
assertion in jsdom, **S** for a static test over source or CSS files, **B** for
a human in a real browser.

Where the `ui-design` skill disagrees, this page wins (`decisions.md`). The
skill says *"WCAG requires 44x44 CSS pixels"*. WCAG 2.2 AA's target-size
criterion (2.5.8) is **24 × 24**; 44 × 44 is AAA (2.5.5). fanwire uses 44 px for
primary controls and nav as a design choice, and 24 px as the hard floor.

| Id | Requirement | SC | Check |
|---|---|---|---|
| **A1** | Every text/background pair declared in `tokens.css` meets 4.5:1 (3:1 for the non-text pairs listed in `tokens.md` §5), computed unrounded, in both themes | 1.4.3, 1.4.11 | S |
| **A2** | None of the banned pairs in `tokens.md` §6 is declared, and no `*.module.css` contains a hex, `rgb()` or named colour (only `var(--color-…)`) | 1.4.3, 1.4.11 | S |
| **A3** | Every focusable element shows a visible focus indicator on `:focus-visible`: a 2 px `--color-focus` outline offset 2 px. `outline: none` appears nowhere without a `:focus-visible` replacement in the same rule set | 2.4.7, 2.4.13 (AAA, aimed for) | S, then B |
| **A4** | **No teal focus ring, icon or border on a dark surface.** In dark, `--color-focus` is Pale Sky (10.425 on ink), and teal `#1f7a8c` is never the value of any dark-theme token | 1.4.11 | S |
| **A5** | A focused element is never fully hidden by the sticky header or the fixed bottom bar (`scroll-padding` per `layout.md` §5) | 2.4.11 | B |
| **A6** | Every interactive target is at least 24 × 24 CSS px, or has 24 px spacing; primary buttons and nav items are at least 44 px tall | 2.5.8 | B (jsdom has no layout); S that `--target-min` is applied to `.md` buttons and nav links |
| **A7** | Colour is never the only signal: the Live badge has the word "Live"; an invalid field has its message and `aria-invalid`; the current nav item has a bar and weight; a liked post's control says "Unlike" | 1.4.1 | T (text and attributes present) |
| **A8** | With `prefers-reduced-motion: reduce`, nothing animates or transitions (durations are `0ms`), and no skeleton shimmers at all, in either setting | 2.3.3 (AAA, aimed for), 2.2.2 | S, then B |
| **A9** | Text resizes to 200 % and the page reflows at 320 px wide with no horizontal scroll; sizes are in `rem`, not `px`, for type | 1.4.4, 1.4.10 | B; S for `rem` |
| **A10** | Text spacing overrides (line-height 1.5, paragraph 2×, letter 0.12em, word 0.16em) don't clip content: no fixed heights on text containers | 1.4.12 | B |
| **A11** | There is a "Skip to content" link, first in the tab order, that moves focus to `<main>` | 2.4.1 | T |
| **A12** | Exactly one `<main>`, one `<header>` (banner) and one `<nav aria-label="Primary">` per page, at every breakpoint | 1.3.1 | T |
| **A13** | The brand link's accessible name is exactly `fanwire`, lowercase, whether the wordmark, the symbol alone, or the interim text is showing | 1.1.1, 2.4.4 | T |
| **A14** | Every icon is `aria-hidden="true"` and every control keeps a visible text label equal to (or contained in) its accessible name | 1.1.1, 2.5.3 | T, S |
| **A15** | Status and alert regions keep their current roles: request failures `role="alert"`, loading and progress `role="status"`, the live score `role="status"` named "Live score". Styling never changes a role | 4.1.3 | T (existing tests) |
| **A16** | A disabled control still shows its label (`--opacity-disabled` 0.55, never `visibility: hidden` or below 0.4). Where the app removes a control instead (Load more at the end), it is absent rather than disabled | 1.4.3 exemption, usability | S |
| **A17** | Input boundaries (text, select, checkbox, file button) meet 3:1 against their background (`--color-border-strong`) | 1.4.11 | S |
| **A18** | Both themes are complete: every semantic colour token has a dark value, and `color-scheme: light dark` is declared so native controls follow | 1.4.3 in dark | S |
| **A19** | Images: post media keep their current `alt`; the symbol in the header is `alt=""`; the wordmark `<img>` has `alt="fanwire"` | 1.1.1 | T |
| **A20** | Forced-colors mode (Windows High Contrast) keeps focus rings, button edges and the selected-nav bar visible (use `outline` and `border`, not `box-shadow` alone, for anything that carries meaning) | 1.4.11 | B |

## Notes for implementers

- **The teal-on-dark trap covers non-text.** Teal on Jet Black is 2.995, under
  the 3:1 non-text minimum, so it can't be a focus ring, an icon, a selected
  bar or a border in dark mode. In dark, the action colour is Pale Sky
  (`tokens.md` §4), so the trap can't be reached through the semantic tokens.
  It can only be reached by writing a raw value, which A2 forbids.
- **`--color-accent-on-dark` has a 0.001 margin.** It's used only as the dark
  `--color-link`, and links sit only on `--color-bg` or `--color-surface`.
  Never on `--color-surface-muted` (3.899), never under a hover fill.
- **Focus rings use `outline`, not `box-shadow`.** `outline` survives
  forced-colors mode (A20); a shadow is removed.
- **Don't fix a contrast failure by nudging a hex in a component.** A failing
  pair means the token table is wrong. Raise it, and the human decides any
  palette change (`decisions.md`).
