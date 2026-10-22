# POSTS-006 — attachment previews in read responses

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

Stage 4 of `wiki/GeneralContext/Prompts/18-posts-lifecycle-and-data-links.md`
(`Architecture/human-decisions.md` §9). `POSTS-005` stores one attachment per
non-reply post and creates it. This unit makes the attachment visible in the
read responses, makes preferred-team relevance count it, and retires
`#GameId` parsing for new posts. The preview components are `FRONTEND-014`.

## The design

- **`linked_line_game_id`, decided by the human (2026-10-22).** Relevance
  needs the game of a `player_game` link's line. posts/ stores only the line
  id, and the line-to-game mapping is `events/` data that posts/ may not
  query (the connection rule). A large IN list of a team's line ids is not
  an option either. So the facade stores the line's game alongside the line,
  read at create from `app.events.service.player_game_previews(session,
  [line_id])` (its `game_id`), after the validator passes. A CHECK pairs it
  with `linked_player_game_stats_id`. The migration backfills rows created
  since `POSTS-005` with a plain SQL `UPDATE ... FROM player_game_stats`: a
  migration is schema work, not a module read. **Posts are immutable**, so
  the stored game can't drift.
- **Relevance** in `query_feed_posts`: the preferred team's game ids
  (`game_ids_for_team`, as today) match `EventMention.game_id`,
  `Post.linked_game_id` or `Post.linked_line_game_id`. These are OR'd with
  the author condition, and a post never appears twice. A career link never
  counts, because a career isn't a fact about one team (§9). Both new
  columns get partial indexes.
- **`PostView` gains `data_link` and `data_link_preview`.**
  - `data_link` is the `PostOut` shape: reuse `app.posts.schemas.DataLinkOut`,
    which `Post.data_link` already builds.
  - `data_link_preview` is a Pydantic discriminated union on `type`, one
    model per `events/` preview dataclass, with every field of that
    dataclass, so the client has the destination ids. Define these models
    in `app/feed/views.py`, next to `PostView`.
  - `null` when there's no link, or when the target has no preview (an id
    absent from the batch read).
- **Batching.** `assemble_post_views` collects the page's links, reposted
  originals included, into the three key sets and calls
  `game_final_previews`, `player_game_previews` and `player_career_previews`
  once each, skipping a call whose set is empty. EVENTS-009 bounds them at
  1, 2 and 2 statements. `search/` and the thread route reuse
  `assemble_post_views`, so they need no change of their own.
- **Retiring `#GameId` for new posts (the human, 2026-10-21).**
  `PublishPostFacade.publish` stops calling `parse_mentions` /
  `resolve_mentions` and publishing `PostMentionedEvent`; nothing consumes
  that event. `data_link_with_game_mention` goes too: a token in new text is
  just text. `app/posts/mentions.py` stays only if something still reads
  it; the legacy read path is `mentioned_game_ids_by_post`, which reads rows
  and doesn't parse. If the parser is left unused, delete it and its tests,
  and drop `mentions.py` from the import-scan allowlist.
- **Legacy rows stay readable.** `mentioned_game_ids` is unchanged, and an
  old multi-game post is never collapsed into one link.

## Merge order

`FRONTEND-013` removes the composer's `#` dropdown. It should merge **before
or with** this unit: if this merges first, the live composer keeps inserting
tokens that silently do nothing until FRONTEND-013 lands. The two touch
disjoint paths except `frontend/src/api/schema.d.ts` and `frontend/src/test/**`.
Run the full suite on a merged preview before the second one merges.

## Traps

- **The import scan** (`tests/posts/test_data_link.py`) allows
  `app.events.models` only in `mentions.py` and `models.py`. The new read
  goes through `app.events.service`.
- **The statement counter.** Reuse the helper in
  `tests/feed/test_post_view_queries.py`, and assert equality between the 2
  and 20 pages. A bare upper bound hides an N+1 that happens to fit under
  it.
- **Tests that pin the old rule.** Expect to rewrite these in the test
  commit, and name each one in its message:
  - `tests/posts/test_mentions.py` and the facade tests that expect
    `EventMention` rows from new text;
  - the `data_link_with_game_mention` case in `test_data_link.py`.
- **Typed fixtures**: `PostView` objects in `frontend/src/test/feed.ts` and
  `thread.ts` gain both new fields as `null`.
- **The backfill runs before the CHECK**, or the CHECK fails on the rows it
  is about to fix.

## Not in this task

The preview components and their links (`FRONTEND-014`), the composer
(`FRONTEND-013`), notifications' rendering, and any change to `events/`.
