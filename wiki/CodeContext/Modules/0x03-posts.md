---
type: reference
---

# 0x03 — Posts

**Agent-facing.** Current-state only — see [[wiki/GeneralContext/index|index]] for how this wiki is organized.

## Module scope
`posts/` owns four tables: `Post`, `PostLike`, `EventMention`, `Report`. Covers every "Posts" business rule in [[wiki/GeneralContext/Architecture/business-rules|Projects]]: create/reply/repost, like, image attachment, game-result attachment, report (flag only), copy-link (client-side, no schema impact), and code-injection safety.

Post creation, the media-`Processed` gate, and cross-module fan-out are the `PublishPostFacade`/`PostEventBus`, both defined in [[0x00-architecture]] — not repeated here. That file also states that no `moderation/` module (no moderation workflow) exists for v1; the pre-publish moderation chain below is validation inside `posts/`, not that module, and [[0x03d-posts-reports]] adds only what's specific to the `Report` table.

**Implemented**: `app.posts.facade.PublishPostFacade` (Facade — the single entry point, sequencing the pre-publish moderation chain → confirm attached `Media` are `Processed` → persist → attach media → commit → publish `PostCreated`), `app.posts.moderation` (Chain of Responsibility: `ProfanityFilter → SpamScoreCheck → RateLimitCheck → DuplicateContentCheck`, each injected against a narrow interface; `RateLimitCheck` and `SpamScoreCheck` have real adapters ([[0x03a-posts-post]] "Security"), so the chain `get_moderation_chain` builds holds no fake; `FakeSpamScorer`/`FakeRateLimiter` are test doubles only), `app.eventbus.PostEventBus` (Observer — publishes `PostCreated` and `PostReported` from `posts/` and `UserFollowed` from `users/`; `PostMentionedEvent` is retired; the bus lives in `app.eventbus`, not `app.posts`, because `users/` publishes onto it too — see [[0x00-architecture]] "Cross-cutting FastAPI DI" for the same top-level-not-module-owned reasoning), `app.posts.service` (`report_post`/`like_post`/`unlike_post`, plain functions matching `app.users.service`'s style).

Which `EventPublisher` backs the bus (EventBridge, local dispatch or in-memory) is chosen by `app.dependencies.get_event_bus()`: [[0x00-architecture]] "PostEventBus implementation", [[0x05-notifications]] "Local dispatch".

## Parts

- [[0x03a-posts-post]]: the `Post` table, its design, pattern, AWS and security notes (rate limiting, spam score), settled decisions and the `feed/`/`search/` reads
- [[0x03b-posts-actions]]: the repost toggle, post deletion and sports-data attachments
- [[0x03c-posts-likes-mentions]]: the `PostLike` table and the legacy `EventMention` table
- [[0x03d-posts-reports]]: the `Report` table
