# FRONTEND-043: Seasonal leader cards with View all

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## The human's ask (2026-11-07)

In Records > Seasonal, add more records, using cards like the Historical ones:
each shows the top three players and a "view all" button that opens the top ten
in a modal. At least: points, assists, rebounds, blocks, steals, FGM, 3PT FGM,
FG%, 3PT FG%, FGA, 3PT FGA. The current season must show standings while it is
in progress (the rule is EVENTS-017's).

## Where it is

`features/stats/Leaders.tsx` draws three `ScrollTable`s (points, rebounds,
assists), one `/leaders` read each. EVENTS-017 adds one read for all eleven
boards; FRONTEND-042 builds the Historical card this reuses.

## Decided (Director, 2026-11-07)

- **The dialog is not a route.** It is a local `Dialog` over the Stats page: a
  top-ten list is part of the card, not a page anyone links to, and the Stats
  state underneath is untouched.
- **One read for cards and dialogs** (`limit=10`): the top three and the top
  ten come from the same answer, so View all is instant.
- Bold follows FRONTEND-042: the leader and anyone tied with them.
- The in-progress note tells the reader why a player with 20 games qualifies in
  November and not in April.
