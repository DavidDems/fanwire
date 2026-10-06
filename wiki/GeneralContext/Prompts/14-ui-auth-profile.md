# 14 — Styling pass, part 2: auth and profile

**Objective:** style the account-facing screens: `UI-004` (the five auth pages
and `FormField`), then `UI-008` (both profile variants and settings). One PR
each.

**Precondition: `UI-001` and `UI-002` are on `main`** (`13`). Check with
`git fetch` and `git log origin/main --oneline`. If either is missing, stop and
say so: these units consume `src/components/ui/` and the tokens, and must not be
stacked on unmerged branches. `UI-003` (the shell) doesn't need to be merged
first: these units don't touch `src/routes/**`.

**Run by hand in this session, never by the orchestrator** (same reason as
`13`). Hand-cut `agent/UI-004` and `agent/UI-008` from `origin/main`;
`agent-guard` holds each to its spec.

## Read first

1. `00-session-protocol.md`: the per-unit loop and the gates.
2. `.ai/tasks/UI-004/` and `.ai/tasks/UI-008/` (spec and brief), and the files
   each `required_context` names: `FrontendUI/layout.md` §3,
   `FrontendUI/components.md`, `FrontendUI/verification.md`, and
   `Modules/0x08-frontend.md`.
3. `.ai/skills/frontend-unit/SKILL.md`.

## Traps to hand the subagents

- **No logic changes.** `UI-004` forbids the auth service, context and token
  provider. `UI-008` must keep `ProfileSummary` taking three scalars, never a
  user object: that's the date-of-birth privacy guarantee.
- **Text nodes tests read exactly stay whole:** "N followers", "N following".
- **Shared components are consumed, not edited** (`src/components/ui/**` is
  forbidden). If one is missing something, stop and report it as a change to
  `UI-002`'s area rather than working around it.
- Native inputs are already styled by `base.css` from `aria-invalid` and
  `:disabled`. Don't add classes to every input.
- `src/auth/accessibility.test.tsx` and `no-secret-leak.test.tsx` must pass
  unchanged.

## Verify

The gates in `00-session-protocol.md`, the container included, and the guard
over the real diff. Browser checklist (`verification.md` §3) for `/sign-in`,
`/sign-up`, `/confirm`, `/forgot-password`, `/create-profile` and
`/profile/:id` (own and someone else's), or NOT DONE.

Two PRs. Merge nothing.
