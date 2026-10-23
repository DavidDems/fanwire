# FRONTEND-012 — the post menu, deletion, and account deactivation and recovery

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

Stage 3 of `wiki/GeneralContext/Prompts/18-posts-lifecycle-and-data-links.md`
(`Architecture/human-decisions.md` §9, "Lifecycle"). The backend is merged:
`POSTS-004` (`DELETE /posts/{id}`, the placeholders) and `USERS-003`
(`403 account_deactivated`, `POST /users/me/recover`). It also closes the
`business-rules.md` post-menu bullet: Copy link and Report "through
hamburger option".

**Cut this branch after `FRONTEND-014` and `FRONTEND-017` merge.** It edits
`PostNode` after 014, and it hides 017's "Post about this" links for a
deactivated account.

## Decided by the human (2026-10-22, by `AskUserQuestion`)

- **A deactivated account is gated on writes, not locked out.** Public pages
  stay browsable as a guest, under a persistent "Your account is
  deactivated" banner with Recover and Sign out. A signed-in-only route
  shows the recovery screen instead. This is the backend's own split: public
  read is guest behaviour, writes need the active-account path.
- **Deactivate lives in the own-profile settings**, as an "Account" section
  at the end of the existing card, with a confirm. No new route.
- **Report asks first, then reads "Reported".** `PostView` has no
  "already reported" field and the endpoint is idempotent, so "Reported" is
  this session's memory only. A reload offers it again, harmlessly.
- **A deleted post leaves at once.** It is removed from every cache that
  holds it, then refetched. An open thread whose root was deleted shows
  POSTS-004's "Post deleted" card with its replies.

## The design

- **The menu.** `components/ui/Menu.tsx` is a new shared primitive: a button
  plus a `popover` list (`FrontendUI/components.md` §2: "use the Popover API
  before considering a dependency"). It handles the keyboard: arrows move
  between items, Escape closes it, Tab leaves. The Escape must not reach the
  thread modal's own Escape: stop it at the menu.
- **Confirms are `Dialog`s with `role="alertdialog"`.** Inside the thread
  modal one opens over it. That is not the "one surface" rule's concern:
  that rule is about details, and a confirm is not a detail and never
  touches history. Pin that Escape closes only the confirm.
- **One account-state hook**, e.g. `auth/account.ts` `useAccount()`, returns
  `loading | anonymous | active | deactivated`, read from `useAuth()` and
  `useProfile`. `fetchProfile` gets a third result for the 403 (it throws on
  any non-2xx today, which shows "We could not check your profile").
  `PostNode`'s controls, the games and players pages' FRONTEND-017 links,
  the banner and the guards all read this one hook.
- **Clearing on deactivate**: everything the viewer saw as a member (their
  feed, liked and reposted flags, notifications) is stale. Clear the query
  cache, then refetch the profile. **Refreshing on recover**: invalidate
  everything.
- **Ownership** compares `post.author.id` with the profile's id. The server
  enforces it anyway (403), and the alert covers a stale client.

## Sibling units

`FRONTEND-015` (complete-card reveal) also reworks how `PostNode` appears.
If both are open at once, test the combination on a merged preview.

## Traps

- **`AuthContext.tsx` isn't in scope.** The account state is derived beside
  it, not inside it.
- **The modal flow's state shape** (`routes/modal-flow.tsx`) must not change,
  as in FRONTEND-014.
- **The feed isolation tests**: `features/feed` may not import
  `features/profile` or `features/games`. Shared things go in `components/`
  or `auth/`.
- **The clipboard in jsdom** is absent: stub `navigator.clipboard` per test,
  and test the fallback with it missing.
- **`prettier --write` on named files only.**

## Not in this task

Post restore, any moderation view of reports, editing a post, and any
backend change.
