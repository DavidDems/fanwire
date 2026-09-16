# fanwire

**Human-facing.** Sports discussion app — Twitter-style posts about real sports games/teams, feed pulls live data from a real sports API. Full business rules in `reference/Projects.md`.

## State
No application code exists yet. This root currently holds only documentation: `wiki/` (the entity-by-entity implementation decisions for every module) and `reference/` (the design/usage principles and the AWS/security/pattern decisions that justify each wiki entry). Start at `wiki/index.md`.

## Decisions needed
None blocking. A handful of open decisions are flagged inline throughout `wiki/` (e.g. exact season-field format, image thumbnail dimensions, the guest-feed ranking heuristic, whether `Post` needs a denormalized like count) — each is called out where it applies and should be resolved as that module is actually implemented, not before.

## Open questions
- When the codebase is scaffolded (FastAPI backend, React frontend, AWS CDK infrastructure), `AGENTS.md`'s "Build / test / run" section needs filling in — it's intentionally left as a placeholder until real commands exist.
