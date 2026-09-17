# fanwire — Wiki

**Agent-facing.** Every AI-facing file for `fanwire` lives under this folder — implementation decisions, design/security/pattern standards, agent usage rules, task prompts, and agent-generated reports. Nothing agent-relevant lives outside `wiki/` except `AGENTS.md` (repo-root entry point) and this folder's parent scaffolding.

This wiki is also meant as a reusable template: the two-folder split and per-entity documentation format below are meant to be reused for future projects, not just `fanwire`.

## Two folders, two access levels

### `wiki/CodeContext/`
Context for **creating/changing code** — implementation decisions and standards a code-change agent needs.

Contents:
- `wiki/CodeContext/Modules/0x00-architecture.md` .. `0x07-search.md` — one file per module/entity, current-state implementation decisions.
- `wiki/CodeContext/Standards/` — the design-principles, security, GoF-pattern, AWS-stack, and build-deployment references each module file cites by exact excerpt.

### `wiki/GeneralContext/`
Context for **manager/thinking-tier agents**. Contains everything `wiki/CodeContext/` has (by reference, not duplicated — see below) plus the rest of the project: business rules, architecture/ops docs, task prompts, and reports. Start at `wiki/GeneralContext/index.md` — the project dictionary. Most agents never read it; it's the lookup for the agent doing the managing.

There is no agent-governance/usage-rules process on this branch right now — see `wiki/GeneralContext/index.md`'s Process note. A `rules` branch holds the drafted-but-deferred version for later, once there's something worth technically enforcing.

`wiki/GeneralContext/` "contains" `wiki/CodeContext/` in the sense that its index links to every `CodeContext` file as part of the full picture — content is never duplicated between the two folders (single source of truth). A manager-tier agent has full read access to both folders; a code-change subagent is restricted to exactly the `CodeContext` files it's handed.

## Read in this order
- **Manager/thinking-tier agent, starting fresh**: `AGENTS.md` → `wiki/GeneralContext/index.md` → the specific module/standards files for the task at hand.
- **Code-change subagent**: whatever files your manager handed you, by path.

## Module map
See `wiki/GeneralContext/index.md` for the full module map, business rules, standards index, and current implementation state.
