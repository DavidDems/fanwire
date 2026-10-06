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

## Verify

The gates in `00-session-protocol.md`, the container included, and the guard
over the real diff. Browser checklist (`verification.md` §3) for `/`,
`/compose` and `/notifications`, light and dark, or NOT DONE. For `/`, seed
data (`scripts/seed_dev.py`) gives posts. A post with a live score needs a game
inside the four-hour window, so say whether that state was actually seen.

Three PRs. Merge nothing.
