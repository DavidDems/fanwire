---
type: reference
---

# 0x08d — Frontend: compose and stats picker modals

**Agent-facing.** Part of [[0x08-frontend]] (index, cross-cutting contracts).

## The compose modal (`FRONTEND-020`)

Brief 20, stage 2. You can post from anywhere: a floating **+** opens compose
over the page you are on.

- **`/compose` is an overlay route** (`routes/ComposeModal.tsx`), rendered by
  `BackgroundRoutes` over the page it was opened from, which stays mounted
  (the same recipe as the thread modal). It uses UI-010's `Dialog`, titled
  "Compose". The composer is its own lazy chunk, waited for inside the
  dialog and never behind the page's Suspense.
- **The history state is read only in `modal-flow.tsx`.**
  - A compose entry carries `{ background?, composeOpenedInApp: true }`.
  - `useComposeLinkState()` builds it. On a page, `background` is that page.
    Inside the detail modal, it is the flow's background, so the detail
    closes under compose and only one dialog is ever open.
  - `useComposeClose()` is the one way out, for Close, Escape, the backdrop
    and a published post. It steps one entry back when the entry was opened
    in the app, which returns you to the page, or to the detail, whose own
    entry still carries its flow. A direct load or a reload has no flag, so
    it replaces the entry with `/`.
  - The "Post about this" links on the game page, box-score rows and the
    player page carry this state. Their addresses are unchanged.
- **The guard's rules are `RequireAuth`'s.** `ComposeModal` reads the
  account status the shell already holds (`ShellAccountStatus`, provided by
  `AppLayout`), so opening compose asks the API nothing.
  - A guest is redirected to `/sign-in` with `from`, and a profile-less
    account to `/create-profile`, before any dialog renders.
  - Loading, deactivated and unavailable states render `RequireAuth` inside
    the dialog.
  - While the account or the chunk is still loading, the dialog waits up to
    500 ms before showing a loading line. A guest's redirect therefore
    never flashes a dialog first, and a quick chunk opens straight on the
    composer.
- **The + replaces the Compose nav item.** It is `FloatingButton` in its
  `onClick` form, since its link form takes no state, named "Compose a
  post", and shown only to an active account. `main` is padded at the bottom
  so the last card's controls scroll clear of it: 8.5rem on phones and 5rem
  from 40em (`floating-clearance.test.ts`).
- **A published post closes the modal**, the same way Close does, and
  invalidates the `["feed"]` prefix. Compose spells the key and doesn't
  import the feed feature. A failed post keeps the draft and the modal.
- **The attach row** sits under the text box. Both buttons are icon-only and
  at least 44 px:
  - the paperclip, "Attach an image", opens a visually hidden file input
    with no `accept`;
  - the bar chart, "Attach stats", opens the stats picker dialog
    (`aria-haspopup="dialog"`, since `FRONTEND-021`).
  An attached link's summary shows whether the picker is open or not.
