# Patterns as assigned

Full pattern-to-behavior map: `wiki/CodeContext/Standards/gof-patterns.md`.

## MUST NOT
- Substitute a different GoF pattern for a piece of behavior `gof-patterns.md` already assigns one to, because it seems easier or more familiar.
- Add a pattern to an entity that `gof-patterns.md` or a module file explicitly says does not need one (e.g. no Bridge for `notifications/`'s channel/transport axis until push/SMS is added — see `wiki/CodeContext/Modules/0x05-notifications.md`).
- Introduce a pattern speculatively "for future flexibility" where YAGNI applies — see `wiki/GeneralContext/UsageRules/Coding/principles-and-security.md`.
- Build any part of `moderation/`/`reporting/` as modules — the GoF reference doc's full module list is illustrative context, not the v1 build list; only the `Report` flag ships, per `wiki/CodeContext/Modules/0x00-architecture.md` and `wiki/CodeContext/Modules/0x03-posts.md`.
