# FRONTEND-054: one friendlier 429 line

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

Track 5, deliverable 4 (`Prompts/34`, ADR 0035), and the backlog row "A friendlier
429 message" under "Backend and infra" (origin `POSTS-002`). The row's premise, that
the frontend shows a generic failure on a 429, is out of date. `FRONTEND-026` already
tells a 429 apart on the three posting paths, but with three different sentences:

| Surface | File | Today |
|---|---|---|
| Composer | `features/compose/ComposePage.tsx`, `RATE_LIMITED` | "You are posting too quickly. Your draft is still here — please wait a little and try again." |
| Reply box | `features/compose/InlineComposer.tsx`, the `onError` branch | "You are posting too quickly. Your reply is still here — please wait a little and try again." |
| Repost | `features/feed/PostAction.tsx`, the `RepostRateLimited` branch | "You are posting too quickly. Please wait a little and try again." |

They're pinned in `features/compose/rate-limit.test.tsx` and
`features/feed/repost-rate-limit.test.tsx`.

## Decision (the human's, worded by the Director)

One line, short and calm, the same in all three places, from one shared place:

> You’re going a bit fast. Wait a moment and try again.

- **The apostrophe is U+2019 (’).** `FrontendUI/typography.md` has no punctuation
  rule. The UI text in `frontend/src` writes its contractions and possessives with
  the typographic apostrophe ("this season’s champion", "a team’s name"); one string
  in `AccountSettings.tsx` uses a straight one. The line follows the majority.
- **No "your draft is still here".** The draft and the reply stay visible in their
  boxes, which the existing tests already pin, so the line doesn't need to say it.
  Dropping it is what makes one line fit all three surfaces.
- **No duration, no number** (either of the two windows can trip the 429, and the
  API sends no `Retry-After`); the existing tests that check this stay as they are.
- **Where it lives: `src/lib/messages.ts`**, exporting `RATE_LIMITED_MESSAGE`.
  Compose and feed may not import each other (the connection rule), and both
  already share `src/lib/mediaUrl.ts`, so `src/lib/` is the shared seam.
  `components/` is for rendering parts, not copy. The name is `messages.ts`, not
  `rateLimit.ts`, so a second shared line can join it later. Today there is only one,
  so it holds one constant (YAGNI).

## The unit

- **Red first, one commit** (`test_agent`):
  - `src/lib/messages.test.ts` (new): the exact string, the three imports read from
    disk, and the sweep showing compose and feed have no other 429 sentence (comments
    removed: `feed/api.ts`'s `RepostRateLimited` doc comment says "posting too
    quickly", and that's prose, not UI text), with a non-vacuous guard.
  - `features/compose/rate-limit.test.tsx` and
    `features/feed/repost-rate-limit.test.tsx`: the three local constants give way
    to the imported `RATE_LIMITED_MESSAGE`. That's the change that pins all three
    surfaces to the one string.
  - All three files fail on the missing module. That's the red reason.
- **Implementation** (`code_agent`): `src/lib/messages.ts` (new), and the three call
  sites.
- **Docs** (`context_maintainer`): `0x08c-frontend-compose.md`'s 429 bullet and
  `0x08-frontend.md`'s `src/lib/` row.

## Existing tests this unit changes, and why

A wording change is a behaviour change, so the two tests that pin today's wording
change in the red commit, and only where they spell the sentence: the three
constants and the header line that says the wording is asserted there. Every case
and every other assertion stays, including the generic failures, which this unit
must not touch.

## Running beside FRONTEND-055

FRONTEND-055 (the profile's "1 follower") runs at the same time. It writes only
`features/profile/ProfileSummary.tsx`, its own new test file in
`features/profile/` and `0x08b-frontend-auth.md`. Each unit forbids the other's
paths. Neither declares a bundle output. The Director prototyped both separately
against the folded base: this one moves `ComposePage` by -19 B and the entry by
-5 B gzip; FRONTEND-055 moves `ProfilePage` by +9 B. All are inside the 100 B
tolerance, so together they are too.

## Traps

- `prettier --write` on named files only: a glob also matches committed tests.
- Type the ’ as the character, not `’` in one file and a straight quote in
  another. The test compares the exact string.
- The sweep removes comments before it matches. Don't edit `feed/api.ts` to make it
  pass; it isn't in the allowed paths.
- Run the frontend suite alone, in the foreground, sharded. A killed suite proves
  nothing.

## For the Director after merge (not unit-writable)

- **`TODO/02-backlog.md`**: delete the "A friendlier 429 message" row, and note that
  its premise ("treats every non-2xx alike") was stale since `FRONTEND-026`.
- **FrontendUI** (deliverable 8's PR): `typography.md` has no rule for apostrophes
  and quotes. Record the typographic ’ the UI already uses (one exception:
  `AccountSettings.tsx`'s "this account's verification status"), or decide
  otherwise.
- **Browser check**, the last criterion.
