# fanwire — Phase 4 Manager Agent Brief: Frontend + CDK Infra

## Status: IN PROGRESS (resumed 2026-09-18). A resumed manager session reads this section first.

**Landing fix (2026-09-18):** PRs #2–#12 were each merged into their *parent* branch top-down, so none of Phases 1–3a reached `main`. Only `phase-2-posts-routes` held the full backend. Branch `land-phases-1-3` = `phase-2-posts-routes` + a merge of `main`, opened as a single PR into `main`. Every later branch stacks on it. **Merge stacked PRs bottom-up (the one based on `main` first), or turn on GitHub's "Automatically delete head branches"** so dependent PRs retarget to `main` on their own.

### Decisions (answered by the human 2026-09-18; recorded in the wiki where noted)
1. **Egress**: use a cheap **NAT instance** (not a NAT Gateway, which stays rejected). Recorded in `wiki/CodeContext/Standards/aws-stack.md`.
2. **Interface VPC endpoints in a single AZ**: acceptable. Recorded in `wiki/CodeContext/Standards/aws-stack.md`.
3. **Local/dev auth must be real**, not an emulator or an in-house fake. A human-created **dev Cognito user pool** (free tier) that local dev and browser testing point at. Setup instructions: `wiki/GeneralContext/Architecture/dev-auth-setup.md`. The backend's real `CognitoTokenVerifier` verifies against it unchanged.
4. **DOB is private**: never on public profiles, only on `GET /users/me`. Recorded in `wiki/CodeContext/Modules/0x01-users.md` (users-me unit).

The original questions and answers are kept below for provenance.

### Why the plan changed
This brief assumed Phases 0–3 were done. They weren't: `notifications/` (#12) and `CachedEventProxy` (#11) shipped, but **`feed/` and `search/` were never built**, and #11/#12 were sibling branches off `phase-2-posts-routes`, not stacked. So the manager is closing Phase 3 first as preliminary units, following the Phase 2a/`CachedEventProxy` precedent, before any frontend work.

### Branches and where the work lives
| Branch (on origin) | What | State |
|---|---|---|
| `phase-3-users-me` | Merge of #11 into #12 (commit `360ee40`), then the `users/` gap unit: `GET/PATCH /users/me`, `GET /users/me/following`, `get_optional_current_user`, read helpers for feed/search, **PII fix** (public `GET /users/{id}` was returning `date_of_birth`) | Subagent was running when paused; check `git log origin/phase-3-users-me` |
| `phase-4-infra` | Full CDK app in `infra/`, based on `phase-3-notifications`, parallel track | Subagent was running when paused; check `git log origin/phase-4-infra` |

Subagent worktrees are under `.claude/worktrees/` (`git worktree list` shows which branch each holds). An interrupted subagent's committed work is safe on its branch. Per Phase 2's provenance note, resume from the worktree rather than restarting.

