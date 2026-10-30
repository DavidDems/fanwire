# FRONTEND-027: shell fixes

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

Three rows of `TODO/02-backlog.md`: "No sign-out control anywhere", "'Your profile'
clips in the bottom bar" and "The shell's `scroll-padding-bottom` is about 5 px
short". Read against `c2a9eda`: nothing renders a header sign-out, and
`AppLayout.module.css` has not changed the relevant rules since the rows were
written. The two CSS rows came from browser passes and no browser was run for this
spec, so **reproduce them first**.

## The sign-out trap: the cache

`useSignOut` removes only the profile entry. That was enough for the deactivated
banner, its one caller. From the header, an active member has a full cache: no
feed key carries a viewer, so `["feed", "pages"]` holds their ranking and pressed
Likes, and `["notifications", …]` holds their notifications, with a 30 s `staleTime`.
A guest, or the next account on that tab, would see it. Removing queries alone leaves
a mounted feed showing its old result, so a mounted page has to refetch too:
`resetQueries` after `signOut()` is the likely shape. The token provider reads the
session per request, so the refetch goes out as a guest.

## Who sees the button

Hidden on a deactivated account: its banner and recovery screen already offer it, and
two identically named buttons would be noise. Shown with no profile yet, where a
visitor otherwise has no way out. No new redirect: guards already handle guarded
routes, and the feed is public.

## The header width trap

From 40em the nav sits inline in the header. Estimated at 640 px, not measured:
padding 32 + brand 129 + gap 16 + nav about 414 = about 591, which leaves about 33 px
after the next gap, and a secondary button needs about 86. So it probably overflows
between 640 and about 700 px, a width the requested rows do not cover: hence row 6.

**Decision for the Director, only if measurement confirms it.** Recommended: hide the
wordmark with its existing visually-hidden treatment from 40em until it fits, using
min-width queries only (`shell-css.test.ts` bans max-width). The symbol stays and the
link keeps its name. That extends `layout.md` §2's "below 360 px, the symbol alone",
which a unit cannot write. Wrapping the header is the alternative, but it makes
`scroll-padding-top` depend on width.

## The two CSS rows may be one bug

With tokens: one-line cell = 8 + 20 + 4 + 14.4 + 8 + 1 border = about 55 px, under
`--space-8` (64). Two-line cell = about 70 px, or **5.8 px over 64, the recorded
"about 5 px short"**. Cells are `1fr` of 345 or 360 px minus 8 px padding, and
"Your profile" at 12 px barely fits. So the likely root is the label wrapping and the
bar growing. The comment "under space-8 tall" is true only for one line. Unverified:
measure before choosing. A fix keeping every label on one line may clear both rows.

## Traps

- **Playwright hides scrollbars in headless Chromium**, so a 360 px viewport has 360 px
  of content and the bug may not reproduce. Use a 345 px viewport or launch without
  `--hide-scrollbars`.
- **The current-page label is weight 600 and wider.** Measure "Your profile" while on
  the own profile, as well as from `/`.
- `compose-modal.test.tsx` pins the nav's links only, so a button outside the nav is
  safe. Keep it outside the `<nav>`.
- Testing Library gives every `<header>` the banner role: scope as `AppLayout.test.tsx` does.
- `useAuth().status` and `useAccount().status` are different unions. Sign-in link logic
  reads the first, the deactivated check the second.

## Test-first

Sign-out tests in `AppLayout.test.tsx`: red because no such button exists. `account.test.tsx`:
red because `useSignOut` leaves the notifications and feed entries. jsdom has no layout,
so the CSS fixes have no behavioural red (`verification.md` §1, "How a styling unit
fails first"): measure, choose, then add a static assertion to `shell-css.test.ts`, red
because the chosen rule is absent. It guards against regression and proves nothing about
how it looks; the rows do that.

## Browser

Browser rows are heavy work and need the heavy lock. A signed-in check uses the local
test accounts, on localhost only, on a Track B port 5210-5219 with `--strictPort`, against
`npm run dev` and `backend-dev`, recreating the profiles if the stack was down
(`dev-auth-setup.md` "Test accounts"). Stop only the port you started.

## Later Director PR, not this spec (none of these are unit-writable)

- `FrontendUI/layout.md` §2: "A signed-in visitor has nothing here on phones" and the
  wordmark rule if changed; §5 if the padding's basis changes.
- `FrontendUI/verification.md` §3a: "there is no sign-out button yet".
- `FrontendUI/components.md`: the shell's Sign out.
- `FrontendUI/implementation-plan.md` "After the units", and
  `GeneralContext/Architecture/dev-auth-setup.md` "Signing out".
- The three backlog rows.
