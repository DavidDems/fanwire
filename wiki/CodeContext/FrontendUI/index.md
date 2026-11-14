---
type: reference
---

# FrontendUI — index

**Agent-facing.** The look-and-feel reference the frontend was styled
from, and that any later frontend unit follows: colour and identity,
direction, tokens, typography, layout, components, accessibility and
verification. `layout.md` and the `components` parts describe the app as it
is. What is left is in `TODO/02-backlog.md`.

## Precedence

The human's look-and-feel and brand decisions are ADRs 0010–0018 in
`wiki/GeneralContext/Decisions/` (listed below). These are inputs to every
file in this folder: a page here that contradicts one of them is wrong, not
the ADR. Only the human changes a decision; an agent that thinks one should
change says so in its PR and asks.
`wiki/CodeContext/Standards/design-principles.md` and these pages outrank the
`ui-design` skill ([ADR 0012](../../GeneralContext/Decisions/0012-ui-design-skill-precedence.md)).

## Which file answers which question

| File | What it holds |
|---|---|
| Decisions: ADR 0010–0018 | The human's decisions, dated; one ADR each (list below this table). They outrank every page here. |
| [`direction.md`](direction.md) | The personality ("scoreboard-crisp, calm, dense"), what it borrows from, what fanwire is not, the fan moments to design for, principles in priority order. |
| [`tokens.md`](tokens.md) | Every token with its value, light and dark; the measured contrast of every pair used; banned pairs; distance from team colours; type, space, radius, elevation, motion, breakpoints, z-index. |
| [`tokens-check.md`](tokens-check.md) | How to re-run the scripts behind `tokens.md`'s numbers (`brand/tools/`), and the constraints a new value must meet. Only for someone proposing a colour change. |
| [`typography.md`](typography.md) | The system font stack and why, the scale, weights, tabular figures, the look-alike-username cost, and how `fanwire` is written. |
| [`layout.md`](layout.md) | The shell (header, bottom tab bar, skip link, brand link), the content column, breakpoints, one template per route, the thread's reply list. |
| [`components.md`](components.md) | Where styles live, what needs a Director PR, and the index of the four component parts. |
| [`components-shared.md`](components-shared.md) | The shared components with variants, states and props as built, what is deliberately not built, and the icons. |
| [`components-sports.md`](components-sports.md) | The score block, game state, team identity and `TeamIcon`, mentions in posts. |
| [`components-map-pages.md`](components-map-pages.md) | The map from the shell, routes, search, games, schedule, stats and player views to what they use. |
| [`components-map-posts.md`](components-map-posts.md) | The map from `FormField`, auth, feed, posts, threads, compose, notifications and profile to what they use. |
| [`accessibility.md`](accessibility.md) | WCAG 2.2 AA as numbered, testable statements (A1–A20), each tagged with how it's checked. |
| [`verification.md`](verification.md) | What jsdom can and can't show (measured), what tests assert, the no-snapshot rule, how a unit fails first. |
| [`verification-browser.md`](verification-browser.md) | The browser checks: Playwright MCP, the per-unit checklist and how it's reported, the gates. |
| [`branding.md`](branding.md) | Brand research and how-to: colour verdict, the wire-`f` symbol and the wordmark, the asset checklist with destinations, hazards; the index of its three parts. |
| [`branding-rights.md`](branding-rights.md) | Rights in Canada for an AI-assisted mark, and the free resources with their licences. |
| [`branding-symbol.md`](branding-symbol.md) | Using ChatGPT for the symbol, and the ready-to-paste prompts. |
| [`branding-export.md`](branding-export.md) | Tracing, the master SVGs and exporting the icon set with free tools. |

Decisions:

  - [ADR 0010](../../GeneralContext/Decisions/0010-lowercase-brand-name.md): the brand name is always lowercase; the tagline.
  - [ADR 0011](../../GeneralContext/Decisions/0011-brand-palette.md): the four brand colours and their measured contrast.
  - [ADR 0012](../../GeneralContext/Decisions/0012-ui-design-skill-precedence.md): the `ui-design` skill's provenance and precedence.
  - [ADR 0013](../../GeneralContext/Decisions/0013-brand-mark-and-assets.md): the wire-`f` symbol, the wordmark, the assets and the header wordmark.
  - [ADR 0014](../../GeneralContext/Decisions/0014-look-and-feel.md): direction, CSS Modules, the system font stack, raspberry Live, no logos.
  - [ADR 0015](../../GeneralContext/Decisions/0015-inline-alert-id-prop.md): `InlineAlert` takes an `id`.
  - [ADR 0016](../../GeneralContext/Decisions/0016-team-icons-and-avatar-colours.md): team icons, and avatar colours (planned).
  - [ADR 0017](../../GeneralContext/Decisions/0017-navigation-and-home-rail.md): the sidebar, the two Search links, the home rail, reply context, no Invite.
  - [ADR 0018](../../GeneralContext/Decisions/0018-ui-adjustments-2026-11-07.md): the adjustments after the track: game view, Recent Games, records, Schedule.

## What to hand which unit

Never the whole folder (`AGENTS.md` "Context loading"):

| Unit | Hand it |
|---|---|
| Anyone proposing a palette or token change | [ADR 0011](../../GeneralContext/Decisions/0011-brand-palette.md), `tokens.md`, `tokens-check.md` |
| A later frontend unit (`TODO/02-backlog.md`) | its `layout.md` §3 row, `components-shared.md` §2 "As built", the components map part for its area (`components-map-pages.md` or `components-map-posts.md`), `verification.md`, and `verification-browser.md` for a hand-run browser pass |
