# FRONTEND-030: the records home and search

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why the column widens

`--content-max` is 40rem, so three cards in `main` would be about 200 px each,
too narrow for a title and a holder's name. Three to a row, which the human asked
for, needs a wider column on this route, so the unit adds the token and the rule
in the shell. The list inside a record also benefits, and every other page stays
the reading width.

## Reuse

- `SearchInput`, `SegmentedTabs`, `EmptyState`, `InlineAlert`, `Skeleton` and the
  existing `.cards` and `.card` styles in `StatsNav.module.css`.
- `RecordsTab` is already the route adapter: extend `search()` and `href()`.
  `?q=` follows the same rule as `?group=`.
- The catalog is `staleTime: Infinity`, as the summary was. A holders page is
  keyed by its sorted ids.

## Traps

- The group bar's default moves from Team to Top records. `?group=team` must now
  be written explicitly, where before it was omitted, and tests pin the old form.
- `Stats.module.css` and `StatsNav.module.css` have static tests on the grid: move
  them with the rule, not around it.
- Use a port in the 5210–5219 range with `--strictPort`, and stop only the port
  you started.

## Later Director PR, not this spec

`FrontendUI/layout.md` for the wide column and `tokens.md` for the token.
