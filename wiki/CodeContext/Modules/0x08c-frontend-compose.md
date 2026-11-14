---
type: reference
---

# 0x08c — Frontend: compose

**Agent-facing.** Part of [[0x08-frontend]] (index, cross-cutting contracts).

## Compose (`FRONTEND-004`)

`src/features/compose/`, at `/compose` behind `RequireAuth`; since `FRONTEND-020`
an overlay over the current page ([[0x08d-frontend-compose-modals#the-compose-modal-frontend-020]]). The page owns
one `ComposeMediator` and hands it to all three controls; that is the whole of
the wiring between them.

**The three patterns are assigned by [[wiki/CodeContext/Standards/gof-patterns|GoF patterns]], not chosen here**, and
each owns one piece:

| Piece | Pattern |
|---|---|
| Assembling `CreatePostRequest` across steps | `PostBuilder`, validation in `build()` |
| Text box ↔ attachment picker ↔ media widget | `ComposeMediator` |
| Undo after a sports-data link is attached or replaced | `DraftSnapshot` (Memento) |

- **The mediator's isolation is enforced from disk**, by
  `component-isolation.test.ts`, which reads the three component sources and
  checks the import specifiers in all six ordered pairs. A behavioural test
  cannot see this: a media widget that imports the text box directly and pokes at
  it still renders and still passes every rendering test. Same shape, and the
  same reason, as `auth/sdk-isolation.test.ts` and `test/env-usage.test.ts`.
- **`getDraft()` returns the same object until something changes the draft.** It
  is the `useSyncExternalStore` snapshot, which React compares by identity, so a
  fresh object per call is an infinite render loop rather than a failing
  assertion. Every mutation publishes a *new* draft object and nothing edits the
  published one in place.
- **File bytes go straight to the bucket and never through `apiClient`.** Two
  reasons, both hard: routing them through FastAPI would put a Lambda body-size
  limit in front of every image, and `apiClient` attaches the Cognito **ID
  token** — sending that to S3 would leak it to a service that has no use for it.
  So `POST /media/uploads` (the ticket) goes through `apiClient` and carries the
  token; the multipart POST to `upload_url` is a plain `fetch` with no
  `Authorization` header at all.
- **The presigned fields go first, in the order the API returned them, and
  `file` goes last** — S3 ignores everything after the file part. It is an
  ordinary `FormData`, which serializes in insertion order, so appending in that
  order is the whole of it and `fetch` derives the `Content-Type` and its
  boundary; setting that header by hand would override the boundary the body was
  written with. The ordering is not left to a comment — `MediaWidget.test.tsx`
  asserts the field order that actually reaches the bucket.
- **The real status values are `uploaded`, `scanning`, `processed` and
  `rejected`** — lower-case, four of them, from `MediaStatus` in the generated
  schema. **There is no `Quarantined` value**: where prose says quarantined it
  means *not yet `processed`*, and both `uploaded` and `scanning` are
  un-attachable. `rejected` is a refusal (`FRONTEND-020`: the image is
  removed and one red line says so). The widget polls `GET /media/{media_id}`
  once a second on its own timer, from the upload's end, and stops at a
  terminal status or at the 30 s bound ([[0x08d-frontend-compose-modals#the-compose-modal-frontend-020]]).
- **Locally there is no GuardDuty, so an upload against the real dev buckets
  stays un-`processed` forever.** That is correct behaviour, not a hang: nothing
  moves the row past `uploaded`. Since `FRONTEND-020` the 30 s bound refuses it
  with the red line, which is what local dev shows. The dev-only script that runs the processing pipeline on
  demand is `MEDIA-002`'s `backend/scripts/dev_process_media.py` ([[0x04-media]]).
- **No `URL.createObjectURL` anywhere.** jsdom does not implement it and
  `setupTests.ts` is not this unit's to change — and the served thumbnail is the
  honest thing to show anyway, since it is what everyone else sees once the post
  is published, EXIF-stripped and resized by the pipeline rather than the
  original off the user's disk. The widget shows the file's **name** while the
  upload is pending and an `<img>` at `config.mediaBaseUrl` + `s3_key_thumbnail`
  once it is `processed`.
- **The file input carries no `accept` attribute.** The browser's own filter
  drops a file the user chose without telling them why, and the type rule —
  jpeg, png and webp, SVG excluded by name ([[0x04-media]] Security
  requirements) — is one the user has to be able to read. The client-side type
  and size checks are for that message only; S3's policy and the processing
  Lambda's Pillow parse are the real gates and run regardless. `max_bytes` exists
  only in the ticket response, so the size check necessarily comes *after*
  `POST /media/uploads` and necessarily before the bucket POST.
- **The `#`/`$` mention dropdown is gone (`FRONTEND-013`, the human, 2026-10-22).**
  `POSTS-006` stops parsing `#GameId` in new posts, so a token inserted by a
  dropdown would silently do nothing, and `$TEAM` never resolved to anything. A
  typed `#GameId123` is sent as plain text. Old posts' resolved mentions still
  render as links in the feed (`PostText`, unchanged). `MentionAutocomplete`,
  `mentions.ts`, the `mention-inserted` event and Undo mention are deleted.
- **The address is how another feature opens the composer in a context.**
  `/compose?reply_to=<id>` and `/compose?repost_of=<id>` are read by
  `ComposePage` and handed to the `ComposeMediator` it builds; the mediator has
  taken those two ids since this unit, but nothing outside the page could reach
  them, so "reply to post 42" had no expression at all. A route is the one seam
  a feature folder can offer another without being imported by it
  ([[0x00-architecture]] Connection rule) — which is what lets `features/feed/`
  own a reply control while reimplementing no part of composing, from a unit
  that has `features/compose/**` in its `forbidden_paths`. **A parameter that is
  not a positive integer is no context rather than a broken one**: the address
  bar is user input, and `Number("x")` is `NaN`, which JSON sends as
  `parent_post_id: null` on a post still claiming `is_reply: true`. The context
  is asserted through the `POST /posts` body, because reply context is not
  content — `canBuild()` says so — and the composer renders nothing for it.
- **Nothing is fetched when the page mounts.** The pickers fetch when they open,
  a pre-filled link when the address names one, and the media poll
  starts at the first upload. `routes.test.tsx` renders `/compose` under
  `onUnhandledRequest: "error"`, so a query on mount would break a file this unit
  is not allowed to touch.
- **A failed `POST /posts` preserves the draft** — the text, the attachment, a
  message saying what happened, and a retry that sends the same request. Losing a
  user's typed text on a 500 is the worst thing this page can do and the failure
  most likely to survive review, because the happy path is what gets clicked. The
  composer is cleared in exactly one place, `onSuccess`, and clearing it clears
  the media widget's own card as well: the draft alone cannot say a reset
  happened, since an emptied draft and a never-filled one are the same value, so
  the widget watches a reset counter on the mediator. A stale thumbnail over an
  empty composer is the failure that guards against.
- **A 429 says to slow down, on the three posting paths only** (`FRONTEND-026`):
  `POST /posts` from `ComposePage` (a quote repost included) and `InlineComposer`,
  and `POST /posts/{id}/repost` from the card, whose `setReposted` raises
  `RepostRateLimited`. It goes by status alone, since an edge 429 has another
  body, and states no duration: either of the two windows can trip it and the API
  sends no `Retry-After`. A like, an unlike and an undone repost share
  `TogglePostAction` but keep its generic message: none of them is posting, and
  each can see a 429 only from the edge.
- **The media widget's field error is the `InlineAlert` itself, named by id.**
  The file input's `aria-describedby` points at `compose-media-error`, which is
  `InlineAlert`'s `id` prop on the `<p role="alert">` (2026-10-07,
  [ADR 0015](../../GeneralContext/Decisions/0015-inline-alert-id-prop.md)). The
  description is the message alone, because the alert's icon is `aria-hidden`;
  `compose-style.test.tsx` pins both that and that the target is the alert.
- **The stats picker opens over compose** (`FRONTEND-021`, [[0x08d-frontend-compose-modals#the-stats-picker-modal-frontend-021]]). Its dialog
  sits outside the compose form so Enter cannot publish the draft. The three
  mediator colleagues remain isolated by `component-isolation.test.ts`.

### Sports-data attachments (`FRONTEND-013`)

The attachment colleague preserves the three `POST /posts` `data_link` types
([[0x03b-posts-actions]] "Sports-data attachments"). Since `FRONTEND-021` the picker is
the navigator modal ([[0x08d-frontend-compose-modals#the-stats-picker-modal-frontend-021]]):

| Choice | Reads | Not offered | Sends |
|---|---|---|---|
| Game result | seasons, champion and standings, then a team's season and `GET /events/games/{id}` | a game at 0–0 (the backend's `Game.completed` rule; `GameOut` has no flag) | `{type: "game_final", ref_id: <game id>}` |
| Player's game | the same navigator, then the game's box score | a row with `seconds_played` null (did not play) | `{type: "player_game", ref_id: <line_id>}` |
| Player career | `GET /events/players?q=` (debounced), then `GET /events/players/{id}` | a scope whose career line has `games_played` 0 | `{type: "player_career", ref_id: <player id>, scope}` |

- **Only what the server accepts is offered**, but the six POSTS-005 422 codes
  still get their own messages (`dataLink.ts` `refusalMessage`), because data
  can change between picking and posting. The draft and its link are kept.
- **The summary is the composer's own** ("Attached stats" region, with Remove
  attached stats). It is one line, built from the responses the picker already
  holds, and is not `FRONTEND-014`'s feed preview.
- **Undo restores the previous link, and only the link.** A `DraftSnapshot` is
  captured before every attach or replace, and Undo attach steps back through
  them. It leaves text and media as they are now: losing typed text is the
  worst thing the composer can do. Remove clears the link without a snapshot.
- **No link on a reply.** Attach stats is absent with `?reply_to=` and from
  `InlineComposer`. A repost with a link needs text, and a link alone is not
  content (`canBuild()`).
- **The pre-filled address is the contract `FRONTEND-017` links to**:
  `/compose?link=game_final&ref=<game id>`,
  `?link=player_game&ref=<line_id>&game=<game id>` (the game is only for finding
  the line to summarise, since there is no read of a line by id) and
  `?link=player_career&ref=<player id>&scope=regular|playoffs`. `dataLinkIn`
  (exported from `ComposePage.tsx`) parses it and refuses anything malformed,
  missing or stray. The picker then checks the target, and a refusal opens a
  plain composer with a note, never a half-attached link.
