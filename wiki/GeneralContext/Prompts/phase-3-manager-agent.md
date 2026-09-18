# fanwire — Phase 3 Manager Agent Brief: notifications/, feed/, search/

You are the **manager agent** for the third implementation pass of `fanwire`. Same operating model as `wiki/GeneralContext/Prompts/first-pass-manager-agent.md` and `wiki/GeneralContext/Prompts/phase-2-manager-agent.md` (skim both once for the operating model/patterns/constraints and, importantly, the second one's "Process outcomes" answer about the Phase 2 routes work — don't re-derive any of this, and don't repeat a mistake it already flagged). You delegate each unit to a subagent, review/integrate, keep TDD and the connection rule enforced, keep the wiki current. You do not write most of the code yourself.

## State when you start

Phases 0–2 are done: scaffold, `events/`, `users/`, `media/`, `posts/` (plus the Phase 2a routes-gap closure). **Before anything else**, run `gh pr list` and `git branch -r` to find the actual current tip — branch your work off whichever PR is the latest unmerged one in the stack, or off `main` if everything's landed by the time you start. Don't assume a branch name; check.

Also check, and read if present, whatever the Phase 2 manager agent's final report recorded about: (a) whether the "routes gap" fix from its brief revealed more missing plumbing than expected, and (b) any judgment calls it made on the mention-resolution/quote-repost/moderation-chain open decisions — you'll be building `notifications/`'s `PostEventBus` subscriber against whatever `posts/` actually publishes, so read the real code, not just this brief's assumptions about it.

## Read first, then load just-in-time

Read `AGENTS.md` and `wiki/GeneralContext/index.md` yourself if you haven't already this session. Then, per unit:
- **`notifications/`**: `wiki/CodeContext/Modules/0x05-notifications.md` (primary spec), `wiki/CodeContext/Standards/gof-patterns.md` (Factory Method, Observer, and the "Bridge — deliberately not applied" note — don't build a Bridge hierarchy, the wiki explicitly argues against it at current scope), `wiki/CodeContext/Standards/security.md` (PII-in-logs / server-side authZ bits).
- **`feed/`**: `wiki/CodeContext/Modules/0x06-feed.md` (primary spec — note it owns no tables), `wiki/CodeContext/Standards/gof-patterns.md` (Strategy section only).
- **`search/`**: `wiki/CodeContext/Modules/0x07-search.md` (primary spec — also owns no tables), `wiki/CodeContext/Standards/security.md` (injection-safety section).
- All three: `wiki/CodeContext/Modules/0x00-architecture.md` Connection rule + the `PostEventBus` conventions note (it's not `posts/`-exclusive despite the name).
- Pull in `wiki/CodeContext/Modules/0x01-users.md`, `0x02-events.md`, `0x03-posts.md` only for the specific FK/interface shapes each unit touches (`User.preferred_team_id`, `Follow`, `Post`/`PostLike`/`EventMention`, `Game`/`Team`) — never their full internals, same discipline as every prior phase.

## Carried-forward lessons (don't rediscover these)

- Docker/testcontainers/ruff/pip-audit notes from `wiki/GeneralContext/Prompts/phase-2-manager-agent.md`'s "Carried-forward lessons" section all still apply verbatim — re-read that list once, don't paste it back into your own subagent prompts from memory, just point subagents at the actual files/config that already encode it (`docker-compose.yml`, `backend/pyproject.toml`'s ruff section, the standing `pip-audit --ignore-vuln PYSEC-2026-1325`).
- `feed/` and `search/` own **no tables** — resist any subagent's urge to invent one (a materialized feed table, a search-results cache) unless you have a concrete reason that overrides the wiki's explicit YAGNI stance on both. If a subagent proposes one, that's a sign to re-read the relevant "Open decisions"/GoF-tie-in section before agreeing, not a reason to approve it because it seems more efficient.
- Watch for the same kind of hidden interdependency Phase 1 found between `users/`/`media/` (circular FKs) and Phase 2 found between `posts/` and both of those (deferred FKs closing late): `notifications/`'s `reference_id` column is explicitly an *unenforced* polymorphic reference by the wiki's own recommendation (Postgres can't FK one column to two different tables) — don't try to force a real FK there, that's not a gap to close, it's the documented design.

## Hard constraints — non-negotiable

Same as every prior phase: TDD (failing test alone, then implementation, never combined), connection rule, patterns as assigned (below), design principles/security baseline on every diff, no live AWS (moto/testcontainers/docker-compose only), wiki stays current, no moderation/reporting scope creep, one branch/PR per unit off the correct current tip, no self-merge.

**Patterns as assigned — don't substitute:**
- `notifications/`: **Factory Method** (`NotificationFactory.create(type)` → `EmailNotification`/`InAppNotification`; no `PushNotification` yet — nothing in the business rules asks for push, don't build the third channel speculatively) and **Observer** (`PostEventBus` subscription — consumes `PostCreated`/`UserFollowed` and distinguishes reply/repost from the event payload's flags per `wiki/CodeContext/Modules/0x03-posts.md`). **Do not build a Bridge** (`NotificationChannel`/`NotificationTransport`) — the wiki argues explicitly against it at this scale; if you think the matrix has grown enough to justify one, say so in your process-outcomes report rather than building it unasked.
- `feed/`: **Strategy** (`FeedRankingStrategy`) — implement exactly one concrete strategy (reverse-chronological from follows + preferred-team-mentions) plus the guest default, per the wiki's explicit "the feed can be simple" / YAGNI stance. The Strategy *interface* should still make a second implementation (engagement-weighted) a clean addition later without touching callers — that's the point of using Strategy here even though only one variant ships.
- `search/`: no GoF pattern owns the `tsvector`/plain-filter query layer itself (the wiki says so plainly) — the only pattern touchpoint is that both `feed/` and `search/` read live scores through the existing `CachedEventProxy` (Proxy pattern, already `events/`'s to own — if `CachedEventProxy` doesn't exist yet because Phase 1's `events/` didn't need it for anything but final scores, that's a real gap: build the minimal version of it now, in `events/`, as a small preliminary unit (same shape as Phase 2's "close the routes gap first" move) rather than reaching around the connection rule to query DynamoDB directly from `feed/`/`search/`.

## Known blockers — flag, don't invent

1. **`reference_id`'s polymorphic-column-vs-type-specific-FKs question** (`wiki/CodeContext/Modules/0x05-notifications.md`): the wiki already recommends the single unenforced column; implement that recommendation (it's not actually "open," it's a documented recommendation awaiting confirmation) unless you find a concrete reason it doesn't hold up, in which case document why you deviated.
2. **Guest-feed algorithm** (`wiki/CodeContext/Modules/0x06-feed.md`): "most-recent public posts globally" is the assumed default: implement it, and resolve the open decision in the wiki rather than leaving it open — same "simplest defensible call" rule as every prior phase's blocker #3.
3. **Search open decisions** (`wiki/CodeContext/Modules/0x07-search.md`): whether `User.description` is indexed alongside `username` (default to yes, it's a reasonable extension per the wiki's own framing), the `tsvector` maintenance strategy (default to a `GENERATED ALWAYS AS (...) STORED` column + `GIN` index — simplest, no trigger to maintain), the exact `player_stats` position field name (confirm against whatever `ApiSportsAdapter`'s actual fixture/sample shape uses — see `backend/app/events/adapters.py`'s illustrative JSON, and flag clearly that this is still illustrative/unverified against a live API-SPORTS response, same caveat Phase 1 already recorded), and the accounts-first-then-posts pagination contract (default to two independently paginated sections, simplest to implement and reason about). Resolve all four in the wiki, don't leave them open by default.
4. The Kaggle seed-loader is still not built. Not your job either — if `search/`'s sports-data filter needs more `Game` rows than your own test fixtures provide to prove it works, that's a test-data problem to solve with more fixture rows, not a reason to go build the seed-loader now.

## Operating model

`notifications/`, `feed/`, and `search/` are the closest thing to genuinely independent units this whole build has had — all three only *read* `posts/`/`users/`/`events/` data (through those modules' interfaces/routes, never their tables directly), none of them write to each other's tables, and none of them share an integration point the way `events/`↔`users/`↔`media/`'s FK chain did. If that holds up once you're actually in the code, this is a legitimate place to run genuinely parallel subagents — but they'd all be editing files in the same shared working directory, so either sequence them (safe default) or use the `Agent` tool's `isolation: "worktree"` option to give each one its own git worktree if you want real concurrency. Your call; the first-pass brief and Phase 2 both ended up forced into sequencing by real hidden dependencies, so verify independence before you trust it here rather than assuming this phase is different just because the brief says so.

Whichever you choose: run each unit's tests (`docker compose run --rm --build backend-test`, direct `pytest`/`ruff`/`pip-audit`) before accepting, check the diff against the connection rule and assigned pattern, then integrate before moving on (or before merging a parallel track back in, if you went that route).

## Definition of done for this pass

- `notifications/`, `feed/`, `search/` each have passing tests, respect the connection rule, implement their assigned patterns (and *only* those — no speculative Bridge, no materialized feed table), and their wiki files' resolved "Open decisions" are updated in place.
- `events/` has a minimal `CachedEventProxy` if it didn't already exist, consumed by both `feed/` and `search/` through the proxy, not DynamoDB directly.
- Routes exist for whatever of this phase's functionality needs to be reachable over HTTP (notification list/clear, feed read, search), wired into `app.main`, reflected in `GET /openapi.json`.
- `docker compose run --rm --build backend-test` and `frontend-test` both still pass.
- One PR per unit, each with a description naming patterns/principles exercised and judgment calls made.
- Final summary to the human: what shipped, what's still open, which wiki files changed, and a **process-outcomes report** (below).

## Process outcomes — required in the final summary

Same ask as every prior phase, same reason. Specifically also report: did `notifications/`/`feed/`/`search/` actually turn out independent enough to parallelize, or did you find a real shared integration point (like the `CachedEventProxy` gap) that forced sequencing anyway? That's directly useful for deciding whether "these three are independent" is a rule worth trusting by default in future passes, or whether every phase in this project just needs to verify it fresh regardless of what a brief assumes going in.
