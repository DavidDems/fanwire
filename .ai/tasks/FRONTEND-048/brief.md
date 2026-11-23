# FRONTEND-048: a failed confirm keeps focus inside it

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

`features/feed/delete-focus.test.tsx` "a failed delete keeps the confirm open, with focus
in it" failed on #38's CI and again on #43's (`npm non-major`, run 45096157785), and
passes when run alone. Track 2 (`Prompts/31`) said to write a backlog row if it recurred;
the human chose to fix it now instead, before the rest of the dependency PRs.

## What the Director found (2026-11-22, on #43's branch)

The test is right; the product is wrong. Pressing Delete focuses the Delete button.
`ConfirmBody` renders it `disabled` while `pending`, and a focused element that becomes
disabled loses focus to `<body>` (the HTML focus fixup rule; jsdom does it, and so does
Chrome) with no `focusout` event. When the request fails, the button is enabled again,
the `InlineAlert` appears, and nothing puts focus back. `Dialog`'s own recovery (focus
Close when focus is outside the dialog) does not apply: an `alertdialog` has no Close.

The test only sees it when the pending render commits before the 403 arrives. On an idle
machine the 403 usually wins, the button is never disabled, and the test passes (6/6
alone). Under CI load the pending render wins. A scratch test that holds the response
until Delete is disabled, then releases the 403, fails 5/5 with focus on `<body>`.

The Report confirm and the account confirms share `ConfirmBody`, so they have the same
defect.

## The fix

In `ConfirmBody`: when a pending request ends with a failure and focus is no longer
inside the dialog, focus the action button. It is enabled again by then, the alert is
announced by its own `role="alert"`, and the reader can press again or Tab to Cancel.
Leave focus alone when it is still inside the dialog (the reader moved it on purpose), and
when the request ends without a failure (the caller closes the confirm on success).

Rejected: `aria-disabled` instead of `disabled`, which keeps focus on the button while
in flight. It is a better end state, but the disabled look lives in
`Button.module.css`, `Dialog.module.css` and `styles/base.css` (`:disabled`), which is a
styling change for the frontend track, not a flake fix.

## Traps

- **Hold the response, don't race it.** `deletePostStub()` has `hold()`, which returns a
  release function. Hold before the click, `waitFor` the Delete button to be disabled,
  then release. Without the hold the test is the same coin-flip as today.
- **`document.activeElement` is the check**, not a `focusout` listener: the fixup fires
  no event.
- **Effect order:** `ConfirmBody` already focuses Cancel from a passive effect on mount.
  The new focus must not run on mount or steal focus from Cancel on open.
- **Both React versions** and react-hooks 7: compute from props in render and act in an
  effect; no ref writes during render, no setState in an effect.
- Test files are frozen after the test commit. `src/test/**` is not in this unit's paths;
  the `Dialog.test.tsx` harness lives in that test file.
- Run the frontend suite alone and in the foreground.
