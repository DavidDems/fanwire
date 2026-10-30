# NOTIFICATIONS-002: say when email is not available

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

`TODO/02-backlog.md` "Email toggle while email is off", and `0x05-notifications.md`
"Known gap". `sendEmailNotifications` is `false`, so nothing is emailed, and the
checkbox still renders as if it worked. Still true on `c2a9eda`.

## Where "available" comes from

`bool(settings.notification_from_address)`: the same empty check `SesEmailSender`
uses to skip. One fact, no second switch that could disagree with the sender. The
response carries only the boolean.

**The trap that passes every backend test:** `infra/lib/app-stack.ts` sets
`NOTIFICATION_FROM_ADDRESS` on the Notifications function only. The API function
never has it, so without the infra change `email_available` is `false` forever,
even after the flag is turned on. Compute the condition once and give the value to
both environments. The API gets no SES grant. A from-address is not a secret (it is
the `From` header of every mail), and it reaches the API's environment, never a
response.

A set from-address does not prove SES will accept a send (`0x05` says so). That is
why the human's `sendEmailNotifications` flag gates it. "Available" means switched
on, not delivered.

## Decisions for the Director (recommended, not recorded anywhere)

- **Caption wording.** Recommended: "Email notifications are not available right
  now. You will still see them here." No "yet": AWS refused production access, so
  promising it is not honest. No contractions, matching the app's other messages.
- **Disable and caption, showing the stored position.** The backlog allows either.
  A disabled box that still shows the stored value does not misstate what is stored,
  and the choice is honoured if email returns. Most members will see it ticked,
  because the default is on; the caption is what answers that.

This reverses a documented choice: `0x08` "never disabled" and the test that pins it.
The backlog row asks for the reversal, so the unit rewrites both.

## Traps

- **Optimistic patch drops the field.** `onMutate` writes
  `{ email_notifications_enabled: next }`, so a new required field vanishes while the
  PUT is in flight. Spread the previous value.
- **The caption lands beside the label.** `.preference > div` makes `Field` a flex
  row, so `Field`'s hint `<p>` becomes a third item in that row. It has to wrap to
  its own line, or it squeezes the label at 360. That rule is the one recorded
  exception in `components.md`; keep the change inside it.
- `.preference input` and `.preference label` set `cursor: pointer`, wrong when
  disabled.
- The old test's `/ses|not yet|coming soon|unavailable/i` and the docblocks at the top
  of `EmailPreference.tsx` and its test describe the old rule. Replace them all.
- `preferenceStub(enabled)` has four callers. Give the fixture a default of available
  so the other three suites do not change.
- `get_settings` is `lru_cache`d: use `dependency_overrides` in route tests, not env.
- Run `export_openapi.py` first, then `gen:api-types`. Both drift-gated.

## Test-first

Red for the right reason: backend bodies lack the key (the four rewritten exact
matches included); the frontend renders no caption and stays enabled; the infra case
with domain and flag on finds no variable on the API function. The cases with the
flag off, and the enabled-control regression tests, are green in the test commit:
say so in its message. `npm run typecheck` is red in the test commit only, because
the fixture has a field the schema does not have yet; it goes green with the
regenerated `schema.d.ts`.

## Browser and overlap

Browser rows are heavy work and need the heavy lock. Signed-in checks use the local
test accounts, on localhost only, on a Track B port 5210-5219 with `--strictPort`.

Text overlap only: `POSTS-007` edits `notifications/routes.py`, and `NOTIFICATIONS-001`
and `POSTS-007` edit `0x05`. Whichever lands second rebases.

## Later Director PR, not this spec

`FrontendUI/components.md` (the `EmailPreference` row gains the caption state; not
unit-writable), and the backlog row. `TODO/01-for-you.md` §4 needs no change: the same
flag now drives both functions, and turning it on already means a deploy.
