---
type: reference
---

# 0x08e — Frontend: notifications

**Agent-facing.** Part of [[0x08-frontend]] (index, cross-cutting contracts).

## Notifications (`FRONTEND-006`)

`src/features/notifications/`, wired at `/notifications` behind `RequireAuth`.
The page owns the list and the clear mutation; the row owns its actor; the
preference is its own component. Clearing is a soft delete on the backend
([[0x05-notifications]]) and **nothing here exposes that** — from the UI it is a
204 and the entry is gone.

- **The list and the preference are sibling cache keys**, `["notifications",
  "list"]` and `["notifications", "preference"]` — *not* the preference nested
  under a list at `["notifications"]`. `queryKey` is a prefix match, so the
  nested spelling makes every clear cancel and refetch the preference, and is
  correct only for as long as nobody forgets `exact: true`. Two disjoint keys
  make that wrong turn unavailable rather than merely discouraged. Every
  invalidation still passes `exact: true`, the way `FRONTEND-003`'s follow
  control does.
- **The actor is read under `["users", <numeric id>]` — deliberately the same
  entry `features/profile` reads a viewed user from**, so opening a profile from
  a notification finds it warm. The key is *redeclared* rather than imported: a
  feature folder never reaches into another feature's internals, and a
  two-element array is a smaller cost than that coupling. The id is a number,
  because that is what the path parameter is in the generated schema.
- **The actor is a query per row, and that is what makes it one request per
  actor.** react-query deduplicates by key while requests are in flight and
  serves the rest from the entry, so ten rows from one actor issue one
  `GET /users/{user_id}`. A `useEffect` fetch per row renders exactly the same
  thing and issues ten — which is why the test counts requests rather than
  asserting on what is rendered.
- **The clear mutation lives on the page, not the row, and its rollback is a
  snapshot.** The row unmounts the instant the optimistic patch lands, so a
  mutation owned by it would take its own `onError` and its failure message down
  with it, and the entry would reappear with nothing saying why. `onError`
  writes the snapshot array back *verbatim*: restoring as `[...remaining,
  cleared]` puts the entry at the end, which is also what a naive
  refetch-on-error produces, and an entry that reappears somewhere else reads as
  a second bug rather than as a failure that was undone. The tests clear the
  **middle** of three rows for exactly this reason — clearing the last one cannot
  tell the two rollbacks apart.
- **Where an entry points is decided by its `type`, never by `reference_id`
  alone.** On a `follow`, `reference_id` *is* the actor's user id
  ([[0x05-notifications]]), so a row that sent every `reference_id` to `/posts/`
  would link to a post whose id is really a user's and look entirely plausible.
  `reference_id` is nullable, so a reply or repost without one reads the same
  with plain text where the link would be.
- **A reply or repost links to `/posts/{reference_id}`**, the thread modal
  (`FRONTEND-010`, [[0x08g-frontend-thread]]). The address mirrors the API's own
  `/posts/{post_id}` and the `/profile/:userId` convention.
- **An unrecognised `type` renders a generic entry.** The switch could be written
  exhaustively — `NotificationType` is the closed set `follow | reply | repost`
  and the compiler would agree — but the bundle outlives the contract it was
  built against. A list that throws on one row takes down the rows it *does*
  understand, and one that renders nothing is indistinguishable from a broken
  fetch.
- **The email toggle is a native checkbox, disabled and captioned when the server
  says email is not available** (`NOTIFICATIONS-002`).
  `email_available` ([[0x05-notifications]]) decides, so the frontend holds no
  knowledge of the deployment and nothing needs removing when email is switched on.
  When false, the box still shows the stored position, which most members will see
  ticked because the default is on, and the caption goes through `Field`'s
  `hintText` and `describeField(id, { hint: true })`, so it is the control's
  accessible description. No interaction sends a `PUT`. The optimistic patch
  spreads the previous value, so a write in flight can't lose `email_available`
  and read as unavailable. `.preference > div` wraps so the hint takes its own line
  under the row, and `cursor: pointer` applies only while the box is enabled.
  Native over `role="switch"`: focusable, space-operable and
  readable by assistive technology with no code. Request failures are a
  `role="alert"` beside the field rather than `Field`'s own message slot, which
  is the split `FormField` documents.
- **The page re-decides nothing about who may see it.** `RequireAuth` in the
  route table is the one place that answers that; a second check here would be a
  second answer free to disagree with the first, and its "not signed in" branch
  would be unreachable. `ProfilePage` gates because *its* route is public — this
  one is not.
- **The preference card is there from the first render** (`UI-007`):
  `EmailPreference` renders its loading and failure lines inside the same
  one-row `Card` as the checkbox, so the list below doesn't jump when the read
  lands. To put the checkbox before its label, the page's module CSS turns
  `Field`'s root into a row from inside `.preference` (`.preference > div`).
  That reaches into `Field`'s markup, which `Field` otherwise owns; it is
  scoped to this one card, and a `Field` that grows a checkbox layout of its
  own should replace it.
