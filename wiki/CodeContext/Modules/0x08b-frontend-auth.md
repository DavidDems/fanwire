---
type: reference
---

# 0x08b — Frontend: auth and profile

**Agent-facing.** Part of [[0x08-frontend]] (index, cross-cutting contracts).

## Auth (`FRONTEND-002`)

`AuthService` is an interface; `CognitoAuthService` is one implementation of it
and **the only module under `src/` allowed to import the Cognito SDK**. Pages,
hooks and guards depend on the interface, so tests inject a double of it and
never mock the library — a suite that mocked the SDK would pin the mock and keep
passing after the real call signature changed. `src/auth/sdk-isolation.test.ts`
reads the tree from disk and enforces both halves, along with "no module under
`src/auth/` branches on environment". There is one implementation; configuration
differs, code does not, and `App` is the single place that chooses it.

- **`App` is the composition root**: it constructs `CognitoAuthService`, calls
  `installTokenProvider` (which feeds `getIdToken` into `api/client.ts`'s seam,
  re-read on every request so a sign-out lands on the next call), and mounts
  `AuthProvider` *outside* `RouterProvider` — a session does not belong to a
  route.
- **The router is `react-router-dom` 7** (`FRONTEND-016`, 2026-10-20), on
  React 18. Imports keep the `react-router-dom` name, which re-exports
  `react-router` in v7. v7's defaults are v6's `future.v7_*` flags, so none is
  set (`src/test/router-version.test.ts` keeps them out). Not 8: it needs
  React 19 and Node 22.
- **`useAuth().status` has three values**, not two. `"loading"` is distinct from
  `"anonymous"`: collapsing them shows a signed-in user the sign-in page on
  every reload, and the guards render a `role="status"` rather than guess.
- **`GET /users/me` is one shared react-query entry** (`auth/profile.ts`,
  `PROFILE_QUERY_KEY`). Both guards read it, and `ProfileSetupPage` **awaits**
  its invalidation before navigating: `staleTime` is 30s, so the 404 that sent
  the user to the form is otherwise still cached and still believed, and the
  guard bounces them straight back. A guard never requests it without a session.
- **Protected routes include `/compose`, `/notifications`, `/history` and
  `/settings`.** `/`, `/search` and
  `/profile/:userId` stay public — the guest feed and profile views are read
  paths ([[0x01-users]]), and a guard on either is a regression. `/create-profile`
  is behind `RequireNewProfile`, which is what stops it being reachable by
  someone who already has a profile.
- **Cognito failures are translated to an `AuthError` carrying the provider's
  error name**, so a page decides which control a failure belongs on without
  importing the SDK to do it. Two are routing states rather than field errors:
  an unconfirmed account goes to `/confirm`, and a throttled resend is an alert
  about no field at all.
- **Tokens are stored by the SDK's default `localStorage`**, accepted for v1.
  The trade-off is real and is recorded rather than hidden: anything that
  achieves script execution in the page can read the ID token. A cookie backend
  is a separate, larger decision and was deliberately not invented here.
- **Nothing logs or renders a token, the pool id or the client id.** The pool and
  client ids are not secrets — they ship in the bundle — but a token is, and
  `src/auth/no-secret-leak.test.tsx` sweeps all five pages for all three.
- **`date_of_birth` is sent by exactly one page** and is never carried off it.
  The field states in its own hint that it is private; the age gate stays on the
  server (a Pydantic 422 naming `date_of_birth`), surfaced on that field in the
  server's own words rather than re-implemented here, because validating in two
  places is how the two rules drift apart.

## Profile and follow (`FRONTEND-003`)

`/profile/:userId` is **one public route with two variants**, chosen by
comparing the id in the path to the signed-in user's. The own-profile form edits
profile fields; account lifecycle controls live on the separate, guarded
`/settings` page.

- **Date of birth is private, and the component tree is what guarantees it.**
  `OwnProfile` takes `MeOut` (which has the field); `PublicProfile` takes
  `PublicUserOut` (which does not). The one thing they share, `ProfileSummary`,
  takes a username, two counts and the safe avatar rendering keys — **not a
  user object** — so it cannot render a field it was never handed. Since
  `USERS-004` it can render the saved preset or public picture key without
  receiving DOB or any other profile field. Since `UI-008` it also takes one optional
  `action` slot, which `PublicProfile` fills with `FollowButton` so the control
  sits in the header card: a slot for a control, never user data, so the
  guarantee stands. The own profile's date of birth row now says "Only you can
  see this" on screen, not only in a comment. The alternative, one header taking a whole user
  and showing what it finds, is precisely how the backend leaked this field
  before `PublicUserOut` was split off `MeOut` ([[0x01c-users-routes]]), and asserting
  "we do not render it" would have left that shape in place.
