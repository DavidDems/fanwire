# POSTS-005 — attachment schema and create

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

Stage 3 of `wiki/GeneralContext/Prompts/18-posts-lifecycle-and-data-links.md`
(`Architecture/human-decisions.md` §9): a non-reply post may carry one
sports-data attachment, a game's final score, a player's line in one game,
or a player's career averages (regular season or playoffs, computed live).
This unit stores and creates it. Read responses get assembled previews in
`POSTS-006`; the composer's pickers are `FRONTEND-013`.

## The design

- **Real nullable foreign keys, not a type and id pair** (decided):
  `linked_game_id`, `linked_player_game_stats_id`, `linked_player_id`,
  `linked_player_scope`. The four CHECK constraints in the criteria make the
  database the last line of defence, as `ck_posts_reply_requires_parent`
  already is. The FKs name `events/` tables by string (`"games.id"`), as
  `EventMention.game_id` already does: a foreign key is a schema fact, not a
  read across the boundary. **No index yet**: nothing in this unit queries by
  these columns. `POSTS-006`'s preferred-team relevance adds what it needs.
- **One discriminated `data_link` on create.** A Pydantic discriminated
  union on `type` (`Field(discriminator="type")`), three models with
  `extra="forbid"`, `ref_id: PositiveInt`, and `scope: Literal["regular",
  "playoffs"]` only on `player_career`. The shape is validated at the
  boundary (a 422 from Pydantic). Map it onto the columns in one place.
- **The target is checked through `events/`' interface** (`EVENTS-009`):
  `validate_game_final`, `validate_player_game`, `validate_player_career`.
  `PublishPostFacade.publish` calls them after the deleted-parent check and
  before moderation, and a `LinkTargetError` maps to 422 with a machine
  detail code (the criteria list them). Nothing is half-written: the checks
  run before the insert.
- **The post-level rules**, all 422 with a code, checked before the target:
  - not on a reply (`data_link_on_reply`);
  - not on a plain repost (`data_link_needs_quote_text`): a plain repost
    shows the original's attachment, and a text-less repost with an
    attachment would have content of its own, which the repost toggle's
    "plain" rule doesn't account for. A quote repost may carry one.
  - **not together with a `#GameId` token** (`data_link_with_game_mention`).
    **The human decided (2026-10-21)** that token parsing for new posts ends
    in `POSTS-006`, the stage where `FRONTEND-013` replaces the composer's
    `#` autocomplete with the attachment pickers. Until then a post keeps
    either its legacy mentions or one attachment, never both, so the parser
    can't bypass the one-attachment rule. `app.posts.mentions.parse_mentions`
    already finds the tokens.
- **Coexists with an image.** Media handling is unchanged.
- **`PostOut.data_link`**, the same shape as the request (`scope` null
  except for a career). `PostView` (feed, search, thread) gets its typed
  preview in `POSTS-006`, not here.

## Traps

- **Pydantic's discriminated-union errors** are 422s with a `detail` list,
  not a string. The machine codes in the criteria are for the post-level and
  target refusals the facade raises, not for shape errors.
- **Typed `PostOut` fixtures** in `frontend/src/test/compose.ts`,
  `feed.ts` and `thread.ts` gain `data_link: null` in the test commit, or
  the regenerated `schema.d.ts` fails typecheck.
- **The import scan.** `app/posts/mentions.py` imports `app.events.models.Game`
  today. Leave it; the scan allows exactly that file. Everything new goes
  through `app.events.service`.
- **Test data.** `tests/events/players_support.py` builds games, players
  and box-score lines; reuse it rather than inventing new fixtures. A 0–0
  game is the "not completed" case (`Game.completed`).
- **Rate limits and the spam scorer** apply as for any post: give test
  users an old account and link-free text, as `tests/posts/test_soft_delete.py`
  does.

## Not in this task

Previews in read responses and preferred-team relevance (`POSTS-006`),
retiring `#GameId` parsing (`POSTS-006`), any frontend component
(`FRONTEND-013`, `FRONTEND-014`, `FRONTEND-017`), editing or removing an
attachment after publishing, and historical stat snapshots.
