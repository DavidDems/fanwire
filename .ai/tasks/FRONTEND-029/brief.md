# FRONTEND-029: `Field` layouts

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Depends on

**`FRONTEND-028` must have merged first.** It moves files this unit's tests scan and
changes shared CSS. Cut `agent/FRONTEND-029` from a `main` that contains it, and start
only when no other frontend PR is open.

## Why

The backlog's "`Field` layouts" row. `components.md` §5 records "Field owns its own
layout", and calls `EmailPreference`'s `.preference > div` "the one recorded
exception", saying a checkbox layout in `Field` should replace it. Checked against
`fanwire-archive@4795f19`.

**Left out as already gone:** the row also wanted search's "three selects" in a row.
They left with `FRONTEND-009`: `SearchBar` now holds one box and one button, and
sports filtering is the Stats page's. So the row layout has one caller.

## A recorded design changes here

`Search.module.css` and `components.md` §5 say the box and button are "stacked at every
width (`layout.md` §3)", and the reason given is that a row "would need a rule on
Field's wrapper". This unit removes that reason and makes the row. The backlog row
asks for it. It is still a visible change to a recorded layout, so the Director PR
that opened this spec lists it as a recommendation the human accepts by merging. The
row without a caller would be unused code, so the two go together.

## Shape

The recommended API, not a contract beyond what `task.json` says:

```tsx
<Field id={id} label={label} layout="row" action={<Button ... />}>{control}</Field>
```

`SearchInput` keeps its icon wrapper as the control and forwards `layout` and `action`.
In the row, the label sits above the control alone, so a grid or an inner flex row
around the control and action is simpler than making the whole `Field` a row. Add
`min-width: 0` on the control so the box can shrink inside the card.

Keep the checkbox's DOM order. `:has(+ input:enabled)` depends on the label coming
before the input, and `order: -1` is what puts the box first, so moving the rules to
`FormField.module.css` is enough. Do not reorder the markup.

## Width at 360

A 360 px viewport less the column's gutter and the card's padding leaves about 296 px.
"Search" at `Button primary md` needs about 90, leaving about 200 for the box with its
icon and the placeholder-free text. That is an estimate: Row 11 measures it. Playwright
hides scrollbars in headless Chromium, so also check a 345 px viewport.

## Test-first

- `form-field.test.tsx`: the layouts, their classes and DOM order. jsdom has no layout,
  so the geometry is a static check against `FormField.module.css` plus the browser rows
  (`verification.md` §1, "How a styling unit fails first").
- `notifications-style.test.tsx` pins `FIELD_ROW = /^\.preference\s*>\s*div$/` and reads
  `Notifications.module.css`. Point those checks at `FormField.module.css` and keep what
  they assert. That the old rule is gone is a new assertion, red today.
- On Vitest 4 a CSS module import returns a class name for any key, so assert the class
  is defined on disk too (`search-css.test.ts` shows how).

## Bundle

`FormField` reaches the entry through `SearchInput` on the home view, so its CSS is
probably entry CSS, and `css:NotificationsPage.css` shrinks. Declare both. If
`FRONTEND-028.ts` is still in `bundle-budgets/` and claims the same output, `combine`
throws: stop and ask for the fold rather than editing that file.

## Traps

- Browser rows are heavy work and need the heavy lock. Track B ports 5210-5219 with
  `--strictPort`. Stop only the port you started.
- The preference card's rows and create-profile need a signed-in session on localhost
  (`dev-auth-setup.md` "Test accounts"). A row not driven is reported NOT DONE.
- Force the failure in Row 3 with `page.route`, and label it synthetic.
- Prettier has no project config: run it on named files only.

## Later Director PR, not this spec (none of these are unit-writable)

- `FrontendUI/components.md` §5: the `Field` row (three layouts), `EmailPreference`'s
  recorded exception (gone), `SearchInput`, and `SearchBar`'s "stacked at every width".
- `FrontendUI/layout.md` §3: the `/search` row, which says the box and button stack and
  still describes the "Games" filter card `FRONTEND-009` removed.
- The row in `TODO/02-backlog.md`.
