---
type: decision
---

# 0043 - Track 5b: the human's answers on track 5's leftovers

Decision: 2026-11-25, the human, answering the Director after Outstanding-work
track 5, whose close-out left four `TODO/02-backlog.md` "Frontend" rows waiting
on a decision. Builds on [ADR 0035](0035-outstanding-work-answers.md), which
set the Outstanding-work tracks.

## Context

Track 5 ran under a no-test-changes rule for its tidy-ups, so three of them
(moving `features/games/format.ts`, deleting `GameScore` and `UserIcon`,
renaming a stale test) were left undone: each pins a test. Two `.unavailable`
lines were italic against `typography.md`'s "No italics in the UI". The
floating **+** on phones can partly cover a control that Tab scrolls to. And
those rows, with three small ones beside them, had no track to run in.

## Choice

- **The tidy-ups may change tests.** The tests that pinned the moved file and
  the deleted components change with them (`FRONTEND-058`).
- **Drop the italic.** No documented exception: the two `.unavailable` rules
  lose `font-style: italic`, and "No italics in the UI" has no exceptions
  (`FRONTEND-059`, `FrontendUI/typography.md` §2).
- **Accept the floating + overlap as a known limitation.** On phones it covers
  80–136 px from the bottom, so a control at the right of a card can sit
  partly under it, never fully hidden. Clearing it would need about 140 px of
  scroll padding, which is not done (`FrontendUI/layout.md` §5).
- **Run them now, as track 5b**, on its own integration branch
  (`outstanding-track-5b`).

## Consequences

- `FRONTEND-058` and `FRONTEND-059` are track 5b's units; the four rows, and
  the apostrophe, profile-count and `tokens.md` budget rows, leave the backlog.
- The floating + row is closed without a change. Reopening it is a new
  decision.
