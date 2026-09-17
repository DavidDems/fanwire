# fanwire — Context Wiki

**Agent-facing.** This wiki is the working context for building `fanwire` (the sports discussion app — see [[reference/Projects|Projects]] for the full business rules). It states current implementation decisions only; it is not a history of how those decisions were reached — see git history for that once code exists.

Read this wiki alongside [[reference/Design principles|Design principles]] (universal rules), [[reference/AWS Stack|AWS Stack]] (infrastructure), [[reference/Security|Security]] (security requirements), [[reference/Gang of Four Example|Gang of Four Example]] (pattern usage), and [[reference/Build & Deployment|Build & Deployment]] (package inventory and container strategy) — each module file below cites the specific lines in those docs that justify its choices rather than restating them.

This wiki also serves as a template: the structure and per-entity documentation format here is meant to be reused for future projects, not just `fanwire`.

## Read in this order
1. [[0x00-architecture]] — module boundaries, AWS topology, event bus, connection rule
2. [[0x01-users]] — `User`, `Follow`
3. [[0x02-events]] — `Team`, `Game`
4. [[0x03-posts]] — `Post`, `PostLike`, `EventMention`, `Report`
5. [[0x04-media]] — `Media` and the upload pipeline
6. [[0x05-notifications]] — `Notification`, `NotificationPreference`
7. [[0x06-feed]] — feed computation (no owned entities)
8. [[0x07-search]] — search implementation (no owned entities)

## Module map

| Module | Owns | Depends on |
|---|---|---|
| `users/` | `User`, `Follow` | Cognito (identity), `media/` (profile picture) |
| `events/` | `Team`, `Game` | API-SPORTS (external), nothing internal |
| `posts/` | `Post`, `PostLike`, `EventMention`, `Report` | `users/`, `events/`, `media/` (via IDs/interfaces only) |
| `media/` | `Media` | S3, GuardDuty Malware Protection, Pillow |
| `notifications/` | `Notification`, `NotificationPreference` | `PostEventBus`, SES |
| `feed/` | nothing (computes over `posts/`, `users/`) | — |
| `search/` | nothing (indexes `users/`, `posts/`, `events/`) | Postgres `tsvector` |

No module reaches into another module's tables directly — see [[0x00-architecture]] for the connection rule.

## Explicitly out of scope for v1
- Standalone `Player`/`PlayerSeasonStat` tables — see [[0x02-events]].
- Moderation workflow beyond the `Report` flag — see [[0x03-posts]].
- A fallback sports data provider — single-provider until API-SPORTS proves insufficient, per [[reference/Projects|Projects]].
