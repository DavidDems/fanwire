---
type: reference
---

# 0x08g — Frontend: thread and detail modals

**Agent-facing.** Part of [[0x08-frontend]] (index, cross-cutting contracts).

## The thread modal (`FRONTEND-010`)

`src/features/thread/ThreadModal.tsx` at `/posts/:postId`, over whatever page
the reader was on. Public: a thread is a read path; replying needs a session.

- **The background-location pattern, without a re-mount.** Every link into a
  thread carries the page it left as `background` (now inside the flow state,
  below). `routes.tsx` keeps the
  table as data in two lists, `pages` and `overlays`, under one pathless
  `AppLayout` route whose only child is a splat rendering
  `BackgroundRoutes`. That component always renders the pages with
  `useRoutes(pages, location)` at **one tree position**, against the real
  location, or the background while an overlay matches (the feed, `/`, for a
  direct load), then the overlay after it. Only the location passed changes,
  so the page underneath keeps its instance, DOM, local state, data and
  scroll; tests pin node identity, an uncontrolled input's text, and no second
  read. Switching between `<Outlet />` and something else at the page's
  position is the re-mount this avoids. The layout route has to be pathless:
  with `path: "/"` it matched `/` alone and outranked the splat.
- **Opening.** The timestamp is a link to `/posts/<subject id>` (the
  keyboard and screen-reader path); a click elsewhere on the card is a mouse
  convenience that ignores clicks on or inside `a, button, input, textarea,
  select, label`, clicks that end a text selection, and a click on the thread
  already open (it would push a duplicate entry). The card has no `tabindex`
  and no wrapping link. Reply goes to `/posts/<id>?reply=1`, and the reply
  count is a link to the thread too. A link from inside the modal carries the
  **original** background, so the page underneath never becomes a thread.
- **One flow, not a stack (`FRONTEND-011`).** A detail's history entry
  carries `{ background?, depth }`, read and written only by
  `src/routes/modal-flow.tsx`: `useDetailLinkState()` (a link on a page
  starts a flow at depth 1 with this page as background; a link inside
  `ModalFlowScope`, which `BackgroundRoutes` wraps every overlay in,
  continues it at depth + 1 with the same background), `useFlowBackground()`
  (the page to keep underneath) and `useModalFlow()` (`{ depth, back, close
  }`). No other file reads `location.state`; `src/routes/modal-flow.test.tsx`
  scans for it. Game and player details joined it in `FRONTEND-014` (below)
  without a change to that shape; the module gained two read-only hooks.
- **Closing leaves the whole flow.** Close, Escape and a backdrop click go
  back `depth` entries with a background, which is the origin's own entry:
  its address, query string, loaded pages and scroll are as the reader left
  them. With no background (a direct load or reload) they go back `depth -
  1` entries and replace the first one with `/`, so nothing of the flow is
  left behind home and an earlier, unrelated history entry is never
  reached. A second press before the step lands is ignored.
- **Back steps one detail.** `Dialog`'s optional `onBack` shows a 44 px
  "Back" icon button before the title when `depth > 1` (`navigate(-1)`); the
  browser's Back does the same and, from the first detail, returns to the
  origin. The one `Dialog` stays mounted across details, so focus returns to
  the first opener when the flow closes.
- **Known gap:** opening a nested thread from a reply's timestamp removes the
  focused link, and focus falls to `body` with the modal still open (Tab
  re-enters the dialog). Moving focus to the dialog's heading on a detail
  change is still a follow-up: `FRONTEND-014` did not take it, and a
  preview or box-score link inside the modal has the same gap.
- **`components/ui/Dialog`**: a native `<dialog>` opened with `showModal()`
  (top layer, inert page, focus kept inside), the title as its heading and
  accessible name, a Close button, the prevented `cancel` event as Escape,
  and focus returned to the opener. **A backdrop click is a click whose
  target, and whose mousedown's target, is the `<dialog>` itself**: the
  dialog has no padding and does not scroll (its content does), so neither a
  click on the scrollbar nor a selection dragged out onto the backdrop closes
  it. jsdom has no `showModal`/`close`; `setupTests.ts` shims them on
  `HTMLDialogElement.prototype`, only when absent. The backdrop uses the
  `--neutral-950` primitive at 0.6 opacity: there is no scrim token.
