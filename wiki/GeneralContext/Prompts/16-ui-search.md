# 16 — Styling pass, part 4: search (`FRONTEND-007`)

**Objective:** build search, the last frontend unit, styled from the start on
the shared components. It replaces `06-frontend-007-search.md`, which predates
the styling plan.

**Preconditions: `UI-002` and `UI-003` are on `main`**, and `FRONTEND-005`
(feed) is too, which it already is. Check with `git fetch` and
`git log origin/main --oneline`, and stop if either is missing. `UI-003` and
this unit both write `src/routes/**`, so they never run concurrently.

**Run by hand in this session, never by the orchestrator** (same reason as
`13`). Hand-cut `agent/FRONTEND-007` from `origin/main`; `agent-guard` holds it
to its spec. The spec was amended on 2026-10-06 to require the shared
components, `GameScore` for game results and the no-raw-values rule, so read it
fresh.

## Read first

1. `00-session-protocol.md`: the per-unit loop and the gates.
2. `.ai/tasks/FRONTEND-007/` (spec and brief) and every file its
   `required_context` names: `Modules/0x07-search.md`, `Modules/0x02-events.md`,
   `Modules/0x08-frontend.md`, `Standards/design-principles.md`, and
   `FrontendUI/components.md`, `layout.md` and `verification.md`.
3. `.ai/skills/frontend-unit/SKILL.md`.

## Traps to hand the subagents

- **No text input of any kind in the sports-data filter.** A type-ahead
  dropdown is a text input. That's a business rule, and the brief explains it.
  Write that test first.
- **Post results render through the feed's `PostNode`**, imported, never
  copied (`features/feed/**` is forbidden).
- **Game rows use `GameScore`** and name teams by abbreviation from
  `GET /events/teams`, which the filter already loads. No logos, no team
  colours (`components.md` §4).
- **Shared components are consumed, not edited** (`src/components/ui/**` is
  forbidden).
- The free-text bar appears on both `/` and `/search` (a criterion), so
  coordinate with the feed page through `routes/`, not by editing
  `features/feed/**`.

## Verify

The gates in `00-session-protocol.md`, the container included, and the guard
over the real diff. Browser checklist (`verification.md` §3) for `/search` and
the bar on `/`, or NOT DONE. Afterwards the bundle is rebuilt and re-deployed
on merge by `deploy.yml`.

One PR. Merge nothing.
