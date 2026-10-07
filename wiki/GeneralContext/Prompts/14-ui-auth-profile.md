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
- **Read `FrontendUI/components.md` §2 "As built"** for the exact props of
  every `src/components/ui/` export. `InlineAlert` and `StatusLine` take no
  `id` or `className`: if a field needs one for `aria-describedby`, stop and
  report it, because `src/components/ui/**` is forbidden to these units.
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
- **`UI-004` and `UI-008` are siblings.** If both are open at once, merge them
  into a throwaway worktree and run the frontend container on the combination
  before handing over (`00-session-protocol.md`).
- `/sign-up`, `/confirm` and `/forgot-password` have their own "sign in" links,
  and since `UI-003` the header adds a "Sign in" link for anonymous visitors
  (not on `/sign-in` itself). A whole-page `getByRole("link", { name: /sign in/i })`
  finds two, so scope it to the card or `main`.

## Verify

The gates in `00-session-protocol.md`, the container included, and the guard
over the real diff. Browser checklist (`verification.md` §3) for `/sign-in`,
`/sign-up`, `/confirm`, `/forgot-password`, `/create-profile` and
`/profile/:id` (own and someone else's), or NOT DONE. `fwtest1` viewing
`fwtest2` is "someone else's".

**Signed-in rows:** use the dev-pool test accounts as `verification.md` §3a
and `wiki/GeneralContext/Architecture/dev-auth-setup.md` "Test accounts"
describe. Start the stack with the health wait. After a fresh stack, the
profiles are recreated on `/create-profile` with the usernames from
`frontend/.env.test-accounts.local`. Sign out by clearing `localStorage` at
the end. Never use the live site, and never put a password in a PR. A missing
sign-out button is a known gap with its own future unit. It isn't part of
this prompt, so don't add one.

Two PRs. Merge nothing.
