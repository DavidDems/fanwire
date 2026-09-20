# fanwire — Wiki

**Agent-facing.** This folder holds `fanwire`'s **semantic** context — implementation decisions, design/security/pattern standards, task prompts, and agent-generated reports. It is prose for a reader.

The agent system's **machine** infrastructure lives in `.ai/` instead: executable code, enforced permission policy, workflow state and telemetry. The split is by kind, not by audience — `.ai/policy.json` is enforced by a script, `wiki/CodeContext/Modules/0x03-posts.md` is read by an agent. Nothing is duplicated across the two; a task spec names the `wiki/CodeContext/` files a worker needs, by path. Start at `.ai/README.md` for that side.

`AGENTS.md` at the repo root routes to both.

This wiki is also meant as a reusable template: the two-folder split and per-entity documentation format below are meant to be reused for future projects, not just `fanwire`.

## Two folders, two access levels

### `wiki/CodeContext/`
Context for **creating/changing code** — implementation decisions and standards a code-change agent needs.

Contents:
- `wiki/CodeContext/Modules/0x00-architecture.md` .. `0x07-search.md` — one file per module/entity, current-state implementation decisions.
- `wiki/CodeContext/Standards/` — the design-principles, security, GoF-pattern, AWS-stack, and build-deployment references each module file cites by exact excerpt.

### `wiki/GeneralContext/`
Context for **manager/thinking-tier agents**. Contains everything `wiki/CodeContext/` has (by reference, not duplicated — see below) plus the rest of the project: business rules, architecture/ops docs, task prompts, and reports. Start at `wiki/GeneralContext/index.md` — the project dictionary. Most agents never read it; it's the lookup for the agent doing the managing.

Agent governance is no longer prose: per-role write permissions are enforced against the actual diff in CI (`.ai/policy.json`, `.github/workflows/agent-guard.yml`), and `.ai/docs/permissions.md` records both what is enforced and what is not. See `wiki/GeneralContext/index.md`'s Process note.

`wiki/GeneralContext/` "contains" `wiki/CodeContext/` in the sense that its index links to every `CodeContext` file as part of the full picture — content is never duplicated between the two folders (single source of truth). A manager-tier agent has full read access to both folders; a code-change subagent is restricted to exactly the `CodeContext` files it's handed.

## Read in this order
- **Manager/thinking-tier agent, starting fresh**: `AGENTS.md` → `wiki/GeneralContext/index.md` → the specific module/standards files for the task at hand.
- **Code-change subagent**: whatever files your manager handed you, by path.

## Module map
See `wiki/GeneralContext/index.md` for the full module map, business rules, standards index, and current implementation state.
