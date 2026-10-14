# FRONTEND-008 — the game page, and clickable games

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

Every game since 2003-04 is live, and `GET /events/games/{id}` returns its
full detail (`EVENTS-005`, #146). But nothing in the app opens a game: the
search page's game results are not links, and a `#GameId123` in a post is
plain text. The human (2026-10-14): "the games [should be] clickable", and the
games pages separate from the posts and users pages. This unit adds the game
page and the links to it. The Stats page that lists games by season is
`FRONTEND-009`.

It needs nothing from the backend that is not merged, so it can run first.

## Things to get right

- **A new feature folder, `features/games/`.** It holds the page, the line
  score and the box score. Other features reach it by address (`/games/:id`),
  never by import (`0x08-frontend.md`, the Connection rule).
- **Read the detail shape from `schema.d.ts`** (`GameDetailOut`,
  `TeamBoxScoreOut`, `BoxScorePlayerOut`), and keep the field names. Don't add
  a client-side model that renames them.
- **Line score columns.** The API gives quarters, then overtimes as stored,
  and a seventh figure is "third overtime and later" (`0x02-events.md`
  "Game"). Head it `3OT+`; do not split or pad it.
- **Number formats** follow nba.com: `.462`, `27:04`, `+12`/`-3`/`0` for
  plus-minus. Write one formatting module with its own unit tests, and use it
  everywhere on the page.
- **Dates** are the stored naive US-Eastern timestamp. Show the date as
  stored, without converting it to the viewer's time zone (a 22:30 ET game
  would otherwise move to the next day for some readers). `date-fns`
  `parseISO` on the string without `Z` already does this.
- **Tables, not grids of divs.** `<table>`, `<caption>`, `<th scope="col">`,
  `<th scope="row">` for the player name. Wrap each in a container with
  `overflow-x: auto` and a label, so a keyboard user can scroll it
  (`FrontendUI/accessibility.md`).
- **GameScore** is a shared `components/ui/` component, and this unit is
  allowed to change that one file and its stylesheet and test. Add an
  optional `to` prop. With it, the whole score block is one link with an
  accessible name naming both teams and the score. Without it, it renders
  exactly as today, and every existing GameScore test stays green.
- **Mentions in posts.** `PostNode` renders `post.text` in a `<p>`. Split the
  text on `#GameId(\d+)` and wrap a token in a `Link` only when its id is in
  `post.mentioned_game_ids`, because only those resolved to a real game on
  the server. Build React nodes; never `dangerouslySetInnerHTML`. Put this
  in `features/feed/` (the post's own rendering).
- **Not found vs failure.** The client's `GET` returns the response status;
  a 404 is a normal state for a shared or mistyped link, not an error.
- **Browser rows.** Use Playwright MCP against `vite preview` from the
  worktree. Light and dark, at 360 and 1280 wide, on a real game: the
  backend-dev stack needs a loaded season (`scripts/load_nba_history.py`
  against the compose Postgres, one season, per the script's docstring). Use
  a regular-season game, a triple-overtime game if the loaded season has
  one, and a game with DNPs.

## Not in this task

The Stats page and the season games list (`FRONTEND-009`), player pages and
player links (`FRONTEND-009` makes the box-score names links once
`/players/:id` exists), and any change to the compose `#` picker.
