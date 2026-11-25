# FRONTEND-053: `Field` layouts (checkbox and row)

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

Track 5, deliverable 3 (`Prompts/34`, ADR 0035), and the backlog row "`Field` layouts"
(origin `components-map-posts.md` §5, `FRONTEND-007`). `Field` owns its own layout: a
feature's module CSS sets control widths, never the label or the gaps
(`components-map-posts.md` §5). Two places can't get what they need from today's one
stacked layout:

- **The email preference** puts the box before its label by turning `Field`'s root
  into a row from outside (`Notifications.module.css`, `.preference > div` and four
  more rules into `Field`'s markup, `UI-007`, `NOTIFICATIONS-002`). It's the one
  recorded exception to "Field owns its own layout", and the map says a checkbox
  layout in `Field` should replace it.
- **The search bar** stacks the box over a full-width Search button at every width,
  because a row would need a rule on `Field`'s wrapper (`layout.md` §3, `/search`).

The backlog row also names "its three selects". **Search has no selects today**: the
sports filters left search for Stats in `FRONTEND-009`, and `Prompts/34` deliverable 3
already reads "a row layout for search". So this unit's row layout serves the box and
button only. Nothing else adopts it.

## Decision (Director's): a `layout` prop on `Field`

`layout?: "stack" | "checkbox" | "row"`, default `"stack"`. The root keeps the `field`
class and adds `checkbox` or `row`. The stack markup is exactly today's, so every
other caller (auth, compose, profile, account, stats) is untouched.

- **`checkbox`**: the control, then the label, then the hint, then the error, **in DOM
  order**. It doesn't reorder with CSS `order: -1` as the exception does today, so
  reading and tab order match what's on screen. A wrapping flex row, centred, at
  least `--target-min` high. The 20 px box is `flex: none`, and the label is
  `flex: 1`, so the whole line is the hit area. The hint and the error take a line
  each (`flex-basis: 100%`). `cursor: pointer` applies only to an `:enabled` box and
  the label after it. This is the deleted exception's CSS moved to its owner, with
  the order fixed.
- **`row`**: the label, the children, the hint, the error (stack's DOM order). The
  root is a grid, `minmax(0, 1fr) auto`, with a space-token column gap. The label, the
  hint and the error span the row, so the control takes the room and one trailing
  action keeps its own width. Grid rather than flex-wrap because the row has exactly
  one growing control and one fixed action. Rows of several controls can wait for a
  caller that needs them (YAGNI).
- **`SearchInput` gets `action?: ReactNode`.** With an action it renders `Field`'s
  row layout with the action after the icon's wrapper. Without one it's unchanged
  (the stats `RecordsLevel` caller). `SearchBar` passes its Search button as the
  action, which deletes `.bar`'s column rules. The button stays the form's submit
  button inside `role="search"`.

The Director prototyped this design (not committed; the tests in `task.json` are the
contract). It passed every existing test except the two named below, and measured
the bundle numbers in `task.json`.

## The unit

- **Red first, one commit** (`test_agent`):
  - `components/FormField.test.tsx` (new): the stack default unchanged (root class
    only `field`), the checkbox and row DOM order and classes, unchanged ids, name
    and description, and the `.checkbox` and `.row` rules read from
    `FormField.module.css` on disk (on Vitest 4 `styles.x` is a hashed name even
    for an undefined class, so check the class exists on disk).
  - `SearchInput.test.tsx`: new tests for `action` (row class, the action after the
    wrapper, inside the `Field` root) and for no action (no row class).
  - `SearchBar.test.tsx`: a new test that the box and the Search button share the
    box's `Field` root, with the button after the box.
  - `notifications-style.test.tsx`: the two changed tests named in `task.json`, plus
    new tests that `Notifications.module.css` has no selector reaching inside
    `.preference`, and that the box's `Field` root has the checkbox class and the box
    precedes its label.
  - `bundle-budgets/FRONTEND-053.ts`. Tests are frozen after this commit, so measure
    on your implementation first, then declare.
- **Implementation** (`code_agent`): `FormField.tsx` and `.module.css`,
  `SearchInput.tsx`, `SearchBar.tsx`, `Search.module.css`, `EmailPreference.tsx`,
  `Notifications.module.css`.
- **Docs** (`context_maintainer`): the three module parts the last criterion but one
  names.

## Existing tests this unit changes, and why

This is a layout change, not deliverable 2's frozen refactor. Only these two change, both
in `notifications-style.test.tsx`, "the unavailable-email caption (NOTIFICATIONS-002)":

- "wraps to its own line under the row, rather than squeezing the label" finds
  `.preference > div` (`FIELD_ROW`) and `.preference > div > p` in
  `Notifications.module.css`. Those rules are the exception this unit deletes, so it
  reads `FormField.module.css`'s `.checkbox` rules instead.
- "does not leave cursor: pointer on a disabled control or its label" requires a
  pointer rule in `Notifications.module.css`. The pointer moves to `Field`, so it
  reads `FormField.module.css`.

Both keep their intent. Every other test stays untouched, including
`auth/form-field.test.tsx`, which pins the stack order "label, control, hint, error",
still true for the default.

## Traps

- `prettier --write` on named files only: a glob also matches committed tests.
- `bundle-budgets/FRONTEND-053.ts` is under `src/test/**`, so it's a `test_agent`
  file and goes in with the failing tests.
- `FormField.module.css` is in the entry CSS, so the entry CSS grows (about 112 B
  gzip in the prototype, past the 100 B tolerance). It needs `entryCssGzipGrowth`,
  and the entry raw growth (about 161 B) needs `entryJsRawGrowth`.
  `css:NotificationsPage.css` shrinks by more than the tolerance, which the unchanged
  check also fails on, so it needs `changed`.
- `.checkbox > input[type="checkbox"]` needs the input as a direct child of the
  root. `EmailPreference` already passes it so.
- The base.css input rule is `input:not([type="checkbox"], …)`, so it doesn't touch
  the box. Don't add a colour or `accent-color` here: base.css owns it.
- Run the frontend suite alone, in the foreground, sharded. A killed suite proves
  nothing.

## For the Director after merge (not unit-writable)

- **FrontendUI** (deliverable 8's PR):
  - `components-map-posts.md` §5: the `FormField` row gets the three layouts. The
    `EmailPreference` row drops "the one recorded exception", since it now uses
    `layout="checkbox"`.
  - `components-map-pages.md` §5: the `SearchBar` row says box and button in one row
    via `SearchInput`'s `action`, not "stacked at every width".
  - `components-shared.md`: the `SearchInput` rows (look, and props) gain `action` and
    the row layout.
  - `layout.md` §3: the `/search` row drops "stacked at every width … a `Field` row
    layout is in `TODO/02-backlog.md`". Check the `/` row's rail description still
    reads right.
- **`TODO/02-backlog.md`**: delete the "`Field` layouts" row, and note that its
  "three selects" were stale (`FRONTEND-009`).
- **Browser check**, the last criterion: light and dark, 360 and 1280 px, the
  preference card (available and unavailable) and the search bar on `/search` and in
  the 288 px home rail. The rail is the narrowest home of the row, about 256 px
  inside the card. If the box is too cramped there, a follow-up decides, not this
  unit.
