# FRONTEND-010 — the thread modal and replying in place

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

The human (2026-10-14): "Posts should be clickable to open a modal with the
post's thread. Clicking reply should open the thread and allow users to write
the reply directly below the original post, currently pressing reply brings
you to the compose page and give the user no indication that they are writing
a reply." They chose a modal with its own address, `/posts/:id`: Back closes
it, and a thread can be shared.

## Runs after

`UI-009` (the post card this modal shows and whose reply control it rewires),
merged.

## Things to get right

- **The background-location pattern** (react-router's documented modal
  recipe). Opening a thread navigates to `/posts/:id` with
  `state: { background: location }`. The route table renders the background
  location's element, with the modal over it. With no background (a direct
  load), it renders the feed underneath. Closing calls `navigate(-1)` when
  there is a background, and `navigate("/", { replace: true })` when there is
  not. The routes stay data in `routes.tsx`, so the app and the tests share
  them (that file's own rule).
- **A native `<dialog>`** via `showModal()` gives focus containment, Escape
  and the top layer for free. Close on backdrop click by checking the event
  target. jsdom's `HTMLDialogElement` may lack `showModal`/`close`; if so,
  shim them in `setupTests.ts` (allowed), and say in the shim why it exists.
  Return focus to the opener on close.
- **Clickable card, accessibly.** The keyboard and screen-reader path to a
  thread is the timestamp link. A click elsewhere on the card is a mouse
  convenience: it ignores clicks that land on or inside an `a`, `button`,
  `input`, `textarea`, or a text selection. It is not a second focus stop:
  never `tabindex` on the card, and never a link wrapping the card.
- **The composer is compose's, not feed's.** `0x08-frontend.md` and
  `feed-isolation.test.ts` pin that the feed reimplements no part of
  composing and reaches it by address. Keep that: export an `InlineComposer`
  (or equivalent) from `features/compose/`, built on the same
  `ComposeMediator`, `PostBuilder` and colleagues as `ComposePage`. Don't
  write a second text box. Import it only from the new `features/thread/`,
  which also imports the feed's `PostNode`. `features/feed/` never imports
  compose. `component-isolation.test.ts` (the three colleagues talk only
  through the mediator) must stay green.
- **"Replying to @username"** is part of the composer, visible and
  programmatically tied to the text box (`aria-describedby`). The reply
  control opens the modal with `?reply=1` (or an equivalent in navigation
  state) so the composer takes focus. A plain "open thread" does not steal
  focus into the text box.
- **After posting**, invalidate the thread's query and every cached copy of
  the parent (feed pages, search pages, the thread). The reply count then
  comes back from the server, so it isn't optimistic, as the human asked.
- **Remove the disclosure** ("Show replies") from `PostNode` and its tests.
  The thread modal replaces it. Update `0x08-frontend.md`'s feed section.
- **The quote-repost link** `UI-009` left pointing at the author's profile
  now goes to `/posts/:originalId`.
- **Scroll.** The page underneath must not jump: the modal is an overlay,
  and the background route is not re-mounted. Test that the background
  page's component instance survives opening and closing.

## Not in this task

Any backend change, deleting or editing posts, nested reply trees deeper than
"open the reply's own thread", and notifications.
