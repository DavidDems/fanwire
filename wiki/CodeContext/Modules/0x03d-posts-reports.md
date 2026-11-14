---
type: reference
---

# 0x03d — Posts: Report

**Agent-facing.** Part of [[0x03-posts]] (index: module scope, the facade, moderation chain and event bus).

## Report
The **only** reporting-related table for v1, per [[wiki/GeneralContext/Architecture/business-rules|Projects]]'s closing line ("no moderation or reporting for now, only a reported flag on posts with a table for all reported cases"). No justification text field, no status/workflow field — see [[0x00-architecture]] for the broader "moderation chain not built for v1" statement.

**Schema**
- `id` — PK.
- `post_id` — FK → `posts.Post`.
- `reporter_id` — FK → `users.User`.
- `created_at` — timestamptz.
- Unique constraint on `(post_id, reporter_id)` — one report per user per post; re-submitting is a no-op, not a duplicate row.
- `Post.reported` ([[0x03a-posts-post]]) is set true on the **first** `Report` row for that post and is never unset — there's no review step for it to be cleared by, by design (no moderation workflow).

**Design principles**
- **Idempotency** — the unique `(post_id, reporter_id)` constraint makes reporting the same post twice safe to retry, matching [[wiki/CodeContext/Standards/design-principles|Design principles]]'s idempotency rule.
- **KISS/YAGNI** — no status enum, no justification field, no assignee/reviewer field: none of that is called for by the current business rule, and adding it would be speculative.

**Pattern tie-in**
- None of Composite/Interpreter/Facade apply. Note explicitly: [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]]'s `ReportPostCommand` (with `execute()`/`undo()` for a moderation audit trail) is **not implemented** — there's no moderation flow for it to undo into. `posts/` still publishes `PostReported` on the `PostEventBus` per [[0x00-architecture]]'s connection rule, but for v1 no `moderation/`/`reporting/` subscriber exists to consume it. **Implemented**: `app.posts.service.report_post` (plain function, matching `ReportPostCommand`'s absence — no Command object). Idempotent per the unique constraint above (a repeat `(post_id, reporter_id)` is a no-op, returns `None`, doesn't republish). It publishes `PostReported` on every new, non-duplicate `Report` row — not only the post's very first report — since each new report is itself meaningful (e.g. a future consumer counting report volume), even though `Post.reported` itself only flips once and is never unset.

**AWS mapping** — RDS Postgres, table `reports`.

**Security**
- **Rate limiting** — reporting has no per-user limit of its own: the post rate limit (`POSTS-002`, [[0x03a-posts-post]] "Security") covers publishing only, not likes or reports. Only the edge controls (WAF per-IP rule, API stage throttle) bound it.
- **No moderation workflow, by design** — this is a v1 scope boundary, not an oversight; re-confirm against [[wiki/GeneralContext/Architecture/business-rules|Projects]] before adding any status/review field.

**Open decisions**
- No admin/query surface is defined yet for anyone to actually look at accumulated `reports` rows — the table exists per the business rule, but nothing in [[wiki/GeneralContext/Architecture/business-rules|Projects]] or this wiki specifies who reads it or how.