### Remaining plan (in order)
1. Review/verify `phase-3-users-me` (docker backend-test, ruff, pip-audit, connection rule), then open its PR (base `phase-3-notifications`; note in the description that it includes the #11 merge).
2. **`feed/`** unit (not dispatched yet, per human instruction). Contract: `GET /feed?before_id=&limit=` (≤50, keyset pagination by post id). Guest (no token) gets the most-recent-posts-globally strategy; authenticated gets reverse-chron from follows + preferred-team `EventMention`s. `FeedRankingStrategy` (Strategy), one concrete strategy plus the guest one. Response items are a `PostView` (post fields + author `{id, username, profile_picture_media_id}` + `like_count` + `liked_by_viewer` + processed media keys + mentioned game ids + optional live scores via `CachedEventProxy`). Everything is read through narrow public read functions in the owning modules, never their tables. Live-score failures degrade to "no score" and never fail the feed. `Game` has no status column, so "live" means a game dated within the last ~4h. Skip posts by soft-deleted authors.
3. **`search/`** unit. `GET /search/accounts?q=` and `GET /search/posts?q=` (two independently paginated sections; the UI shows accounts first), `GET /search/games?season=&team_id=&position=` (plain filters, no free text). `tsvector` as `GENERATED ALWAYS ... STORED` + GIN, **declared in the owning models** (users/, posts/) with search functions exposed there. `search/` stays table-less orchestration. Post results reuse feed's `PostView` assembler.
4. Frontend units 1–7 per this brief, sequential, each on top of `search/`. Commit `backend/openapi.json` and add a CI check that it's current.
5. Review the infra PR, write the final whole-build summary and process-outcomes report.

### Decisions needed from the human
1. **No-NAT vs. external calls (real topology contradiction).** Lambdas must sit in the VPC to reach RDS, and NAT Gateway is rejected. As documented, the ingestion Lambda therefore can't reach API-SPORTS and the API Lambda can't fetch Cognito's JWKS. The infra subagent was told to investigate (IPv6 egress-only IGW, Cognito interface endpoint, splitting the fetch outside the VPC) and flag its pick. Your call on the final answer; a cheap NAT *instance* (~$3/mo, not a NAT Gateway) is also an option.
   > _your answer: We can go ahead and use a cheap NAT instance on AWS.
2. **VPC interface-endpoint cost.** ~$7/mo each per AZ against the $20/mo org budget. Is single-AZ endpoints acceptable?
   > _your answer: Yes it is acceptable
3. **Local auth for browser testing.** No real Cognito pool exists (no deploy), so the frontend login flow can't be clicked through against AWS. Plan: run `cognito-local` (a Cognito emulator) in docker-compose, with the backend's JWKS URL/issuer made configurable. Fallback if that doesn't work: a dev-only fake auth adapter guarded fail-fast to local env. OK?
   > _your answer: I would like to setup some type of real auth system, I can be given instructions to register for free third party auth services or even a paid AWS one if its available. But a fake in-house developed auth system seems like too much of a shortcut.
4. **DOB removed from public profiles.** Only `GET /users/me` returns it. Confirm that's the intended privacy rule.
   > _your answer: Yes date of birth shouldn't be shown on public profiles, only held by our DB after registration.

### Coordination points already found (for the process-outcomes report)
- CloudFront `/api/*` → API Gateway must strip the `/api` prefix (FastAPI routes have none). This was pinned to the infra agent as a cross-track contract, so frontend and infra were **not** fully independent.
- `dynamodb-local` holds host port 8000 (uvicorn's default), so the local backend dev server needs another port (e.g. 8001).
- The CDK IAM rule "no `*` in Action" forbids CDK `grant*()` helpers, which emit wildcard actions. The infra agent is enforcing it with a jest test walking every synthesized policy, which is a candidate real technical gate.
- Backend Lambda entrypoints for ingestion, media-processing and the notification consumer don't exist yet. Infra references them by name only.

You are the **manager agent** for the fourth and final implementation pass of `fanwire`'s first full build. Same operating model as `wiki/GeneralContext/Prompts/first-pass-manager-agent.md`, `wiki/GeneralContext/Prompts/phase-2-manager-agent.md`, and `wiki/GeneralContext/Prompts/phase-3-manager-agent.md` — skim all three once, particularly each one's "Process outcomes" section, before you start; don't re-derive what they already settled. You delegate each unit to a subagent, review/integrate, keep TDD (where it applies — see below, frontend and infra have different verification shapes than a pure-Python backend module) and the connection rule enforced, keep the wiki current. You do not write most of the code yourself.

## State when you start

Phases 0–3 are done: full backend (`events/`, `users/`, `media/`, `posts/`, `notifications/`, `feed/`, `search/`), all wired into `app.main` with a live OpenAPI schema. **Before anything else**, run `gh pr list` and `git branch -r` to find the actual current tip of the stack — branch off whichever PR is the latest unmerged one, or off `main` if everything's landed. Don't assume a branch name; check.

Read the Phase 2 and Phase 3 managers' final reports (or their PRs' descriptions if the reports themselves weren't preserved anywhere durable) for what routes actually exist and what judgment calls were made along the way — your frontend work depends on the real shape of the backend, not this brief's assumptions about it.

## Two genuinely independent tracks — this phase, unlike the last three, really can parallelize

Frontend (`frontend/src/`) and CDK infra (`infra/`) share no files, no dependencies, and no runtime coupling — infra doesn't need any backend code to exist (it needs the *topology* in `wiki/CodeContext/Standards/aws-stack.md`, not the app), and frontend needs the backend's OpenAPI schema (already live by the time you start) but nothing from `infra/`. Every prior phase in this project assumed independence and then found a hidden shared integration point (Phase 1's FK chain, Phase 3's possible `CachedEventProxy` dependency) — verify this one holds before trusting it, but if it does, this is the one place in the whole build actually worth running two real parallel subagent tracks rather than sequencing out of caution. Use the `Agent` tool's `isolation: "worktree"` option for each track (frontend and infra each get their own git worktree) so they don't clobber each other in a shared working directory — don't run them in the same directory concurrently even if you're confident they're independent; that's genuinely unsafe regardless of code-level independence, since both would be committing to the same `.git` at once.

## Frontend track

### Read first, then load just-in-time
`AGENTS.md`, `wiki/GeneralContext/index.md`, `wiki/CodeContext/Standards/aws-stack.md`'s "Frontend" section, `wiki/CodeContext/Standards/design-principles.md`, `wiki/CodeContext/Standards/gof-patterns.md` (Builder, Prototype, Composite, Decorator, Mediator, Memento sections — these are frontend-side patterns per the reference doc: `PostBuilder`, `PostTemplate.clone()`, `ComposeMediator`, `DraftSnapshot`). Then, per module-aligned unit, the same backend module file(s) that unit's UI surfaces (e.g. the auth unit reads `wiki/CodeContext/Modules/0x01-users.md` for what fields/flows exist, not to reimplement them, just to know the contract).

### Units (module-aligned to the backend phases, not built monolithically at the end)
1. **Typed API client**: `npm run gen:api-types` (already wired in `frontend/package.json`, targets `../backend/openapi.json`) against the live backend schema — you'll need the backend actually running (or its OpenAPI JSON exported to a file) to generate against; don't hand-write types that duplicate it.
2. **Auth** (Cognito, via `amazon-cognito-identity-js`) — sign-up, confirmation, login, forgot-password, token storage/refresh, wired to call whatever profile-creation endpoint Phase 2 built.
3. **Profile/follow** — view/edit own profile, view others', follow/unfollow.
4. **Compose flow** — `PostBuilder` (Builder: assembles a `Post` from text/media/mentions across the multi-step compose UI), `ComposeMediator` (Mediator: coordinates the text box, mention-autocomplete dropdown, media-upload widget without them referencing each other directly), `DraftSnapshot` (Memento: rollback point before a risky action like attaching live event data), `PostTemplate.clone()` (Prototype: quick-post templates). Media upload flow talks to `media/`'s presigned-URL endpoint directly from the browser to S3 (never proxying the file bytes through the FastAPI app) — confirm that's actually how Phase 2 built it before assuming it.
5. **Feed rendering** — authenticated + guest variants, `PinnedPostDecorator`/`LiveScoreTickerDecorator` (Decorator, from the GoF reference doc) if a post needs pinned styling or a live score badge; `Post`/`Thread` rendered via one shared interface (Composite) regardless of reply depth.
6. **Notifications UI** — list, clear (soft-delete), email-preference toggle.
7. **Search** — the two distinct UIs per `wiki/CodeContext/Modules/0x07-search.md`: a free-text search bar (accounts-first-then-posts) and a separate year/team/position filter control for sports data (**not** a search bar — the business rule explicitly rejects one there).

### What "TDD" means here
Same spirit, adapted: a failing `vitest`/`@testing-library` test against the intended component behavior, committed alone, then the component, committed separately. `msw` mocks the API at the network layer (already in `package.json`) — tests exercise the real generated API client, never a hand-mocked one.

### Verification before accepting a unit
`docker compose run --rm --build frontend-test`, plus direct `npm run typecheck`, `npm run build`, `npm run lint` — same four-check discipline the backend phases used. Per the repo-wide instruction to actually use the feature in a browser before calling UI work done: run `npm run dev` and click through the golden path (and at least one edge case) for whatever you just built, not just green tests — say explicitly in your report if you could not do this for some reason, don't claim it if you didn't.

## Infra track (CDK, TypeScript, `infra/`)

### Read first
`wiki/CodeContext/Standards/aws-stack.md` (full topology), `wiki/CodeContext/Modules/0x00-architecture.md`'s "AWS topology" and "AWS account state" sections (what's actually live today — org structure, SSO, CloudTrail, Config, GuardDuty are real; `GitHubActionsDeployRole` has zero permissions, by design), `wiki/CodeContext/Standards/security.md` (every requirement here is a hard gate on the IAM policy/network topology you write, not a suggestion), `wiki/CodeContext/Standards/build-deployment.md` (container/CI wiring, already partly built in Phase 0 — infra doesn't change that, just adds the deploy-time pieces it references).

### Domain — settled, not yet live
The project will serve the frontend and API at **`fanwire.daviddems.ca`**. The human has not purchased `daviddems.ca` yet as of this brief being written — build the Route 53/ACM/CloudFront pieces parameterized by a domain name (a CDK stack prop or context value, not a hardcoded string), so the stack is correct whether or not the zone exists yet, but **do not** assume the hosted zone is delegated/live. `cdk synth` must succeed regardless (it doesn't need the zone to actually resolve); `cdk deploy` is out of scope this phase either way (see below), and would additionally be blocked on the domain being owned and delegated even once the IAM gate clears.

### What to build
Every resource in `wiki/CodeContext/Standards/aws-stack.md`: VPC (no NAT — Lambda reaches RDS via VPC, AWS services via VPC endpoints), RDS Postgres (`db.t4g.micro`), DynamoDB (idempotency table + `CachedEventProxy`'s live-score cache, on-demand), S3 (quarantine, public-media, frontend-static — three separate buckets, quarantine never behind CloudFront), Cognito User Pool (matching whatever `users/`'s actual JWKS/audience/issuer config expects — read `app/users/auth.py`/`app/settings.py` for the exact values the app needs to line up with), EventBridge bus (`PostEventBus`) + Scheduler (sports ingestion), SQS + DLQ per consumer queue (notification fan-out, ingestion retries), CloudFront (frontend bundle + API Gateway origins, the *only* public entry point), WAF (Managed Rule Groups + rate-based rule) attached to that CloudFront distribution, GuardDuty Malware Protection for S3 on the quarantine bucket specifically (org-level GuardDuty is already live per the architecture doc — this is the S3-specific feature, not a duplicate), CloudTrail/Config (already live at the org level — confirm your stack doesn't try to re-create what already exists, just wire whatever's stack-specific), KMS customer-managed key (for anything containing customer data — RDS, S3 SSE-KMS, DynamoDB), Secrets Manager (API-SPORTS key, DB credentials, Cognito app client secret if applicable).

### Hard constraints specific to this track
- **`cdk synth` must succeed. `cdk deploy` is explicitly out of scope** — don't run it, don't wire it into any CI job that runs automatically, and don't ask a subagent to run it "just to check." The `GitHubActionsDeployRole` has zero permissions by design until a human reviews the IAM policy your stacks generate; that review happens *after* this phase, not as part of it.
- **Least privilege, no `*` in Action/Resource** in any IAM policy you write, ever — this is the exact thing the human review gate exists to check, so don't hand them a policy that fails the standard on its face.
- **No NAT Gateway, no ALB, no ElastiCache, no third-party hosting** — `wiki/CodeContext/Standards/aws-stack.md`'s "Explicitly rejected at this scale" section is a hard constraint, not a suggestion to reconsider because it'd be simpler.
- One shared Lambda container image for all three backend Lambdas (api/ingestion/media-processing), per `wiki/CodeContext/Standards/build-deployment.md` — don't build three images.

### Verification before accepting a unit
`npm run synth` (wraps `cdk synth`) succeeds with no errors for every stack. `npm run build` (tsc) and `npm test` (jest, for any unit tests you write against construct props/counts — CDK's own assertions library, `@aws-cdk/assertions` or the `aws-cdk-lib/assertions` module, is the idiomatic way to unit-test a stack's synthesized template without deploying anything) both pass. Do **not** attempt `cdk diff` or `cdk deploy` against a real account — there is no real account access available to this session's CI identity regardless (see above), and even if there were, it's out of scope.

## Definition of done for this pass

- Frontend builds, its test suite passes, and you have manually verified (in a real browser, `npm run dev`) at least the golden path for each unit above — say plainly if any unit couldn't be manually verified and why.
- Every CDK stack in `wiki/CodeContext/Standards/aws-stack.md`'s topology exists and `cdk synth` succeeds for all of them, with no deploy attempted.
- The domain is wired as a parameter, not hardcoded, and its not-yet-purchased state doesn't block `synth`.
- One PR per unit (frontend units module-aligned as listed; infra can be one PR per logical stack group, or one PR for the whole `infra/` track if the stacks are small/interdependent enough that splitting them would be artificial — your call, document why).
- Final summary to the human covering **the whole first full-pass build**, not just this phase: what shipped across all four phases, what's still explicitly deferred (the Kaggle seed-loader pending the human's dataset download, real `cdk deploy` pending IAM review, the domain purchase, anything else still open in any module's wiki file), which wiki files changed, and this phase's **process-outcomes report** (below) plus a rolled-up view across all four phases' process-outcomes reports if you can find them (PR descriptions are the durable record if nothing else captured them) — that combined view is what actually decides which `rules`-branch items are worth turning into real technical gates now that a full build has happened once.

## Process outcomes — required in the final summary

Same ask as every prior phase. Specifically also report: did frontend/infra actually stay independent enough to parallelize via worktrees, or did something (a shared env var, a naming convention, a port conflict) force coordination anyway? And separately: now that a full backend + frontend + infra pass exists once, end-to-end — which of the *original* first-pass brief's constraints turned out to matter in practice (caught a real bug/violation) versus which ones never actually got tested because nothing violated them? That distinction is exactly what should drive which `rules`-branch items get real enforcement next, versus which ones can stay as documentation because nothing in four phases of real work ever needed the backstop.
