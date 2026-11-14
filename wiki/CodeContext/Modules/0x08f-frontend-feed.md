---
type: reference
---

# 0x08f — Frontend: feed

**Agent-facing.** Part of [[0x08-frontend]] (index, cross-cutting contracts).

## Feed and threads (`FRONTEND-005`)

`src/features/feed/`, wired at `/` and **public** — the guest feed is a read path
by decision ([[0x06-feed]] Security), and a guard on `/` is a regression.

- **`PinnedPostDecorator` is deliberately not built, and this is the record of
  why.** [[wiki/CodeContext/Standards/gof-patterns|GoF patterns]] names it
  alongside `LiveScoreTickerDecorator` (itself removed by `EVENTS-003`, below),
  so the next reader of that document will reasonably ask where it went. **No backend field marks a post as pinned** —
  [[0x03a-posts-post]] has no such column — so it would decorate a condition that
  cannot occur. YAGNI, and the acceptance criterion is written as an absence
  precisely so a test can pin it: `feed-isolation.test.ts` sweeps the whole of
  `src/` for the name, and assembles that name from fragments so the sweep does
  not match the file performing it. **Do not re-add it** without a column that
  makes it mean something.
- **One request, and the UI never learns which ranking it got.** A guest and a
  signed-in visitor both issue the same `GET /feed`; the backend picks between
  `GuestRecentStrategy` and `FollowsAndPreferredTeamStrategy` ([[0x06-feed]]).
  An `if (isSignedIn) renderPersonalized()` duplicates a decision the backend
  already made and drifts the moment the ranking changes. This is pinned twice,
  because neither half is sufficient: behaviourally, the same response is
  rendered to both visitors and compared whole; and structurally, from disk,
  because a branch that happens to agree for a fixture passes every behavioural
  assertion. The structural half bans the *vocabulary* of that decision from the
  unit's code, with comments stripped first — a good implementation should stay
  free to explain that the backend chose. It is a lexical proxy for the
  property, not the property: a branch spelled `if (session)` is caught only by
  the behavioural half.
- **Paging is an explicit "Load more" control, not a scroll sentinel**, and that
  is a harness constraint rather than a UX preference. **jsdom implements no
  `IntersectionObserver`**, and `src/setupTests.ts` — the only place a polyfill
  could live — is outside this unit's `allowed_paths`, so a scroll-triggered
  implementation would have been untestable from inside the unit. Acceptance
  criterion 1 asks that the next page be loaded *using `next_before_id`* and that
  it stop when the response reports none; both are properties of the request, not
  of the gesture. Same shape as the `URL.createObjectURL` decision ([[0x08c-frontend-compose]]), and the
  second time this class of thing has decided a unit's design.
- **`getNextPageParam` returns `next_before_id` straight through.** react-query
  already reads `null` as "no further page", so "stopping cleanly" needed no code
  of its own — and the cursor is the one the *response* carried, never the last
  id on screen. Those agree until view assembly silently drops a post whose
  author was soft-deleted, which [[0x06-feed]] says it does.
- **Feed pages are not keyed by cursor.** `["feed", "pages"]` is the whole
  infinite query; `["feed", "thread", <postId>]` is one thread, as the modal
  reads it (a 404 is cached as `null`, `FRONTEND-010`). A key
  carrying `before_id` would make page two an entry that page one could never
  extend.
- **The optimistic like's snapshot is not in the button.** A post is not owned by
  one cache entry: it is in whichever feed page it arrived on, in every open
  thread that shows it, in search results, and since `UI-009` inside
  every repost of it (`reposted_post`), so state beside the cache moves one
  copy and leaves another stale **on the same screen**. `onMutate` patches every
  entry under `["feed"]` that actually holds the post, and that filtered list of
  entries *is* the rollback context — which is how `onSettled` can still
  invalidate **exact** keys, computed from the patch rather than assumed. The
  count moves with the control, and both are restored on failure; those are the
  two things a user sees change.
- **Every post renders through one `PostNode`, including at depth.** A thread is
  replies, and replies are posts ([[wiki/CodeContext/Standards/gof-patterns|GoF patterns]] Composite). The card
  renders from its `post` **prop** and the thread query supplies only the
  replies — a node that preferred the thread response's own `root` would render
  a post from a different cache entry than its parent is rendering from.
  **Since `FRONTEND-010` there is no inline thread**: no `Show replies`
  disclosure and no `nested` prop. Replies are read only by the thread modal
  ([[0x08g-frontend-thread]]), where each is again a `PostNode` card.
- **`GET /feed/thread/{id}` is one level per request.** It returns the root
  plus **direct** replies only; a deeper level is the same request on the
  reply, which the modal makes when a reply's own thread is opened. The
  endpoint does not offer a whole thread and the shape exists to stop a client
  trying.
