# FRONTEND-013 — composer attachments

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

Stage 4 of `wiki/GeneralContext/Prompts/18-posts-lifecycle-and-data-links.md`
(`Architecture/human-decisions.md` §9). `POSTS-005` accepts one `data_link`
on `POST /posts`. This unit gives the composer a way to attach one, and it
replaces the `#GameId` dropdown, whose parsing `POSTS-006` retires. It closes
the backlog row "A narrower compose game picker" (`TODO/02-backlog.md`).

## The design

- **No new endpoint.** Every picker uses the existing events/ routes:
  - `GET /events/teams`, `/events/seasons` and `/events/games?team_id&season`
    for a game;
  - `GET /events/games/{id}` for its box score; each row has `line_id`,
    since `EVENTS-009`;
  - `GET /events/players?q=` and `/events/players/{id}` for a player and the
    two career lines.

  `CreatePostRequest.data_link` is already in `src/api/schema.d.ts`
  (POSTS-005). This unit doesn't regenerate it.
- **What is offered matches what the server accepts.** POSTS-005 refuses an
  incomplete game, a DNP line and a scope with no games, so the pickers
  don't offer them:
  - `GameOut` has no `completed` field: both scores 0 is the backend's
    `Game.completed` rule.
  - A DNP row has `seconds_played` null.
  - `games_played` 0 means the scope has no games.

  The server's 422 codes are still handled, because data can change
  between picking and posting.
- **The summary is the composer's own**, built from the responses the
  picker already holds. It isn't `FRONTEND-014`'s feed preview: that needs
  `POSTS-006`'s `data_link_preview` and isn't built yet. Keep the summary
  small: one line and an accessible label.
- **Patterns.** These are assigned by `Standards/gof-patterns.md` (updated
  in the spec PR):
  - the Mediator keeps three colleagues: text, attachment, media;
  - `PostBuilder` builds `data_link`;
  - the Memento (`DraftSnapshot`) is captured before each attach or
    replace, so Undo restores the previous attachment or none (the
    "rollback before attaching live event data" the pattern doc names);
  - quick-post templates (Prototype) clone a draft whose link is null or a
    copy, never shared.
- **The dropdown goes entirely (the human, 2026-10-22).** `#` and `$` both
  go, and so does Undo mention. Old posts' `#GameId` links still render in
  the feed (`PostText`, unchanged).
- **The pre-filled address is this unit's contract, for `FRONTEND-017`.**
  It looks like this:
  - `?link=game_final&ref=<game id>`
  - `?link=player_game&ref=<line_id>&game=<game id>`: the game id is only
    for finding the line to summarise, since there is no read of a line by
    id
  - `?link=player_career&ref=<player id>&scope=regular|playoffs`

  Parse it in one exported function, beside `postIdIn`. A parameter set
  that is wrong in any way opens a plain composer with a note, never a
  half-attached link.
- **The picker as a component.** It is a disclosure panel inside the form
  card, in the flow like the old dropdown, not a dialog: the composer may
  itself be opened over a page. It uses `components/ui` primitives only. A
  new primitive would need a `components/ui` path, which this unit doesn't
  have. Each choice is a labelled button or a native select. Focus moves
  into the panel when it opens and back to Attach stats when it closes.

## Merge order

Merge **before or with `POSTS-006`** (see its brief). Run the full suite on
a merged preview, because the two share `frontend/src/test/**`.

## Traps

- **"No request on mount"** is pinned by the composer tests, and the route
  tests run with `onUnhandledRequest: "error"`. Fetch only when a picker
  opens or a pre-filled address needs its summary.
- **Deleting the dropdown deletes its tests.** `MentionAutocomplete.test.tsx`
  and `mentions.test.ts` are removed in the test commit, which names them.
  The mediator, builder, template and `InlineComposer` tests that mention
  the dropdown are rewritten there too.
- **`prettier --write` on named files only**, never a glob.
- **`InlineComposer`** is for replies only, so it gets no Attach stats. It
  still loses the dropdown.

## Not in this task

The feed preview components (`FRONTEND-014`), the stats-page entry points
(`FRONTEND-017`), any backend change, and editing an attachment after
publishing.
