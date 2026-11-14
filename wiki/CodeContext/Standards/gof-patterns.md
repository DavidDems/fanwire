---
type: reference
---

# Gang of Four Example — Sports Discussion Feed

Reference project, not to be built literally — the actual project is the sports discussion app itself (see [[wiki/GeneralContext/Architecture/business-rules|Projects]]). This shows how all 23 GoF patterns connect in that codebase's domain: a Twitter-style feed where posts can mention real games/teams pulled from a live sports data provider. Mirrors [[wiki/CodeContext/Standards/design-principles|Design principles]].

## Module layout

```
backend/app/
├── users/         # profiles, follows
├── posts/         # post entity, threads, sports-data links; moderation chain in posts/moderation.py
├── events/        # NBA game/stats data loaded from the dataset
├── media/         # upload validation, scanning, processed variants
├── notifications/ # push/email/in-app
├── feed/          # timeline assembly, ranking
└── search/        # search posts/events/users
```

`moderation/` and `reporting/` are not separate modules; neither exists.

## Creational patterns

- **Singleton** — `AppConfig` and `Logger`. One instance per process, injected everywhere else.
- **Factory Method** — `NotificationFactory.create(type)` returns `EmailNotification`, `PushNotification`, or `InAppNotification`. `notifications/` depends only on the `Notification` interface, never a concrete class.
- **Abstract Factory** — no use today. `SportsProviderFactory` went with API-SPORTS ingestion in `EVENTS-003`. A future second data vendor that needs a matched family of objects should use Abstract Factory.
- **Builder** — `PostBuilder` assembles a `Post` from text, media, and at most one sports-data link (`data_link`, POSTS-005) across a multi-step compose flow before a single immutable `Post` is emitted.
- **Prototype** — no use today. A future feature that copies a configured object should use Prototype rather than rebuild it.

## Structural patterns

- **Adapter** — no use today. `ApiSportsAdapter` and its `SportsDataSource` interface went with API-SPORTS ingestion in `EVENTS-003`. A future second data vendor uses an Adapter behind one internal interface, so the vendor's JSON shape stays isolated.
- **Bridge** — `NotificationChannel` (abstraction: mention-alert vs. game-alert) is decoupled from `NotificationTransport` (implementation: email/push/SMS). Either axis extends independently.
- **Composite** — `Post` and `Thread` (a thread is replies, and replies are themselves `Post`s) share one interface. `feed/` renders and counts recursively without type-checking.
- **Decorator** — no use today. The pinned-post and live-score decorators must not be built: `frontend/src/features/feed/feed-isolation.test.ts` pins their absence.
- **Facade** — `PublishPostFacade.publish()` is the single entry point `feed/` calls; internally it sequences validation, a check that every attached `media/` item has reached `Processed` state, moderation, persistence, and fan-out to followers. It never re-scans media itself — that already happened in `media/`'s own pipeline at upload time.
- **Flyweight** — `TeamBadge`/`EventSummary` (team logo, name, league) is shared by reference across every post that mentions that game — never duplicated per mention.
- **Proxy** — no use today. `CachedEventProxy` went with API-SPORTS ingestion in `EVENTS-003`. A future cache in front of a rate-limited provider should be a Proxy.

## Behavioral patterns

- **Chain of Responsibility** — moderation pipeline: `ProfanityFilter → SpamScoreCheck → RateLimitCheck → DuplicateContentCheck`, each a handler that can halt the chain. `PublishPostFacade` owns the chain, not individual checks.
- **Command** — `DeletePostCommand`, `HidePostCommand`, `ReportPostCommand` are objects with `execute()`/`undo()`, queued and logged — required for the moderation audit trail and admin undo.
- **Interpreter** — no use today. `#GameId` parsing (`MentionParser`) was retired by `POSTS-006`; legacy `EventMention` rows stay readable. A future text syntax should be data-driven grammar rules, so a new syntax doesn't require a rewrite.
- **Iterator** — `ThreadIterator` traverses a post's reply thread uniformly for `feed/` and `reporting/`, independent of whether it's backed by a list or a paginated cursor.
- **Mediator** — `ComposeMediator` coordinates the text box, sports-data attachment picker, and media-upload widget in the compose UI so they never reference each other directly.
- **Memento** — `DraftSnapshot` captures an in-progress post draft before a risky action (attaching live event data) so the compose UI can roll back without exposing `Post` internals.
- **Observer** — `PostEventBus`: `posts/` publishes `PostCreated`, `PostReported`; `users/` publishes `UserFollowed`. Subscribers subscribe independently (today the notifications consumer). Publishers have zero knowledge of their subscribers.
- **State** — `Post.moderationStatus` (`Visible → UnderReview → Hidden/Removed`) and `Media.status` (`Uploaded → Scanning → Processed/Rejected`) are each a `State` object per status defining legal transitions. A post cannot attach anything but `Processed` media, and a removed post cannot be silently re-shown, by construction rather than by an `if` check someone forgot.
- **Strategy** — `FeedRankingStrategy` (chronological, engagement-weighted, following-only) is swapped at runtime without branching in `feed/`.
- **Template Method** — `media/`'s upload pipeline fixes the skeleton: `validateType → scanForMalware → stripMetadata → generateVariants → publish`.
- **Visitor** — `PostExportVisitor`, `EngagementReportVisitor` traverse the `Post`/`Thread` composite in `reporting/` to produce CSV/analytics exports without adding that logic to the domain classes.

## Connection rule

No module reaches past its own interface boundary into another module's concrete classes. `users/`, `posts/`, `events/`, `media/`, `notifications/`, `feed/`, `search/` communicate only through: the `PublishPostFacade`, the `PostEventBus`, and typed interfaces (`Notification`, `FeedRankingStrategy`). This is Dependency Inversion (see [[wiki/CodeContext/Standards/design-principles|Design principles]]) enforced at module granularity, not just class granularity — `notifications/` can add a channel without touching `posts/` or `feed/`.
