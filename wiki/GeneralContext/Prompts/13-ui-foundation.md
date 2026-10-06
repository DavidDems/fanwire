# 13 — Styling pass, part 1: brand files, tokens, components, shell

> **Done (2026-10-06).** D1 `#97`, UI-001 `#98` and UI-002 `#99` are merged
> and deployed, and UI-003 is `#100`. Lessons from the run are now in
> `00-session-protocol.md` (guard per role from the worktree; test sibling PRs
> together; "Update branch") and `FrontendUI/verification.md` (the Vitest 4
> CSS Module proxy; tree scans read test files; the banner role on every
> `<header>`). Kept as the record of what was asked.

**Objective:** lay the foundation of the frontend styling pass planned in
`wiki/CodeContext/FrontendUI/`. Four PRs, in this order: the Director PR `D1`,
then the worker tasks `UI-001`, `UI-002` and `UI-003`. Parts 2–4
(`14`, `15`, `16`) build on these.

**You do the work yourself, in this Claude Code session.** The specs live in
`.ai/tasks/`, but **never start `.github/workflows/agent-orchestrator.yml` or
`agent-worker.yml`**: they bill metered API credits, and this pass is run by
hand on the subscription. A hand-cut `agent/<ID>` branch has no `state.json`,
so the orchestrator ignores it, while `agent-guard` still checks your diff
against the spec. That check is the point: it keeps you inside
`allowed_paths`.

## Read first

1. `00-session-protocol.md`: you are a Director, and its "loop, per unit" is how
   each `UI-00N` is done (branch from `origin/main`, tests by one subagent, red
   verified and committed alone, implementation by a second subagent, every
   gate run yourself, guard check, PR, merge nothing).
2. `wiki/CodeContext/FrontendUI/index.md`, then only the files it says to hand
   each unit. `decisions.md` outranks everything else there.
3. `wiki/CodeContext/FrontendUI/implementation-plan.md` (`D1`, `UI-001`–`UI-003`).
4. `.ai/skills/frontend-unit/SKILL.md`.
5. Each task's `.ai/tasks/<ID>/task.json` and `brief.md`. **The spec is the
   contract.** If the plan and the spec disagree, the spec wins, and you say so
   in the PR.

## 1. `D1`: brand files and `index.html` (Director PR)

A human-named branch (`git switch -c brand-placement origin/main`), not
`agent/*`: workers can't write `index.html`. It still goes test-first: commit a
failing `frontend/src/brand-assets.test.ts` alone, then the files.

- Copy the seven files from `brand/out/` to `frontend/public/` unchanged, and
  write `frontend/public/manifest.webmanifest`. Everything is listed in
  `implementation-plan.md` → D1.
- Add the head tags from the same section to `frontend/index.html`. **The
  tagline is "Sports talk, wired live."** (`decisions.md`, 2026-10-06): use it
  for `<meta name="description">` and `og:description`. `og:image` and
  `og:url` are absolute (`https://fanwire.daviddems.com/…`). `<title>` stays
  `fanwire`.
- The test can't compare with `brand/out/`: the test container copies only
  `frontend/` (`verification.md` §2a). Assert existence, PNG IHDR sizes, the
  ICO's 16/32/48 entries, the manifest's content and the head tags.
- PR body: say it writes `frontend/index.html`. Browser check: favicon in a tab,
  light and dark, by the human; otherwise NOT DONE.

## 2. `UI-001`, `UI-002`, `UI-003`, one PR each

- `UI-001` and `UI-002` don't depend on each other's code. Cut both from
  `origin/main` and open both PRs.
- **`UI-003` imports from `UI-002`** (icons, `buttonClass`). Don't stack it on
  an unmerged branch: stacked PRs merged in the wrong order have already failed
  to reach `main` in this repo. When `UI-002` is open, stop, tell the human
  `UI-003` is waiting on it, and continue only once it's merged
  (`git fetch` and check `origin/main` contains it).
- `UI-003` must not run while anyone works on `FRONTEND-007`: both write
  `src/routes/**`.

Traps to hand the subagents, beyond each brief:

- jsdom computes no CSS. Assert on files (static tests) and on DOM semantics,
  never `getComputedStyle` (`verification.md` §1–2). No snapshots.
- Every existing accessible name stays. The route sweep and `nav-link.test.tsx`
  pin them.
- `allow_test_edits_during_impl` is false: an implementation subagent that
  edits a test file has its diff thrown away.

## 3. Verify each unit

Every gate in `00-session-protocol.md` "Verification", the container included
(rebuild the test image first). Run the guard over the real diff before
pushing. Fill in the browser checklist from `verification.md` §3 for what you
touched, or mark each row NOT DONE. A styling PR that says "looks good" with
no browser behind it is the failure `human-decisions.md` §3 exists to prevent.

Four PRs (D1, UI-001, UI-002, UI-003). Merge nothing.
