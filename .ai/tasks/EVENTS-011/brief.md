# EVENTS-011: record value shapes

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

The human, 2026-11-02: a team's best season should read as the real figure, 73
wins and 9 losses, and a player's shooting total should carry its percentage
greyed in parentheses. Today `RecordDefinition` has no idea what kind of value
it holds, and the frontend guesses from `unit.includes("%")`
(`components/stats-nav/recordLabels.ts`, `isRate`).

## Decided

- **The percentage stays visible, muted, on a team season.** The human asked for
  the record instead of the percentage. It keeps a muted `(.890)` because ranking
  still uses the percentage: a 66-game 2011-12 season can rank above a longer one
  with more wins, and the figure alone would look misordered. To drop it, remove
  one span.
- **`value` keeps its meaning**, so old cached bundles keep rendering during the
  deploy. New fields are additive.
- Replace `isRate` with a switch on `value_kind`.

## Depends on

Nothing. It ships value alone. `EVENTS-012` then registers the library on top of
`value_kind`.

## Traps

- `_season_record` already computes `wins` and `games`, so `losses` is
  `games - wins` in SQL. `_entry_fields` is the one place a row becomes an entry.
- The holder statements are cached per process by `_holder_for`, which returns a
  `percentage` flag. Replace that flag with the definition's `value_kind`.
- A player's made and attempted figures on `player-threes-game` need
  `three_pointers_attempted` in the candidate columns. Adding a column must not
  change the index plan, so `test_records_indexes.py` is the check.
