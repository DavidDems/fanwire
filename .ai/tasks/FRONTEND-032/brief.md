# FRONTEND-032: the Invite button

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Decided

- **Same gate as compose.** The button belongs to a member inviting a friend, and
  the human placed it relative to compose.
- **The link is the site's root.** `/` is the guest feed for a signed-out visitor.
  There is no separate guest address, so a member and their friend share the same
  URL and each sees their own view.
- **Build from `window.location.origin`**, rather than a config value, so it is
  right on localhost and production alike.

## Traps

- `navigator.clipboard` exists only in a secure context. localhost counts, and
  jsdom has none, so stub it in tests. Playwright needs
  `clipboard-read` and `clipboard-write` granted for the real read.
- `FloatingButton` positions itself. Wrap both in one fixed flex container, or give
  Invite the same `bottom` and a `right` offset of 3.5rem plus a gap. Either way,
  `compose-dialog-anchor.test.ts` and the clearance test stay true.
- Check `components/ui/icons/index.tsx` for an existing `Link` before adding one.
