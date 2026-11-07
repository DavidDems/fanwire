# FRONTEND-042: Historical cards show the top three, holder in bold

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## The human's ask (2026-11-07)

- Records: the team or player holding the record has its name in bold (team
  icons stay). The second and third are not bold.
- Historical: each card shows the top three. The title stays; each entry takes
  at most two lines:

```
Best regular season
- [GSW] Warriors 73-9      (bold)
  2015-16                  (grey, smaller)
- [OKC] Thunder 68-14
  2024-25
- [DAL] Mavericks 67-15
  2006-07
```

## Where it is

`components/stats-nav/RecordsLevel.tsx` draws the cards from
`recordHoldersQuery` (one read per 24 cards); `Holder` shows one entry with a
tied count. EVENTS-016 adds `top` (the first three entries) to that read.

## Decided (Director, 2026-11-07)

- **Short team names** (`teamShortName`, as in the example "Warriors").
  Players keep their full name.
- **Bold means "holds the record"**: an entry tied with the first is also a
  holder, so it is bold too. Without ties this is exactly "first bold, second
  and third not".
- Two lines are kept by not wrapping line 1 (ellipsis), so a long player name
  at 320 px cannot push an entry to three lines.
- The record's own ranked list gets the same rule for rank 1, so the two views
  agree.
