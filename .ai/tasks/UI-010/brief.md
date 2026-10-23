# UI-010: soft-filled inputs and the shared primitives for the stats and compose redesign

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

Stage 1 of `wiki/GeneralContext/Prompts/20-stats-navigation-and-compose-modal.md`.
The human finds the inputs dated. Later units of the thread also need three
shared pieces this unit builds first, so they aren't built three times:
- an in-page tab bar (Seasons' All / East / West, Records' Historical /
  Seasonal and Team / Player);
- the floating **+** button;
- a search field with an icon.

## Decided by the human (2026-10-23, by `AskUserQuestion`)

- **Soft filled:**
  - no outline at rest, a muted fill, a 12 px radius, 48 px tall, the label
    above;
  - on focus, the fill lightens and an accent ring appears;
  - selects get a custom chevron, and search fields get a leading icon.
- **The post cards and the thread design stay as they are.** The reply text
  box inside the thread is an input, so it takes the new input style like
  every other field; the cards around it don't change.

## The skeptic

A separate agent is deployed against this thread's complexity and latency
(the Director's thread brief, "The skeptic").
- **Before this branch is cut**, it reviews criterion 11, the
  provisional **Baseline**, and confirms or tightens it. Any change lands as
  a spec amendment first.
- **Before the PR is handed over**, it checks every Baseline line against the
  diff and the build output, and lists each as met, missed or unmeasured.

For this unit the risk is small, since it's CSS plus three small
components. The Baseline mainly keeps it that way: no dependency, no
runtime styling work, and a few kilobytes at most.

## Traps

- **WCAG 1.4.11.** A field with no outline is identified only by its fill,
  so the fill needs 3:1 against the background it sits on, in both themes.
  The muted surface today (`#e6eef2` on white) likely won't reach that.
  Measure it. If no fill both passes and stays "soft", add the bottom rule
  the spec allows, and say so in the PR rather than shipping a failing fill.
- **Focus must not move anything.** Use an outline or a box-shadow for the
  ring, never a border that appears on focus. The spec pins equal border
  boxes.
- **The select chevron and the CSP.** Check what `img-src` allows before
  reaching for a data URI. A CSS-only chevron (a mask on a pseudo-element of
  a wrapper, or a background gradient) needs nothing.
- **`styles/base.test.ts`** pins today's values and forbids a keyframes
  at-rule anywhere, test files included. The test step updates the values it
  pins, in the test commit.
- **`SegmentedTabs` is not `Tabs`.** `Tabs` is navigation (each tab is a
  route, and `aria-current`). `SegmentedTabs` switches a panel on the same
  page (`tablist`).
- **`FloatingButton` has no caller here.** FRONTEND-020 mounts it.
- **`prettier --write` on named files only.**

## Not in this task

Any change to the post cards, `Button`, `Card`, `Dialog`, `Menu` or
`Skeleton`; any stats or compose screen (FRONTEND-018 to -021 adopt these
pieces); any new dependency.
