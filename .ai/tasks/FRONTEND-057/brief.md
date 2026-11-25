# FRONTEND-057: scroll-padding-bottom from the bar

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

Track 5, deliverable 7 (`Prompts/34`, ADR 0035), and the backlog row "**The
shell's `scroll-padding-bottom` is about 5 px short**" (origin the
`FRONTEND-007` browser pass). On phones, `AppLayout.module.css` sets
`html { scroll-padding-bottom: calc(var(--space-8) + var(--space-2) +
env(safe-area-inset-bottom)) }`, so that Tab never parks a focused control
under the fixed bottom bar (`accessibility.md` A5, WCAG 2.4.11).

## The geometry (the Director's, read from the CSS at `3084e22`)

| Part | Where | Size |
|---|---|---|
| One row of cells | `.link { min-height: var(--target-min) }` (a 24 px icon + 2 × `--space-2` is 40 px, under it) | 44 px |
| The bar's edge | `.nav { border-top: 1px solid … }` | 1 px |
| Safe area | `.nav { padding-bottom: env(safe-area-inset-bottom) }` | device |
| **Bar** | | **45 px** + safe area |
| Focus ring past the box | `base.css :focus-visible { outline: 2px …; outline-offset: 2px }` | 4 px |
| **Least that clears both** | | **49 px** + safe area |
| Today | `--space-8` + `--space-2` | 72 px + safe area |
| **Specified** | `--target-min` + 1px + `--space-2` | **53 px** + safe area |

A prototype test read these numbers from the files with the shared
`lengthInRem` helper: 44, 1, 2 + 2, 72.

**Where "about 5 px short" came from.** `shell-css.test.ts`'s FRONTEND-027
note records a bar that could wrap to two lines, 69.8 px. With its edge and a
4 px ring that needs about 75 px, so 72 px was 3 to 5 px short. FRONTEND-035
made the bar icons only, with the labels visually hidden, and kept the number.
Its test is still called "the bar's two-line height". So against today's bar
the value isn't short. It's 23 px more than needed, and nothing ties it to the
bar's height.

**The fix keeps the two tied.** The padding is now written from the bar's own
tokens, plus the same `--space-2` allowance that `scroll-padding-top` gives the
header (`--target-min` + 2 × `--space-2` header, + `--space-2`). That leaves a
4 px gap between the ring and the bar, the same as at the top. Everything is
in rem except the 1 px edge, so at 200 % text the padding grows with the bar.
A new geometry test fails if the bar or the ring changes and the padding
doesn't follow: bar + ring ≤ padding ≤ bar + `--space-2`.

## The floating + (not this unit's; for the human)

A signed-in member also has the floating + on phones. It is 56 px round, 16 px
from the right edge, and its bottom edge sits 80 px up, so it covers 80 to
136 px. A control at the right end of a card's action row ("More options")
sits under it horizontally.

- **Today (72 px):** Tab parks that control's bottom at 72 px, so most of it
  is under the +. Only the bottom 8 px and the ring show.
- **After (53 px):** a 32 px control spans 53 to 85 px, so 5 px of it is under
  the +.

Neither value hides the control completely, so 2.4.11 holds either way, and
the lower value overlaps less. Clearing the + completely would take about
140 px of padding on every route, which is a design call and not part of this
fix. Note it in the browser check; don't fix it here.

## The unit

- **Red first, one commit** (`test_agent`): in `routes/shell-css.test.ts`, the
  one existing test that pins the old string is renamed and re-pinned, and one
  geometry test is added (`task.json` names both). Red: the pin, and the
  geometry test's upper bound (72 > 53).
- **Implementation** (`code_agent`): the one value in `AppLayout.module.css`
  and the file's top comment.
- **Docs** (`context_maintainer`): `0x08k-frontend-account.md`, where the
  shell's shape is recorded (`0x08a` has no `scroll-padding` line).

## Traps

- Compare the pin with the whitespace removed: Prettier breaks a long `calc()`
  over lines.
- `lengthInRem` takes `env()` as 0 and resolves `var()` from `tokens.css`.
  Read the ring from `styles/base.css`, not from a constant in the test.
- `prettier --write` on named files only.
- Run the frontend suite alone, in the foreground, sharded.

## For the Director after merge (not unit-writable)

- **`TODO/02-backlog.md`**: delete the "about 5 px short" row, and add the
  floating + overlap above as a row for the human, if wanted.
- **FrontendUI** (deliverable 8's PR): `layout.md` §5 ("On phones,
  `scroll-padding-bottom` clears the bottom bar") can name the derivation (the
  bar plus `--space-2`, like the top). `accessibility.md` A5 is unchanged.
- **`FloatingButton.module.css`**'s comment ("under var(--space-8) plus the
  safe area") is still true of the 45 px bar. No change.
- **Browser check**, the last criterion.
