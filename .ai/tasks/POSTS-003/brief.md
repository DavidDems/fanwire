# POSTS-003 — a spam score with teeth

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

`SpamScoreCheck` is wired against `FakeSpamScorer(0.0)` as the production
default, so it never refuses anything. **Decided by the human (2026-10-19,
`wiki/GeneralContext/Architecture/human-decisions.md` §8): deterministic
heuristics, no model call.** Deliverable 2 of the (deleted)
`Prompts/08-production-hardening.md`, now run from
`wiki/GeneralContext/Prompts/17-production-hardening-finish.md`.

**Run this after `POSTS-002` merges**, cut from the `main` that contains it.
Both units edit `moderation.py`, `dependencies.py`, `settings.py`,
`tests/posts/test_dependencies.py` and `0x03-posts.md`.

## The scoring, and why these numbers

The score is the sum of three parts, capped at 1.0, against a threshold of
0.8 (the value `_SPAM_SCORE_THRESHOLD` already holds):

| Signal | Score |
|---|---|
| 1 link / 2 links / 3 or more | 0.3 / 0.5 / 0.8 |
| A run of 20+ of the same non-whitespace character | 0.5 |
| Account younger than 24 hours, and the post has a link | 0.5 |

What that means in practice:

- **Three links refuse a post on their own.** A fan sharing a highlight posts
  one link, sometimes two. Three is a link dump.
- **A long run alone never refuses.** "LETS GOOOOOOOOOOOOOOOOOOOO" is how fans
  write. A run with a link is the classic spam shape, and that refuses.
  20 rather than 10 because a 10-letter cheer is common.
- **A new account cannot post a link in its first 24 hours.** Sign up, post
  a link, leave is the commonest bot pattern, and the cost to a real new fan
  is one day's wait to share a URL. The age is a setting, so it can be
  shortened without a code change.

The weights are constants in the scorer, named and commented. Only the
threshold and the new-account age are settings (YAGNI: nobody tunes the
weights per environment).

## The design

- **Widen the interface, not the chain.** `SpamScorer.score(context:
  ModerationContext) -> float`. The author id is already in the context, and
  the scorer needs it for the account age. `SpamScoreCheck` passes the
  context through. Update `FakeSpamScorer` to the new signature.
- **The account's age is users/' to give.** Add
  `account_created_at(session, user_id) -> datetime | None` to
  `app.users.service`, next to `get_public_profiles`: it returns `None` for an
  unknown or soft-deleted user, the same exclusion rule. The scorer takes it
  as an injected callable, `Callable[[int], datetime | None]`, which
  `get_moderation_chain` binds to the request's session. This follows the
  connection rule (`0x00-architecture.md`). `posts/` importing the `User` model
  is for foreign keys only and is not a licence to read its columns.
- **Fail safe on `None`.** An unknown author is treated as a new account. It
  cannot happen through the routes, which require a signed-in user, so it only
  guards the interface.
- **An injected clock.** `now: Callable[[], datetime]`, timezone-aware UTC.
  Tests pin it.
- **No fake left in production.** After this unit the chain built by
  `get_moderation_chain` holds only real checks. Pin that with a test that
  follows `_next` from the head and asserts no link, and no scorer or limiter
  inside a link, is a `Fake*`. The fakes stay in `moderation.py` as test
  doubles (`FakeMalwareScanner` precedent). Rewrite the
  `app.posts.dependencies` docstring: the "judgment call" it records is over.
- **Fail fast.** `spam_score_threshold` (a float with `gt=0, le=1`) and
  `spam_new_account_hours` (`PositiveInt`) in `Settings`. A bad value fails
  `Settings` construction. Drop `_SPAM_SCORE_THRESHOLD` from
  `dependencies.py`.

## Traps

- **Existing tests whose posts contain links or long runs**, or that create a
  user and post a link straight away, will start getting 400s. Find them in
  the test commit (grep `backend/tests/` for `http`, `www.`). Give each an
  account older than 24 hours, or override the chain, rather than weakening
  the default.
- Test fixtures create users with `created_at` = `now()`. Every test user is
  therefore a new account, and any fixture post with a link now trips the
  new-account rule.
- `account_created_at` gets its own tests in `backend/tests/users/`, including
  the soft-deleted case.

## Not in this task

A model-based scorer, a per-word block list beyond `ProfanityFilter`, scoring
images, rate limits (`POSTS-002`), any frontend message, and any infra
change.
