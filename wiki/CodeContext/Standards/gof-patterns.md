# Gang of Four Example — Sports Discussion Feed

Reference project, not to be built literally — the actual project is the sports discussion app itself (see [[wiki/GeneralContext/Architecture/business-rules|Projects]]). This shows how all 23 GoF patterns connect in that codebase's domain: a Twitter-style feed where posts can mention real games/teams pulled from a live sports data provider. Mirrors [[wiki/CodeContext/Standards/design-principles|Design principles]].

## Module layout

```
fanwire/
├── feed/          # timeline assembly, ranking
├── posts/         # post entity, threads, mentions
├── media/         # upload validation, scanning, processed variants
├── events/        # ingested game/match data (external sports API)
├── users/         # profiles, follows
├── notifications/ # push/email/in-app
├── moderation/    # spam/abuse filtering
├── search/        # search posts/events/users
└── reporting/     # analytics/admin exports
```

## Creational patterns

- **Singleton** — `AppConfig` and `Logger`. One instance per process, injected everywhere else.
- **Factory Method** — `NotificationFactory.create(type)` returns `EmailNotification`, `PushNotification`, or `InAppNotification`. `notifications/` depends only on the `Notification` interface, never a concrete class.
- **Abstract Factory** — `SportsProviderFactory` produces a matched family per data vendor: `GameFetcher` + `TeamResolver` + `ScoreNormalizer` for API-SPORTS vs. a fallback provider. Swapping vendor swaps the whole family atomically — `events/` never depends on one vendor's response shape.
- **Builder** — `PostBuilder` assembles a `Post` from text, media, and one or more `EventMention`s across a multi-step compose flow before a single immutable `Post` is emitted.
- **Prototype** — `PostTemplate.clone()` — quick-post templates ("final score reaction", "pre-game hype") are cloned from a stored template and customized, instead of built from scratch.

## Structural patterns

- **Adapter** — `ApiSportsAdapter` (and any second provider added later) implements one internal `SportsDataSource` interface. `events/` calls the interface only; the adapter isolates the vendor's actual JSON shape.
- **Bridge** — `NotificationChannel` (abstraction: mention-alert vs. game-alert) is decoupled from `NotificationTransport` (implementation: email/push/SMS). Either axis extends independently.
- **Composite** — `Post` and `Thread` (a thread is replies, and replies are themselves `Post`s) share one interface. `feed/` renders and counts recursively without type-checking.
- **Decorator** — `PinnedPostDecorator`, `LiveScoreTickerDecorator` wrap a base `Post` to add pinned styling or a live-updating score badge without a subclass per feature.
- **Facade** — `PublishPostFacade.publish()` is the single entry point `feed/` calls; internally it sequences validation, mention resolution against `events/`, a check that every attached `media/` item has reached `Processed` state, moderation, persistence, and fan-out to followers. It never re-scans media itself — that already happened in `media/`'s own pipeline at upload time.
- **Flyweight** — `TeamBadge`/`EventSummary` (team logo, name, league) is shared by reference across every post that mentions that game — never duplicated per mention.
- **Proxy** — `CachedEventProxy` sits in front of the real sports API call; `feed/` and `search/` query the proxy, which caches live scores for a short TTL to respect provider rate limits.

## Behavioral patterns

- **Chain of Responsibility** — moderation pipeline: `ProfanityFilter → SpamScoreCheck → RateLimitCheck → DuplicateContentCheck`, each a handler that can halt the chain. `PublishPostFacade` owns the chain, not individual checks.
- **Command** — `DeletePostCommand`, `HidePostCommand`, `ReportPostCommand` are objects with `execute()`/`undo()`, queued and logged — required for the moderation audit trail and admin undo.
- **Interpreter** — `MentionParser` parses `@user`, `#GameId`, `$TEAM` tokens out of raw post text into a mention AST, defined as data-driven grammar rules so a new mention syntax doesn't require a rewrite.
- **Iterator** — `ThreadIterator` traverses a post's reply thread uniformly for `feed/` and `reporting/`, independent of whether it's backed by a list or a paginated cursor.
- **Mediator** — `ComposeMediator` coordinates the text box, mention-autocomplete dropdown, and media-upload widget in the compose UI so they never reference each other directly.
- **Memento** — `DraftSnapshot` captures an in-progress post draft before a risky action (attaching live event data) so the compose UI can roll back without exposing `Post` internals.
- **Observer** — `PostEventBus`: `posts/` publishes `PostCreated`, `PostMentionedEvent`, `PostReported`; `feed/`, `notifications/`, `moderation/`, and `reporting/` subscribe independently. `posts/` has zero knowledge of its subscribers.
- **State** — `Post.moderationStatus` (`Visible → UnderReview → Hidden/Removed`) and `Media.status` (`Uploaded → Scanning → Processed/Rejected`) are each a `State` object per status defining legal transitions. A post cannot attach anything but `Processed` media, and a removed post cannot be silently re-shown, by construction rather than by an `if` check someone forgot.
- **Strategy** — `FeedRankingStrategy` (chronological, engagement-weighted, following-only) and `MentionResolutionStrategy` (exact team match, fuzzy match) are swapped at runtime without branching in `feed/`.
- **Template Method** — `AbstractEventIngestionPipeline.run()` fixes the skeleton (`fetchRawEvents → normalize → dedupe → matchToMentions → publish`); `LiveGameIngestion` and `FinalScoreIngestion` override only the steps that differ. `media/`'s upload pipeline (`validateType → scanForMalware → stripMetadata → generateVariants → publish`) is the same shape, one level down.
- **Visitor** — `PostExportVisitor`, `EngagementReportVisitor` traverse the `Post`/`Thread` composite in `reporting/` to produce CSV/analytics exports without adding that logic to the domain classes.

## Connection rule

No module reaches past its own interface boundary into another module's concrete classes. `feed/`, `posts/`, `media/`, `events/`, `users/`, `notifications/`, `moderation/`, `search/`, `reporting/` communicate only through: the `PublishPostFacade`, the `PostEventBus`, and typed interfaces (`SportsDataSource`, `Notification`, `FeedRankingStrategy`). This is Dependency Inversion (see [[wiki/CodeContext/Standards/design-principles|Design principles]]) enforced at module granularity, not just class granularity — `events/` can swap sports data providers, and `notifications/` can add a channel, without either touching `posts/` or `feed/`.
