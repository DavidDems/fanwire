# FrontendUI — index

**Agent-facing.** The look-and-feel reference the frontend was styled
from, and that any later frontend unit follows. The branding research created
the folder (colour and identity, 2026-10-05), and the UI plan filled in the
rest (direction, tokens, layout, components, verification, the unit plan) on
2026-10-06. **Every planned unit is built** (`D1`, `UI-001`…`UI-008`,
`FRONTEND-007`, merged by 2026-10-07); `layout.md` and `components.md`
describe the app as it is. What is left is in `TODO/02-backlog.md`.

**Precedence:** `decisions.md` (the human's) outranks every other page here.
`wiki/CodeContext/Standards/design-principles.md` and these pages outrank the
`ui-design` skill.

## Which file answers which question

| File | What it holds |
|---|---|
| [`decisions.md`](decisions.md) | The human's decisions, dated: palette and corrected contrast, the lowercase-name rule, the brand mark and assets, the `ui-design` skill's provenance, and the look-and-feel choices of 2026-10-06. Outranks every other page here. |
| [`direction.md`](direction.md) | The personality ("scoreboard-crisp, calm, dense"), what it borrows from, what fanwire is not, the fan moments to design for, principles in priority order. |
| [`tokens.md`](tokens.md) | Every token with its value, light and dark; the measured contrast of every pair used; banned pairs; distance from team colours; type, space, radius, elevation, motion, breakpoints, z-index. |
| [`tokens-check.md`](tokens-check.md) | The scripts behind `tokens.md`'s numbers. Only for someone proposing a colour change. |
| [`typography.md`](typography.md) | The system font stack and why, the scale, weights, tabular figures, the look-alike-username cost, and how `fanwire` is written. |
| [`layout.md`](layout.md) | The shell (header, bottom tab bar, skip link, brand link), the content column, breakpoints, one template per route, thread nesting. |
| [`components.md`](components.md) | Where styles live, the shared components with variants and states, icons, the score block, game state, team identity, mentions, and a map from every existing component to them. |
| [`accessibility.md`](accessibility.md) | WCAG 2.2 AA as numbered, testable statements (A1–A20), each tagged with how it's checked. |
| [`verification.md`](verification.md) | What jsdom can and can't show (measured), what tests assert, the no-snapshot rule, how a unit fails first, the browser checklist and how it's reported. |
| [`implementation-plan.md`](implementation-plan.md) | The Director PR (D1) and the eight worker units, in order, with acceptance criteria, `allowed_paths` and the files to hand each. |
| [`branding.md`](branding.md) | Brand research and how-to (the branding research, 2026-10-05): colour verdict, the wire-`f` symbol and typeset wordmark, ChatGPT usage, rights in Canada, free resources, export steps, the asset checklist with destinations, hazards. |

## What to hand which unit

Never the whole folder (`AGENTS.md` "Context loading"). Each unit's set is also
listed in `implementation-plan.md`:

| Unit | Hand it |
|---|---|
| Tokens and base (`UI-001`) | `tokens.md`, `accessibility.md`, `verification.md` |
| Shared components (`UI-002`) | `components.md`, `tokens.md` §8, `accessibility.md`, `verification.md` |
| Shell (`UI-003`) | `layout.md`, `components.md` §1–3, `accessibility.md`, `verification.md` |
| A feature unit (`UI-004` … `UI-008`, and `FRONTEND-007`) | its `layout.md` §3 row, `components.md`, `verification.md` |
| Brand placement (Director PR `D1`) | `implementation-plan.md` D1, `branding.md` §8 |
| Anyone proposing a palette or token change | `decisions.md`, `tokens.md`, `tokens-check.md` |
| A later frontend unit (`TODO/02-backlog.md`) | its `layout.md` §3 row, `components.md` §2 "As built" and §5, `verification.md`; and `implementation-plan.md` only for the reasoning behind a past unit |
