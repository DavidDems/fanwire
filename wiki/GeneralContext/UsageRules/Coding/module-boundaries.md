# Module boundaries (connection rule)

Full detail: `wiki/CodeContext/Modules/0x00-architecture.md` "Connection rule".

## MUST NOT
- Import or call another module's concrete classes, ORM models, or tables directly.
- Add a new cross-module call that bypasses `PublishPostFacade`, `PostEventBus` (EventBridge), or the named typed interfaces (`SportsDataSource`, `Notification`, `FeedRankingStrategy`).
- Have `posts/` (or any publisher) reach into a subscriber module synchronously to "make sure it happened" — publish-and-forget onto `PostEventBus` is the only allowed shape.
- Reference another module's table by anything other than its ID/FK — no copying another module's row data inline instead of querying through its interface.
- Add a new interface boundary without recording it in the relevant `wiki/CodeContext/Modules/*.md` file in the same change.