- **A media item that cannot be shown keeps its frame** (since `FRONTEND-015`,
  which replaced "leaves nothing behind": a dropped picture is a layout
  shift). An error, a `null` `s3_key_public` or the card's timeout renders no
  `<img>`, and the frame holds a neutral "Image unavailable" line instead.
  Media renders from `s3_key_public` (the served image), not
  `s3_key_thumbnail` — the composer's widget uses the thumbnail, and these are
  different jobs.
- **Reply is an address, never an import**: since `FRONTEND-010`,
  `/posts/<id>?reply=1`, the thread modal with its composer focused. The feed
  never imports `features/compose` or `features/thread`; a route is the one
  seam a feature folder can offer another ([[0x00-architecture]] Connection
  rule), enforced from disk along with a ban on importing any sibling feature.
  `/compose?reply_to=<id>` and `?repost_of=<id>` still work for anyone who
  opens them; nothing on the card links there any more.
- **A thread with no replies says "No replies yet."** (`UI-005`, kept by
  the modal). An `EmptyState`, shown only once the thread read has answered.
- **No live-score ticker since `EVENTS-003` (2026-10-13).** `PostView` lost
  `live_scores` when the API-SPORTS path was retired ([[0x06-feed]]), so
  `LiveScoreTickerDecorator` and its styles are gone and `PostNode` renders its
  view directly. `GameScore`'s `compact` variant, which only the ticker used, is
  left in `components/ui/` (outside that unit's paths) with no caller.

### The post card (`UI-009`)

- **One control shape, `PostAction`.** Like, reply and repost are each an
  icon-only ghost `sm` control (the hit area stays above 24 × 24) followed by
  its count as text: "0 likes", "1 like", "1,000 replies". `countText`
  (`counts.ts`) formats the number with `Intl.NumberFormat` and picks the
  noun by hand, singular at exactly one. The count is outside the control and
  never in its name, so a stranger's like does not rename the button.
- **Fixed names, `aria-pressed` for state (the human, 2026-10-16).** The
  buttons are always "Like" and "Repost" (the `aria-label`); the viewer's
  state is `aria-pressed`, and a pressed control swaps to `HeartFilledIcon`
  or the heavier `Repeat2FilledIcon`, so the state is not colour alone.
  Reply is a link named "Reply", with no pressed state. This supersedes the
  task's "Unlike"/"Undo repost" wording and `components.md` §2's "not
  `aria-pressed`" for these two controls: a name that changes *and* a pressed
  state is the same fact said twice.
- **One optimistic pattern, `TogglePostAction`.** Like and repost differ only
  in the request (`setLiked`, `setReposted`) and the edit (`withLike`,
  `withRepost`); the cancel, the snapshot of every entry that holds the post,
  the patch, the rollback with an `InlineAlert`, the exact-key invalidation
  and the sign-in redirect for a guest are written once. The control is
  disabled while its request is in flight. `cacheHolds` and `mapCachedPosts`
  also look inside a post's `reposted_post`, so liking an original through a
  repost card moves the original's own card in the same render.
- **Reply does not move the reply count.** The count changes when the post is
  read again after a reply exists (the thread modal invalidates every cached
  copy of the parent once its reply is posted).
- **A plain repost is the original.** Plain means `is_repost` with no text
  and no media, the same rule as [[0x03b-posts-actions]] "The repost toggle". It
  renders as a line "↻ <name> reposted" (the name links to the reposter's
  profile), then the original's content, controls and counts, all acting
  on `reposted_post.id`, and opening the original's thread. A null `reposted_post` reads "This post is
  unavailable". Still one `PostNode`: the node picks its subject, the post or
  its original, and renders that.
- **A quote repost is its own post** with the original inside as a compact
  bordered box (author, time, text clamped to three lines, no controls).
  Its time links to `/posts/<original id>` and a click inside the box opens
  the original's thread (`FRONTEND-010`); the author still links to their
  profile. A null original there reads "This post is unavailable".
  **A plain repost of a quote shows no box**: `reposted_post` is one level
  deep ([[0x06-feed]]), so the quote inside always arrives with its own
  `reposted_post` null, which is the depth cut, not a missing original.
- **A reply shows what it answers (`FRONTEND-034`).** A reply's card is the
  reply at full size, then its `replied_post` in the quote's box (plus a `sm`
  avatar, text clamped to four lines, no controls or media; a click in it
  opens the parent's thread), then the reply's own action row, then a "Show
  this thread" link to `/posts/<parent_post_id>` with the flow's state. A
  null parent is the quote's muted "Post deleted" or "This post is
  unavailable" box, and Show this thread stays. A decorative 2 px
  `--color-border` line (`.threaded::before`, a border so forced colours keep
  it) runs in the left gutter from under the avatar to that link. It applies
  to the subject, so a plain repost of a reply has the box and a quote of a
  reply does not. `PostNode`/`PreparedPostNode` take `showParent` (default
  true); the thread modal's Replies list passes `false`, its parent being the
  card above.
