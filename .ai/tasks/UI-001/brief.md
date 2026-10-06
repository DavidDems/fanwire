# UI-001 — Tokens and base styles

Part of the frontend styling pass planned in `wiki/CodeContext/FrontendUI/implementation-plan.md`. Run by hand from a Claude Code session (`wiki/GeneralContext/Prompts/13`–`16`), not by the orchestrator.

Every later styling unit depends on this one, so its numbers must be exactly
the ones in `tokens.md`. Copy the values; don't redesign them. If a pair fails,
the token table is wrong: stop and report it rather than nudging a hex.
`decisions.md` owns the four brand colours.

The contrast test is the unit's main deliverable. Write it in TypeScript with
no dependency: a small regex parser for custom properties in `:root` and in the
dark media block, then the WCAG 2.1 luminance formula. **Never round.** 4.499 is
a fail, and `#279ab1` on `#022b3a` is 4.501, a pass by 0.001. Mutation-test it:
set the dark `--color-link` to Teal and watch it go red.

jsdom computes no CSS (`verification.md` §1), so assert on the files, not on
`getComputedStyle`. Locate `src` from `process.cwd()` the way
`auth/sdk-isolation.test.ts` does, so the test works in the container too.