- **Content.** The root `PostNode`, then the composer, then the direct
  replies oldest first (the API's order), each a `PostNode`. "Post not
  found" for a 404 or a non-numeric id (no request); an `InlineAlert` with
  "Try again" for a failed read.
- **The composer is compose's.** `features/compose/InlineComposer` is built
  on the same `ComposeMediator` (with `replyToPostId`), `PostBuilder`,
  `ComposeTextBox` and `MediaWidget` as `ComposePage`;
  the request goes through `createPost.ts`, now shared by both.
  "Replying to @username" is visible and is the text box's
  `aria-describedby` (`ComposeTextBox` takes optional `label`, `describedBy`
  and `autoFocus`, defaulting to `/compose`'s behaviour). It takes focus only
  when the modal was opened with `?reply=1`. Submit is "Reply", disabled in
  flight; a failure keeps the draft and shows an `InlineAlert`.
  `features/thread` imports `PostNode` and `feed/api` from feed and
  `InlineComposer` from compose, and nothing else from any feature
  (`thread-isolation.test.ts`).
- **After a reply, the counts come from the server.** The thread's exact key
  and every key under `["feed"]` whose value holds the parent (`cacheHolds`:
  feed pages, search results, other threads) are invalidated. Nothing is
  optimistic, as the human asked.
- **Signed out**: the thread, and in place of the composer a "Sign in to
  reply" link whose `state.from` is `/posts/<id>`.

## Data-link previews and details in the flow (`FRONTEND-014`)

- **Three components, one folder**: `features/feed/previews/`
  `GamePreview`, `PlayerGamePreview` and `PlayerCareerPreview`, each typed by
  its generated `*PreviewView`, picked by `LinkPreview` on the preview's
  `type`. `PostNode` renders it after the text in `PostContent`, so a plain
  repost shows the original's, and in `QuotedOriginal`, so a quote shows its
  own and the original's inside the original's box. They share no markup with
  the composer's attachment summary. `features/feed` may not import games, so
  `previews/format.ts` formats locally.
- **Honest gaps**: a link with no preview is "Stats unavailable"; a DNP line
  is "Did not play" plus its reason, with no figures; a null figure is an em
  dash (U+2014). The stats pages' own `formatAverage` uses an en dash, which
  is a known difference.
- **Game result story (`FRONTEND-022`)**: `GamePreview` shows a semantic period
  score table only when both arrays are present, have the same length, and
  each sum matches its canonical final score. Periods are Q1–Q4 followed by
  OT, 2OT, and so on. Missing or inconsistent arrays omit the table. The
  card remains one detail link named from both teams and their final scores;
  its result line names the team with the higher final score as the winner,
  and period values have visible team/period text labels.
- **The game detail (`FRONTEND-022`)** keeps the API's team names, date, score,
  result and period line score as text; its article is the header, the line
  score (when present) and the team box score tabs, with no artwork.
  Box-score tables retain every statistic inside a labelled, keyboard-focusable
  horizontal scroll region, with a visible cue when the table is wider than
  its viewport.
- **One detail link each, outside the thread controls**: `/games/<id>`,
  `/games/<id>?line=<line_id>` (the player is not linked separately) and
  `/players/<id>`, each with `useDetailLinkState`. The card's click-to-open
  already ignores links, so activating one never opens the thread.
- **One dialog for every detail.** `overlays` in `routes.tsx` is one pathless
  layout route, `features/thread/DetailModal`. It calls `useModalFlow` once
  and renders the one `Dialog` around an `<Outlet />`. Its children are
  `posts/:postId` (`ThreadModal`, now the thread body only), and
  `games/:gameId` and `players/:playerId` (`routes/details.tsx`, the
  unchanged `GamePage` and `PlayerPage`). The `<dialog>` element is the same
  from the first detail to the last, which tests pin. Each detail names the
  dialog with `useDetailTitle` ("Thread", "Game", "Player"). The shell sits
  beside the thread because `thread-isolation.test.ts` expects the thread
  feature to own `Dialog`.
- **A detail that is also a page is `flowOnly`** (`BackgroundRoutes.tsx`).
  It is an overlay only when `useIsFlowEntry()` holds, meaning the entry has
  a background or `depth > 1`. A direct load or a shared link is the full
  page. A thread has no page, so it is always an overlay.
- **Links inside a detail** (box-score names, game-log rows, `#GameId` in
  post text) take `useInFlowLinkState()`. Inside the modal that continues the
  flow; on a page it is `undefined`, a plain navigation as before.
- **`?line=<line_id>`**: `BoxScore` marks that row `aria-current="true"`,
  with an accent tint plus an inset left rule and a bold name (not colour
  alone), and calls `scrollIntoView({ block: "center" })` once. An unknown or
  malformed id marks nothing.

**Known duplication, left deliberately.** The media-URL join
(`config.mediaBaseUrl` + key) now exists in both `features/feed/api.ts` and
`features/compose/MediaWidget.tsx`. Moving it to `components/` requires editing
`features/compose/**`, which this unit may not touch — so extracting it here
would have produced a "shared" module with one caller while the duplicate stayed.
**Whoever next has both trees in scope should extract it**; it is small, and it
is recorded so the second copy is a known state rather than a discovery.

## Complete-card reveal and the route split (`FRONTEND-015`)

- **One rule, one wrapper.** `features/feed/useCardReady.ts` decides when a
  card is ready; `PreparedPostNode` renders the shared `Skeleton` post
  variant (aria-hidden, `media` reserving the picture frame) until then, and
  the whole `PostNode` in one render after. The feed, search results and the
  thread modal (root and replies) render posts only through it; a profile
  shows the shared `EmptyState` with "No posts yet." and decorative court / scoreboard linework.
- **Ready** = every picture the card shows (its own; a plain repost's
  original's; `isPlainRepost` moved to `api.ts` for this) has been preloaded
  with `new Image()` and its `decode()` has settled. A rejected decode of a
  picture that did load still counts as loaded. A card with no loadable
  picture is ready on its first render.
- **Bounded**: `CARD_READY_TIMEOUT_MS` (4000), started when the card enters
  the window. A picture still pending then, one that errored, or one with a
  `null` key shows "Image unavailable" in its frame.
- **Windowed**: `usePrepareWindow` observes the skeleton with
  `PREPARE_WINDOW_ROOT_MARGIN` (`0px 0px 100% 0px`, one viewport below) and
  latches. Nothing is requested before that. Without `IntersectionObserver`
  every card counts as in the window.
- **A revealed card stays revealed.** The readiness lives in the card's own
  state, kept per post id plus picture URL. A refetch with the same pictures
  prepares nothing. A changed picture is preloaded again inside the card
  already shown: its frame is empty until it settles, under the same bound.
  Rows keep `key={post.id}`, so a Load more leaves the previous page as it
  is.
- **The frame** (`PostMedia.module.css`): `aspect-ratio: 4 / 3`,
  `object-fit: contain`, letterboxed in `--color-surface-muted`, and the same
  box for the picture, the skeleton's block and the unavailable line. Inside a prepared
  card the `<img>` is mounted only once loaded (via `CardImageContext`), never
  hidden with CSS. A bare `PostNode` renders it at once.
- **`aria-busy`** sits on the feed's `ol` while the first page's in-window
  cards are being prepared (each reports through `onPreparing`). It latches
  off once they are all ready, so Load more and refetches never set it, and a
  first page without pictures never does. There is no animation anywhere in
  the reveal.
- **Route split.** `routes.tsx` loads the compose, notifications, profile,
  game, player, stats (page and both tabs) and five auth pages with
  `React.lazy` and named-export adapters. `details.tsx` has its own `lazy`
  for the game and player details, which resolves to the same chunks. The
  feed, search, the thread modal, `DetailModal` and the shell stay eager.
  `BackgroundRoutes` wraps the page alone in one
  `<Suspense fallback={<StatusLine>…}>`; the profile route adds its own
  (`FRONTEND-033`, [[0x08b-frontend-auth#profile-and-follow-frontend-003]]). `DetailModal` has its own around
  its `<Outlet />`, so a lazy detail never unmounts the dialog. `lazy-routes.test.ts` pins this through the static import
  graph from `main.tsx`.
