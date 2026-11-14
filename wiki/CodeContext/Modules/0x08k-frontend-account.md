---
type: reference
---

# 0x08k — Frontend: post menu and account lifecycle

**Agent-facing.** Part of [[0x08-frontend]] (index, cross-cutting contracts).

## Post menu, deletion and account lifecycle (`FRONTEND-012`)

On `POSTS-004` (`DELETE /posts/{id}`, the "Post deleted" placeholders) and
`USERS-003` (`403 account_deactivated`, `POST /users/me/recover`).

- **One account state, `useAccount()`** (`auth/account.ts`), from `useAuth()`
  and the one profile query: `loading`, `anonymous`, `active` (with
  `profile`), `deactivated`, plus `no-profile` (404) and `unavailable` (a
  failed read), which only the guards route on. `fetchProfile` answers
  `ACCOUNT_DEACTIVATED` (a symbol, compared by identity) for that exact 403
  body; any other 403 still throws. The marker is named only in
  `auth/profile.ts` and `auth/account.ts`: the guards, the shell, `PostNode`'s
  controls, `ProfilePage`, `FollowButton`, the thread's reply box and the
  stats pages' "Post about this" links (`offersMemberLinks`) all read the hook.
- **A deactivated account browses as a guest** (the human, 2026-10-22: gated
  on writes, not locked out). Like, repost and follow do what they do for a
  guest (sign-in, no write); the reply box, Report, Delete and "Post about
  this" are absent. Only a *known* deactivation counts: a session whose
  profile is still loading or failed keeps the member's controls. Every page
  shows `routes/Deactivated.tsx`'s `DeactivatedBanner` between the header and
  `main`: a `section` named "Your account is deactivated" (a region, so the
  header stays the one banner landmark), with Recover account and Sign out.
  `RequireAuth` shows `RecoveryScreen` in the route's place (what recovery
  restores, and that individually deleted posts stay deleted), so recovering
  renders the route asked for; `RequireNewProfile` sends it to `/`.
- **The account menu** in `AppLayout` is for active profiles only. Its Avatar
  button opens `Menu` with Profile (`/profile/<own id>`), History (`/history`)
  and Account settings (`/settings`).
- **Account settings** (`features/account/AccountSettings.tsx`) requires auth and
  orders Verify this account, Notifications, Deactivate account, Delete my data.
  Confirmation refreshes verification state; Verified is disabled. Notifications
  stays checked and disabled without requests. Deactivation reauthenticates before
  `DELETE /users/me`; wrong passwords send nothing. Its 204 resets caches and
  focuses the deactivated banner while retaining the session for recovery.
- **Delete my data** opens destructive "Delete all your data?": removed data,
  irreversibility, others' retained replies and seven-day backup expiry.
  A nonempty password enables confirmation; reauthentication precedes
  `DELETE /users/me/data`. Failure remains retryable. After 204, cancel queries
  and synchronously retire the protected `Outlet` through
  `AccountDeletionNavigation`, then sign out, clear cache and replace with `/`.
  The shell resets finishing state at home commit. `auth/account.ts` validates
  `accountDeleted` notice state; `AppLayout` displays "Your account and data have
  been deleted." via `StatusLine`. Backend: [[0x01c-users-routes]].
- **Recover** sends one disabled-in-flight `POST /users/me/recover`; success
  invalidates queries. Banner Sign out clears the account cache too.
- **Sign out** is the nav's last button, never current (`FRONTEND-027`,
  `FRONTEND-035`). Any authenticated profile state can use it except deactivated
  accounts, whose banner/recovery screen owns it. Public pages stay; guarded pages
  go to `/sign-in`; focus moves to `main` after the button disappears.
- **`useSignOut`** removes the profile query and resets every other query because
  feed keys carry no viewer. `flushSync` commits anonymous auth first: public pages
  refetch as guests; guards and disabled private queries make no requests.
  `useReported` is outside query data and survives same-tab sign-out.
