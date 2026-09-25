# fanwire — Phase 5b Manager Agent Brief: Feed, notifications, search, and the first full-pass summary

> **Status 2026-09-25: superseded as a process. Still correct as facts.**
>
> Units 5–7 here are `FRONTEND-005`, `FRONTEND-006` and `FRONTEND-007` in
> `.ai/tasks/`. Read [`frontend-build-handoff.md`](frontend-build-handoff.md)
> for how the pass is actually being run.
>
> Its constraints survive intact in those specs and are worth reading here for
> the reasoning: the Composite `PostNode`, the `LiveScoreTickerDecorator`, the
> instruction **not** to build `PinnedPostDecorator` (no backend field marks a
> post pinned), and the business rule that the sports-data UI has **no
> free-text input** — which `FRONTEND-007` pins as the absence of every
> `textbox` and `searchbox` role.

You are the **manager agent** for the second half of `fanwire`'s frontend pass, and the last pass of the first full build. You delegate, review, integrate, enforce TDD and the connection rule, and keep the wiki current. Same operating model and settled facts as `wiki/GeneralContext/Prompts/phase-5a-frontend-manager-agent.md`: read its "Settled facts", "TDD and verification" and "Hard constraints" sections and apply them unchanged. Also read the Status note 5a left at the top of its file.

## Before anything else
Confirm with `git merge-base --is-ancestor` that 5a's units actually reached `main`; don't trust PR state alone. Branch each unit off `main`. If 5a left anything unfinished (its Status note says what), finish that first as its own unit.

## Read first, then load just-in-time
- The 5a brief's list, plus `gof-patterns.md` Composite and Decorator only
- Per unit:
  - `0x06-feed.md` (the `PostView`/`FeedPage`/`ThreadView` contract, live-score window)
  - `0x05-notifications.md`
  - `0x07-search.md`: it has **two distinct mechanisms**, and the business rule forbids a free-text search bar for sports data

## Units, sequential, one branch and PR per unit, based on `main`
5. **Feed.**
   - `GET /feed` with infinite scroll on `next_before_id`. Guest (no token) and personalized variants use the same component; the API picks the strategy, and the UI never branches on it.
   - **Composite**: a single `PostNode` interface renders a post and a thread uniformly at any depth. `GET /feed/thread/{id}` returns root + direct replies; deeper levels expand lazily by calling it on a reply.
   - **Decorator**: `LiveScoreTickerDecorator` wraps a post view when `live_scores` is non-empty. `PinnedPostDecorator` is in the GoF doc, but no backend field marks a post pinned, so **don't build it** (YAGNI). Record that in the wiki.
   - Like/unlike (optimistic), reply and repost entry points into the compose unit.
   - Media renders from the public-media keys. The URL base comes from `VITE_MEDIA_BASE_URL` (prod `/media` via CloudFront; dev per the human-input checklist). Fall back to no image rather than a broken one.
6. **Notifications.**
   - `GET /notifications` list; clear via `POST /notifications/{id}/clear` (a soft delete, optimistic).
   - Email-preference toggle via `GET`/`PUT /notifications/preference`.
   - Render follow/reply/repost types, with the actor's username from `GET /users/{id}` cached by react-query.
7. **Search**, as two separate UIs.
   - (a) A free-text search bar on the home page and search tab. It calls `GET /search/accounts` and `GET /search/posts` independently and renders **accounts first, then posts**, each with its own "load more" (`next_offset`). Post results render through the feed unit's Composite components.
   - (b) A sports-data **filter control with no text input**: season dropdown from `GET /search/games/filters`, team dropdown from `GET /events/teams`, position from `filters.positions`. It calls `GET /search/games`. Test explicitly that there's no free-text input on the sports-data UI.

Verification per unit is exactly as in 5a, including the real-browser golden path plus one edge case against `backend-dev` + seed data. Say plainly what couldn't be verified.

## Definition of done: the first full pass
- All seven frontend units merged or open with green gates; the frontend wiki section is complete.
- **Final summary to the human, covering the whole first full-pass build** (Phases 0–5). Assemble it from the PR descriptions and each brief's Status note, which are the durable records:
  - what shipped;
  - what's still deferred: the Kaggle seed-loader pending the human's dataset download, `cdk deploy` pending IAM review, the domain purchase, the infra idle-cost-vs-$20-budget decision, and every "Open decisions" entry still open in any `0x0N` file;
  - which wiki files changed.
- A **rolled-up process-outcomes report** across all phases:
  - which of the *original* first-pass brief's constraints actually caught a real bug or violation. Known examples: the connection rule (repeated narrow cross-module reads), TDD ordering, and security review (the DOB leak, the access-token acceptance);
  - which constraints were never exercised;
  - every place prose rules failed and a technical gate would have caught it. Known examples: stacked PRs merged top-down never reached `main`; lint debt accumulated because ruff wasn't in CI; parallel worktrees collided on docker ports.

  That combined view decides which `rules`-branch items become real gates next (CI, hooks, permissions), per the project's standing preference that rules be technically enforced, not prose.
- Update this file's top with a Status note when done.
