# 16 — Styling pass, part 4: search (`FRONTEND-007`)

**Objective:** build search, the last frontend unit, styled from the start on
the shared components. It replaces `06-frontend-007-search.md`, which predates
the styling plan.

**Preconditions: `UI-002` and `UI-003` are on `main`** (`#99` merged 2026-10-06; `UI-003` is `#100`), and `FRONTEND-005`
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
- **`routes/AppLayout.tsx` is the shell since `UI-003`:** skip link, brand
  header, one Primary nav moved by CSS, and Sign in for anonymous visitors.
  `routes/AppLayout.test.tsx` and `routes/shell-css.test.ts` pin it. If the bar
  on `/` belongs in the shell, it must not add a second `nav`, `main` or
  `banner` (A12), and every `*.module.css` under `src/routes/` stays under the
  no-raw-values scan.
- **Read `FrontendUI/components.md` §2 "As built"** for the exact props of
  every `src/components/ui/` export. **`InlineAlert` takes an `id`** (since
  `#112`, `decisions.md` 2026-10-07): when a field's error is the alert, pass
  the id the control's `aria-describedby` names. Nothing takes a
  `className`, and `StatusLine` takes no `id`. If a field needs one of those,
  stop and report it, because `src/components/ui/**` is forbidden to these
  units. **Never wrap a shared component in an element just to carry a
  missing prop**: that is the workaround `#112` replaced.
- **A class assertion alone proves nothing on Vitest 4.** `styles.anything`
  returns a hashed name even for a class that doesn't exist
  (`verification.md` §1). Pair `toHaveClass(styles.x)` with a static read of
  the `.module.css` file, and reuse `moduleCssViolations` and the readers in
  `src/test/module-css.ts` for the no-raw-values check rather than writing a
  new scanner.
- **Never write the forbidden text of a tree scan literally in a test**: the
  keyframes at-rule, the env read, the Cognito package name. Those scans read
  test files too. Build the needle from fragments.
- **`getByRole("banner")` finds every `<header>`**, including the shell's and
  any in a card. Scope with `within(...)`.
- `src/test/app-route.tsx`'s `renderAppAt(path, visitor)` renders the real
  route table inside the shell, for anonymous, member and newcomer visitors.
- `npx prettier --check src` already fails on about 100 untouched files on
  `main`. It isn't a gate; check only the files the unit writes.
- **Field owns its own layout** (`components.md` §5). `FormField.module.css`
  stacks label over control and spaces consecutive fields. A feature's
  module CSS sets control widths and the gap above its submit button, never
  `label` or `form > div` rules. `UI-008`'s first draft did, and the gap
  between fields would have doubled beside `UI-004`'s rules.
  `EmailPreference`'s `.preference > div` is the one recorded exception
  (`components.md` §5); don't copy it.
- **`prettier --write` on named files only**, never a glob: a glob also
  matches the committed tests (`00-session-protocol.md` step 4).
- **Post results need posts on `backend-dev`.** The seed has teams and games
  but no posts: create a few through `/compose` as a test account first
  (`verification.md` §3a).

## Verify

The gates in `00-session-protocol.md`, the container included, and the guard
over the real diff. Browser checklist (`verification.md` §3) for `/search` and
the bar on `/`, or NOT DONE. Afterwards the bundle is rebuilt and re-deployed
on merge by `deploy.yml`.

One PR. Merge nothing.
