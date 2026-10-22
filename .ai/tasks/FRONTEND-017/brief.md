# FRONTEND-017 — "Post about this" on the stats pages

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

Stage 5 of `wiki/GeneralContext/Prompts/18-posts-lifecycle-and-data-links.md`.
The human added it on 2026-10-21, asking for the stats pages and compose to
be reworked together. A reader looking at a game, a box-score line or a
career line can start a post about it in one step.

**Needs `FRONTEND-013` merged.** That unit defines the pre-filled `/compose`
address and its parser. Cut this branch only after it lands.

## The design

- **A link, not a button.** It goes to FRONTEND-013's address:
  - `?link=game_final&ref=<game id>`
  - `?link=player_game&ref=<line_id>&game=<game id>`
  - `?link=player_career&ref=<player id>&scope=regular|playoffs`

  It is reached by address because the connection rule keeps feature
  folders from importing each other (`features/*/…-isolation.test.ts`).
  Build the address in one helper. `src/features/stats/links.ts` already
  holds the stats pages' address helpers.
- **Signed-in only (the human, 2026-10-22)**, from `useAuth()`. A guest
  would hit compose's `RequireAuth` and could lose the attachment on the way
  through sign-in.
- **Offered only where the server would accept it**, by the same rules as
  FRONTEND-013's pickers: a completed game (not 0–0), a played row (not
  DNP), and a scope with games.
- **Placement**:
  - on the game page, beside the score header;
  - in the box score, a compact icon-plus-text link in each played row's
    name cell or a trailing cell, whichever keeps the table's columns stable;
  - on the player page, one per career row.

  Its accessible name says what the post is about, e.g. "Post about Jayson
  Tatum's game", so a list of links read out of context still makes sense.

## Sibling unit

`FRONTEND-014` also edits `features/games/**` and `features/players/**`: it
puts their pages in the modal flow and highlights a line. If both are open
at once, test the combination on a merged preview before the second merges.
The link must work from the modal too, where following it leaves the flow
for `/compose`.

## Traps

- **The box score scrolls horizontally at 360 px.** The link must stay
  reachable, and the row height must not jump.
- **`prettier --write` on named files only.**

## Not in this task

The composer, the feed's previews, and any backend change.
