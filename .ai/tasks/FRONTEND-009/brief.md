# FRONTEND-009 — Stats (Seasons, Players), player pages, Search for people and posts

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

The human (2026-10-14): "The games, players and users/posts pages should all
be separated. There should be a stats page with tabs for seasons / players,
each with a small search bar, and the current search page stays as a
post/user search page." On the Seasons tab the human chose a season view with
a team search: the champion, the standings by conference, the stat leaders
and the season's games, and the small search bar narrows it to one team.

## Runs after

`EVENTS-006` (players API), `EVENTS-007` (seasons API) and `FRONTEND-008` (the
game page this unit links to and extends with player links), all merged.
Regenerate nothing: `schema.d.ts` already has their types, and this spec
forbids the file.

## Things to get right

- **Two feature folders.** `features/stats/` holds the page and both tabs,
  and `features/players/` holds the player page. They reach games, teams and
  players by address, never by importing another feature's internals.
  Changing the box-score names into links happens in `features/games/`
  itself.
- **Tabs are routes, not state.** `/stats/seasons` and `/stats/players` are
  child routes, and the tab list is `NavLink`s with `aria-current="page"`.
  This is the "links that look like tabs" pattern, not an ARIA `tablist`
  (which implies arrow-key switching and panels that are not separate
  pages). Put the reasoning in the component's doc comment, so a later unit
  doesn't "fix" it to `role="tab"`.
- **URL state.** `?season=`, `?team=` and `?q=` live in the URL through
  `useSearchParams`, so reloads, shared links and Back all work. Default the
  season to the newest from `GET /events/seasons` without writing it into
  the URL until the user picks one, so `/stats/seasons` stays the canonical
  address of "the current season".
- **The team search is client-side.** There are 30 teams, `GET /events/teams`
  (the same data `MentionAutocomplete` already reads). Match on name or
  abbreviation. Use the combobox pattern (`role="combobox"`, a `listbox`,
  `aria-activedescendant`), with keyboard tests: arrow down, Enter, Escape.
- **Player search hits the API.** Debounce it (about 250 ms; test it with
  fake timers), trim it, and send nothing for an empty box. `useInfiniteQuery`
  with offsets, as `SearchPage` does.
- **Search page.** Remove `GameFilter`, its test file and its CSS, and the
  `GET /search/games` client code that only it used. The backend route stays,
  since only the UI moves. Update `0x08-frontend.md`'s description of the
  search page. `FrontendUI/components.md`'s map is not writable by any unit
  role; list what changed in the PR, and a Director PR updates the map.
- **The leaders table** shows the rule string from the API under its heading,
  for example "Minimum 65 games (NBA rule from 2023-24)", so a reader knows
  why a player is missing.
- **Number formats** reuse the game page's formatting module from
  `FRONTEND-008`. Height comes in inches; show it as `6'9"`.
- **Nav icon.** Add lucide `chart-column` to `icons/index.tsx` in the same
  shape as the others, under its ISC licence (the folder's `LICENSE`).
- **Sibling trap.** Several tests scan all of `src/` (`styles/base.test.ts`,
  `test/env-usage.test.ts`). Run the full frontend container before pushing.

## Not in this task

Any backend change, the post card and thread (`UI-009`, `FRONTEND-010`),
player mentions in posts, following players or teams, and the compose `#`
picker.