- **The image check** (`MediaWidget`, shared with the thread's reply box):
  - **The tile:** from the choice onward, a fixed-size tile shows the file
    name under a static overlay. It has no animation (A8) and a `role=status`
    line, "Checking the image…".
  - **Auto-attach:** on `processed` the thumbnail replaces the tile and the
    image is attached, with no second press, plus a "Remove image" control.
  - **Polling:** the poll runs once a second on the widget's own timer,
    starting when **the bucket upload finishes** (the human, 2026-10-24: a
    slow uplink must never fail a good image). At most 31 polls; the last
    one is at 30 s, and a hidden tab's paused timer can't skip it (R17).
  - **The refusal line:** a refused type, a file over `max_bytes`,
    `rejected`, or nothing by the bound removes the tile and shows one red
    line with a ✕: "The image you attached is too large or cannot be
    accepted".
  - **Other failures:** a failure to reach the API or the bucket keeps "We
    could not upload that image. Please try again.".
  - **Post and Reply** are disabled while an image is being checked
    (`ComposeMediator.isMediaChecking`).
- **Bundle:** the overlay, the + and the new widget add about 0.66 kB gzip
  to the entry, against an allowance of 1 kB
  (`src/test/bundle-budgets/FRONTEND-020.ts`).

## The stats picker modal (`FRONTEND-021`)

Brief 20, stage 4. The bar chart opens a second native `Dialog`, titled
"Attach stats", over compose. It is outside the compose `<form>`, anchored
at the top, with a sticky footer: Cancel and Select, disabled until a row
is chosen. Escape, the backdrop and Close leave only the picker, preserve
the draft and return focus to the bar chart. Enter in the picker never
submits the draft.

- **Select mode owns its stack.** Seasons and Players are `SegmentedTabs`;
  opening starts on the newest season, All, with nothing selected. The
  season select uses `useId`, so a Stats page underneath has its own label.
  Picking a season resets the stack. Levels are season → team → game, or
  player search → player. Back restores the search text and cached results
  without another request (the human, 2026-10-26). Every level control is a
  button, and the picker contains no page links or modal-flow navigation (R18).
  The search subtree stays mounted with native `hidden` while a player is
  displayed, so Back stays silent even after its 30-second freshness expires;
  its controls and results leave the accessibility tree and tab order.
- **One choice, held across levels.** Native radios share a name within
  each level, labelled by its heading. A completed game's Final score,
  played box-score lines (home first), and career scopes with games are
  selectable. An unavailable result or empty scope is plain text. A polite
  status says "Nothing selected" or names the choice. Select sends
  `link-attached` and remembers its existing summary words; Undo restores
  the previous link and its summary. Pre-filled addresses retain their
  checks and messages.
- **`LevelViews` injection closes R25.** `StatsNavigator` draws season and
  team levels. Its caller supplies the other levels' names and views,
  through controls that keep the navigator's heading focus rule.
  `RecordsTab` supplies records views; the picker supplies game, players
  and player views from `features/compose/`. `TeamLevel` takes an optional
  `onGame`; select mode opens a level, while Stats keeps its game links.
  Both draw the same result cards (`FRONTEND-037`): in the picker each card
  is the button that opens the game level, whose radios are unchanged.
  Records views and reads stay outside the picker's loaded chunks.
- **Shared reads close R29.** `api/stats.ts` owns `seasonsQuery` (five-minute
  freshness), game and player detail fetchers and query options. Detail
  keys match the unchanged pages and hold the complete response or null
  on 404; their freshness is the app's 30 seconds. Season and team reads
  share Stats' five-minute cache. `attachmentReads.ts` keeps eligibility,
  summary words and address checks, with no fetchers of its own.
  `api/ok.ts` is the response helper shared by stats and records.
- **Lazy loading and recovery close R23.** Compose loads its read module
  with its own chunk; picker and navigator code load only after the chart
  is pressed. Both chunk loaders keep failures inside their dialog, with
  the message "We could not open this just now. Please try again." and
  Try again. Rejected module promises are cleared, without `React.lazy`'s
  cached rejection. Retry replaces failed same-origin stylesheets before
  importing again, so recovered content has its styles. Closing and
  reopening can retry too.
- **Initial focus closes R22.** `Dialog` focuses Close after `showModal`,
  then a child's effect may move it: compose's text box takes autofocus,
  the picker starts on Close, and confirms keep Cancel. Returning from
  compose to a detail focuses that detail's Close.
- **Early record Back closes R30.** Before the list or cached summary
  arrives, the record id's `team-` or `player-` prefix determines its group.
  Back and the first breadcrumb therefore keep the right group throughout
  a cold load, without another read.
- **Cold route test warm-ups close R32.** Route-table tests that reach lazy
  Stats tabs warm the chunks in `beforeAll`, preserving their assertions.
- **Measured** (2026-10-26, Chrome, 360 × 780, CPU 4×, five alternating
  baseline/branch runs): a cold picker is 88 ms median / 95 ms worst;
  the 96-game team level is 67 / 82 ms. Compose over the dev feed's first
  20 cards is 60 / 73 ms. No required row exceeds 200 ms median or 250 ms
  worst. With every events read delayed 800 ms, worst CLS is 0.0275 for
  picker opening, 0.0025 for a team, and 0 for player opening and Select.
  The entry grows 297 B gzip / 649 B raw; the independent skeptic's
  second pass found every Baseline line met. The final frontend container
  passes 170 files / 2,335 tests.
- **Operational follow-up R16 remains separate:** time the image pipeline
  on the live stack after deploy. Local image-preservation checks stub
  the ticket, bucket and poll; no live pipeline timing is claimed.
