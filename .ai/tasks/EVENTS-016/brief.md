# EVENTS-016: a record's top three in the holders read

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## The human's ask (2026-11-07)

Each Historical record card should show the top three for its record, not only
the holder. The example, for "Best regular season":

```
Best regular season
- [GSW] Warriors 73-9      (bold)
  2015-16                  (grey, smaller)
- [OKC] Thunder 68-14
  2024-25
- [DAL] Mavericks 67-15
  2006-07
```

This unit is the backend half; FRONTEND-042 draws the cards.

## Where it is

The cards read `GET /events/records/holders?ids=…` (24 ids a page, one
statement per id, each one row: the first entry and `tied_count`). The ranked
list route `GET /events/records/{id}` already returns entries in list order.

## Decided (Director, 2026-11-07)

- Extend the holders read with `top` rather than have the page call the list
  route 24 times: the page stays one read per 24 cards.
- `top` uses exactly the list route's entry shape and order, so a card and the
  record's own level never disagree. The holder's existing fields stay, so
  nothing reading them breaks.