- **The shell's shape** (`FRONTEND-035` and `FRONTEND-039`; decisions dated 2026-11-05 and 2026-11-06). The
  header: the brand at the start; at the end (`.headerEnd`, `margin-left:
  auto`) a Search icon link, then the Account menu or Sign in. The nav is
  Home, Stats, Search, Notifications, then Sign out; each item an
  `aria-hidden` icon and its label in `.visually-hidden`, so the name is the
  word at every width. Below 40em it is the bottom icon bar, the nav's Search
  `display: none` and the header's shown; from 40em the reverse. The nav and
  `main` share `.body`, a flex group with `--space-5` between, and the nav is a
  sticky sidebar under the header. From 40em to 53.75em it stays icon-only at
  `--sidebar-width-compact`; at 768px the sidebar and main boxes are unchanged
  from before `FRONTEND-039`. From 53.75em (860px) labels appear at
  `--sidebar-width`, and the group sits at `--space-4` from the viewport edge;
  `main` uses a 36rem minimum when it fits, bounded by available space for
  enlarged text. From 78em the centred desktop geometry is restored. The home
  rail mounts from 76.0625em (1217px): with a simulated 17px classic scrollbar,
  1216px leaves 1199px and narrows the 952px rail main to 951px, while 1217px
  leaves 1200px and fits the full rail with 16px outer gaps. At 1280px and
  1920px the shell boxes match the previous desktop layout.
  `main` keeps `--content-max` (`--content-max-wide` on `/stats/records`). The
  current item is 600, `--color-text`, with a 3px `--color-action` border on a
  `::after`, top in the bar and inline-start in the sidebar. **Two Search
  links** are the one exception to `layout.md` §1: one is `display: none` at
  any width, so tests scope Search with `within()` the header or the nav.
  `scroll-padding-bottom` stays `--space-8` + `--space-2` on phones.
- **The post menu** (`features/feed/PostMenu.tsx`, on `components/ui/Menu`):
  one "More options" per card, at the end of the action row, rendered only
  while open. Copy link for everyone (`navigator.clipboard.writeText` of
  origin + `/posts/<id>`, then "Link copied" in a status; refused or missing,
  a read-only, focused and selected field with the address). Report for an
  active member on another's post; "Reported", disabled, afterwards, remembered
  per `QueryClient` (`features/feed/reported.ts`, so a reload or a fresh app
  forgets it) and shared by every card of that post. Delete on the active
  member's own post (`post.author.id` against the profile id), never on a
  plain repost. A plain repost's menu acts on the original.
- **`Menu`**: `popover="manual"` shown with `showPopover()` (feature-checked;
  jsdom has none), placed under the button's end edge by script. Arrows,
  Home and End move a roving tab stop; Escape closes it, returns focus to the
  button, and is stopped and default-prevented so a `<dialog>` around it never
  closes; Tab or focus leaving closes it.
- **Confirms are `ConfirmDialog`** (`Dialog` with `role="alertdialog"`, no
  Close button, focus on Cancel, an `InlineAlert` inside on failure, which
  keeps it open). **Nested rule**: a confirm opened in the thread modal is a
  `<dialog>` inside its `<dialog>`; React hands the inner `cancel` and `close`
  to the outer handlers too, so `Dialog` acts only on events whose target is
  its own element. Escape or Cancel closes only the confirm; the modal flow's
  state is untouched.
- **A deletion leaves at once**: `withoutPost` (`features/feed/api.ts`) is
  applied with `setQueriesData` to every entry under `FEED_KEY_ROOT` (feed
  pages, search pages, threads: a thread root becomes `root: null`, a repost's
  original becomes `reposted_post_deleted`), after cancelling in-flight reads;
  then the entries that held it or its parent, and its own thread, are
  invalidated by exact key. 403, 404 and 409 each have their own alert. The
  card's click-to-open ignores clicks inside its own menu and confirms.
- **Focus after a removal.**
  A deleted card hands focus to the next card's "More options", else the
  previous card's, else the list's heading (`tabindex="-1"`); inside the
  thread modal a deleted reply does the same among the replies (the root's
  menu last), and a deleted root hands it to the dialog's Close. It moves only
  if focus was actually lost. After Deactivate, focus goes to the banner
  (`id="deactivated-banner"`, `tabIndex={-1}`), through `mutateAsync`, because
  the own-profile view that ran it has unmounted by then.
- **"Post deleted"** replaces an original whose `reposted_post_deleted` is
  true, on a plain repost and in a quote: a muted box with that text only.
  `reposted_post: null` alone still reads "This post is unavailable".
