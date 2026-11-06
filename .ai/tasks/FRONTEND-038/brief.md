# FRONTEND-038: remove the Invite button

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## The human's ask (2026-11-06)

"First and foremost, remove the invite link button, both its logic and visual."
It was added by `FRONTEND-032` (#331) beside the compose + button.

## Decided

- **Remove, don't hide.** The component, its CSS, its tests and its icon go.
  Nothing replaces it; sharing a link stays in each post's More options menu
  (Copy link).
- **The + button doesn't move.** `FRONTEND-032` placed Invite relative to the +
  and left the +'s markup alone, so removing Invite should leave the + exactly
  where it was. Measure it against production before and after.

## Reuse

Nothing new. Delete; keep the compose button's tests.

## Traps

- `FRONTEND-032` restated `height: 3.5rem` in `FloatingButton.module.css`'s
  40em rule to work around a flaw in `floating-clearance.test.ts`
  (`composeBottom` misses the button's height in the wide rule). Leave it
  unless the test stops needing it; if you remove it, say so in the PR.
- The bundle-budget tests read every file in `test/bundle-budgets/`; check what
  removing or keeping `FRONTEND-032.ts` does to them before choosing.
- Use dev server ports 5210–5219 with `--strictPort`, and stop only the port
  you started.

## Later Director PR, not this spec

`FrontendUI/components.md` (§3's `link` row and the `InviteButton` mentions).
