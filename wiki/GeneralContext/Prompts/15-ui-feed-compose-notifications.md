# 15 — Styling pass, part 3: feed, composer, notifications

**Objective:** style the screens a fan spends most of their time on: `UI-005`
(feed, post cards, threads, the live-score block, likes), then `UI-006` (the
composer), then `UI-007` (notifications). One PR each.

**Precondition: `UI-001` and `UI-002` are on `main`** (`13`). Check with
`git fetch` and `git log origin/main --oneline`. If either is missing, stop and
say so. Don't stack on unmerged branches. The three units write disjoint
folders and can be cut from `origin/main` one after another, without waiting
for each other to merge.

**Run by hand in this session, never by the orchestrator** (same reason as
`13`). Hand-cut `agent/UI-005`, `agent/UI-006` and `agent/UI-007` from
`origin/main`; `agent-guard` holds each to its spec.

## Read first

1. `00-session-protocol.md`: the per-unit loop and the gates.
2. Each `.ai/tasks/UI-00N/` spec and brief, and the files its
   `required_context` names. `UI-005` also gets `FrontendUI/direction.md`: the
   live game is the moment the whole look is designed around.
3. `.ai/skills/frontend-unit/SKILL.md`.

## Traps to hand the subagents

- **`UI-005`: the decorator adds a block after its children and never restyles
  or wraps them.** That's the Decorator pattern's contract
  (`gof-patterns.md`), and the file's own header says why.
- **`UI-005`: "No replies yet." is the only behaviour change in the pass.** Its
  test is red today because nothing renders. Record it in `0x08-frontend.md`.
- **`UI-005`: the score block names no teams.** `LiveScoreView` has no team
  fields, so Home and Away. Don't add a teams fetch.
- **`UI-005`: the game-state mapping never claims Live for an unknown status
  code.** The vendor's codes are unverified (`components.md` §4).
- **`UI-006`: `component-isolation.test.ts` reads the three compose controls
  from disk.** No control may import another, so styling must not either. Each
  gets its own module CSS.
- **"3 likes" stays one text node** (`FeedPage.test.tsx` matches it exactly).
- `feed-isolation.test.ts` bans a branch on who the reader is. Styling must not
  introduce a guest/member visual branch.
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
- **Field owns its own layout** (`components.md` §5). `FormField.module.css`
  stacks label over control and spaces consecutive fields. A feature's
  module CSS sets control widths and the gap above its submit button, never
  `label` or `form > div` rules. `UI-008`'s first draft did, and the gap
  between fields would have doubled beside `UI-004`'s rules.
- **Three siblings.** `UI-005`, `UI-006` and `UI-007` are cut from the same
  `origin/main`. Before handing them over, merge all open ones into a throwaway
  worktree and run the frontend container on the combination
  (`00-session-protocol.md`). That is exactly the check that would have caught
  `UI-002`'s failure against `UI-001`. Give the human a merge order, and tell
  them each later PR needs "Update branch" and fresh checks.
- `UI-005`: `GameScore` already implements the `components.md` §4 mapping and
  is tested in `components/ui/GameScore.test.tsx`. Feed tests assert the
  decorator's use of it, and don't repeat the table.

## Verify

The gates in `00-session-protocol.md`, the container included, and the guard
over the real diff. Browser checklist (`verification.md` §3) for `/`,
`/compose` and `/notifications`, light and dark, or NOT DONE. For `/`, seed
data (`scripts/seed_dev.py`) gives posts. A post with a live score needs a game
inside the four-hour window, so say whether that state was actually seen.
`/compose` and `/notifications` are signed-in routes. A notification needs
another account's action, for example `fwtest2` following or liking `fwtest1`.

**Signed-in rows:** use the dev-pool test accounts as `verification.md` §3a
and `wiki/GeneralContext/Architecture/dev-auth-setup.md` "Test accounts"
describe. Start the stack with the health wait. After a fresh stack, the
profiles are recreated on `/create-profile` with the usernames from
`frontend/.env.test-accounts.local`. Sign out by clearing `localStorage` at
the end. Never use the live site, and never put a password in a PR. A missing
sign-out button is a known gap with its own future unit. It isn't part of
this prompt, so don't add one.

Three PRs. Merge nothing.