- **Three cache entries, and they stay three.** The viewed user is
  `["users", <numeric id>]` — a number, because that is what the path parameter
  is in the generated schema, and `["users", "42"]` is a different entry that
  would refetch on every render without ever looking wrong. The follow set is
  `["users", "me", "following"]`. The caller's own profile stays on
  `PROFILE_QUERY_KEY` from `auth/profile.ts` — this page adds no second
  `GET /users/me`.
- **Invalidation names exact keys.** `queryKey` is a *prefix* match, so
  `invalidateQueries({ queryKey: ["users"] })` would refetch every other profile
  the session has looked at as collateral for following one person. Every
  invalidation here passes `exact: true`.
- **Follow is optimistic through react-query's mutation lifecycle.** `onMutate`
  cancels the two in-flight reads (one landing late would overwrite the patch
  with the answer it was already carrying), snapshots both entries and patches
  them; `onError` restores the snapshot and raises a `role="alert"`; `onSettled`
  invalidates, because the server decides the counts and somebody else may have
  followed them meanwhile. **Rollback restores the follower count, not just the
  button** — those are the two things a user sees change. The count lives in the
  viewed profile's cache entry, which is why local state beside it is not an
  option: it drifts out of sync after the second interaction.
- **The follow set is read by `ProfilePage`, not by the button.** The button is
  the last thing on the page to mount, so owning the query would start it only
  once the profile had arrived, and the button would spend that round trip
  telling someone who already follows them to "Follow".
- **An anonymous visitor sees the control and is sent to sign-in by it**,
  carrying `state.from` the way `routes/guards.tsx` does. No authenticated read
  is issued at all without a session — not the profile, not the follow set, not
  the write — because a 401 here is a failure the page would then have to
  explain away on a route that is deliberately public.
- **`PATCH /users/me` carries only the fields that changed.** The backend reads
  the body with `model_fields_set` semantics ([[0x01c-users-routes]]): a field *absent*
  is left untouched, while a field present as `null` clears it. Sending every
  control on every save would therefore wipe whatever the user did not touch.
  Emptying the description is the one case `null` is correct for — that is the
  user asking for it to be cleared. `username` and `date_of_birth` are not on
  `UpdateMeRequest` and are not editable here.
- **Profile avatars are one persisted choice across surfaces.** The settings
  form offers the eight `users/` preset keys and an explicit initials choice
  in a labelled radio grid; the preview follows the pending choice and a failed
  save restores the persisted one. Own/public profile summaries, feed authors
  and account search render the same key. A processed uploaded picture takes
  priority until the member saves a preset or chooses initials; avatar geometry
  is code-drawn SVG and uses semantic text colours.
- **This unit ships without a profile-picture control.** The upload widget
  belongs to `FRONTEND-004` (`MediaWidget`); a second uploader here would
  be a duplicate media path ([[0x00-architecture]] Connection rule) and would
  need deleting rather than merging. `profile_picture_media_id` is never sent.
- **A profile that is not ready shows `ProfileLoading` (`FRONTEND-033`).**
  React Router navigates in a transition, and React keeps an already-revealed
  Suspense boundary's content during one, so behind `BackgroundRoutes`' shared
  boundary the previous page stayed on screen, with no feedback, until the
  profile chunk arrived. The profile route therefore has a `<Suspense>` of its
  own in `routes.tsx`: mounted fresh by the navigation, it shows its fallback
  at once, on a direct load too. `ProfilePage` renders the same component while
  its data is pending, so the chunk wait and the data wait read as one, and a
  new `:userId` never shows the previous profile. `ProfileLoading` is a
  `role="status"` "Loading this profile…" line under an `aria-hidden` header
  card skeleton (shared `Skeleton` bars, laid out as `ProfileSummary`, so the
  card revealed in its place moves nothing); no heading, no focus movement, no
  animation. It lives in its own module because the route table imports it
  statically and `ProfilePage` must stay lazy. A failed read shows the
  existing alert with HistoryPage's secondary `Retry`, which refetches.
- **`AppLayout` links "Your profile" by id**, because the route has no fixed
  address for "me". It renders only for a visitor who has a profile, and reads
  it through the same shared query gated on the same session the guards use —
  so the shell asks the API nothing until somebody signs in, and never links to
  `/profile/undefined`.
