# FRONTEND-026: a friendlier 429

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

`TODO/02-backlog.md` "A friendlier 429 message". `POSTS-002` made `POST /posts` and
`POST /posts/{id}/repost` answer 429 (`0x03-posts.md` "Rate limiting"), and all three
surfaces still show their generic failure. Still true on `c2a9eda`.

## What the code does today

| Surface | Request | Failure path | Knows the status? |
|---|---|---|---|
| `ComposePage` | `createPost` | `failureMessage(error)` | Yes: `PostNotCreated.status` |
| `InlineComposer` | `createPost` | `onError: () => …`, ignores the error | Available, not read |
| `TogglePostAction` (repost) | `setReposted` | a fixed string | No: a plain `Error` |

`createPost` needs no change. `setReposted` needs a typed error on its POST path only.

## Decision for the Director (recommended, not recorded anywhere)

Exact wording. Recommended, following the existing "We could not … — please try
again" pattern, with no contractions and no duration:

- Compose: "You are posting too quickly. Your draft is still here — please wait a little and try again."
- Reply: "You are posting too quickly. Your reply is still here — please wait a little and try again."
- Repost: "You are posting too quickly. Please wait a little and try again."

No number, because either window can trip it: "a minute" is wrong at the hourly limit.

## Traps

- **`TogglePostAction` is shared with Like.** A like can only see a 429 from the edge
  (the API stage throttle), and "posting" would be wrong there. Same for undoing a
  repost. Only `setReposted`'s POST branch raises the new class. Keep its message
  text as it is: it goes in no alert, and `api.test.ts` may read it.
- **An edge 429 has a different body.** `createPost` already survives that through
  `detailOf`. Pin an empty body anyway.
- **Quote reposts go through `ComposePage`**, plain reposts through the toggle. Cover both.
- **`features/feed` must not import `features/compose`.** Three short strings in two
  features is fine; a shared module would be a new boundary for this.
- `.failure` has `flex-basis: 100%`, so a longer message takes its own line. Check it
  in the browser row rather than assuming.

## Test-first

New files, so existing suites stay untouched: `compose/rate-limit.test.tsx` and
`feed/repost-rate-limit.test.tsx`, with inline msw handlers for the 429. Each 429 case
is red because the generic message renders. Assert the exact recommended string, or
whatever the Director settles on, so a wording change is a deliberate test edit. The
"other statuses" and like/DELETE cases are green in the test commit, as protection:
say so in its message. Only a test seeing the generic message is a right red; a msw
`onUnhandledRequest` error is a broken test.

## Browser

Browser rows are heavy work and need the heavy lock. They use a signed-in account,
so: local test accounts, localhost only, a Track B port 5210-5219 with `--strictPort`.
Produce the 429 with `page.route`; do not post ten times to hit the real limit.

## Later Director PR, not this spec

The backlog row. Nothing in `FrontendUI/` needs to change.
