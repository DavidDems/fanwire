# FRONTEND-035: the icon bar, the left sidebar and the header

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## The human's ask (2026-11-05, revised the same day)

- The account avatar moves to the right end of the header.
- Sign out leaves the header and becomes the sidebar's last option.
- **Below 640 px:** the bottom bar shows Home, Stats, Notifications and Sign out,
  icons only, with no text under them. Search becomes an icon in the header, left
  of the avatar.
- **From 640 px:** a small icon-only left sidebar with Home, Stats, Search,
  Notifications and Sign out. Search moves back into the list because the sidebar
  grows down, not across.
- **From 1152 px:** the sidebar stays icon only; the right column appears
  (`FRONTEND-036`).
- **From 1248 px:** the sidebar shows text labels as well.

The reference image is the human's `landing_page.jpg`: icon and label rows on the
left, the feed in the middle, search on the right.

## Decided

- **"Feed" is renamed "Home"**, the word the human used and the reference
  image's. The tests that pin the old name change in the test commit.
- **Two Search links, one visible.** Search sits in the header on phones and in
  the sidebar from 640 px. CSS cannot move one link between the header and a
  fixed bottom bar without guessing the header's width (Sign in's width varies),
  so there are two, each `display: none` where the other shows. A hidden
  element leaves the accessibility tree, so a real reader meets one. jsdom
  ignores media queries and sees both, so tests use `within()`. This is
  recorded as an exception to `layout.md` §1, not a new pattern.
- **Sign in stays in the header** for an anonymous visitor. Only Sign out moves.
- **A deactivated account gets no Sign out in the nav**, as today: its banner
  offers it.
- **Icons only on phones**, labels visually hidden: the accessible names stay
  the words.

## Reuse

- `NavItem` and its `alsoCurrentOn` rule; the current header Sign out's
  `onClick` (sign out, then focus `main`).
- `.visually-hidden` from `base.css`.
- Icons: `HouseIcon`, `ChartColumnIcon`, `SearchIcon`, `BellIcon`, and a new
  `LogOutIcon` copied from Lucide like the others.

## Traps

- `routes.test.tsx`, `auth-flow.test.tsx` and others find "Sign out" and nav
  links by name. Sign out moves landmark (from banner to navigation), so tests
  that scope it to the header change too.
- Sign out is a `<button>` inside the nav's `<ul>`: style it like the links,
  with no `aria-current`.
- The sticky sidebar's `top` is the header's height; both use `--z-sticky`.
- Use dev server ports 5210–5219 with `--strictPort`, and stop only the port
  you started.

## Later Director PR, not this spec

`FrontendUI/layout.md` §1 for the Search exception, `FrontendUI/layout.md` §2
for the new shell, and
`tokens.md` for the three tokens.
