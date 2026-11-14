---
type: decision
---

# 0014 - Look and feel

Decision: 2026-10-06, the human.

## Context

The look-and-feel plan (`wiki/CodeContext/FrontendUI/index.md`) proposed a direction, a styling
mechanism, a UI typeface and a Live colour, and the human chose at its
checkpoint. The detail is in the pages named on each line.

## Choice

- **Direction: "scoreboard-crisp, calm, dense."** Neutral surfaces tinted
  toward Jet Black; Teal only for actions and links; colour otherwise reserved
  for state and for Live. Not a team-coloured fan site, not a neon esports look
  (`wiki/CodeContext/FrontendUI/direction.md`).
- **Styling mechanism: CSS Modules plus one global token stylesheet**, with no
  new dependency (`wiki/CodeContext/FrontendUI/components.md` §1, `wiki/CodeContext/FrontendUI/verification.md`).
- **UI typeface: the system font stack.** Chosen over the recommended Atkinson
  Hyperlegible Next. No font file is shipped. The wordmark is still Outfit
  SemiBold (600) as SVG paths, so it doesn't depend on this
  (`wiki/CodeContext/FrontendUI/typography.md`).
- **Live is a raspberry accent, not red** (`#c0176f` light, `#f58cc8` dark), so
  it stays out of the team reds and doesn't share a colour with errors
  (`wiki/CodeContext/FrontendUI/tokens.md`).
- **No team logos in v1.** Teams are shown by name and abbreviation as text
  (`wiki/CodeContext/FrontendUI/components-sports.md` §4). The "as text" part is superseded in part by
  [ADR 0016](0016-team-icons-and-avatar-colours.md): each team also has a
  round icon in its colours. No logos still holds.

## Consequences

**Live was the reason for this check.** A conventional red Live badge
(`#c0262d`) is ΔE **2.2** from the Pistons' and Clippers' red `#C8102E`, so in
an NBA app it reads as a team's colour. Raspberry is clear of every team, and
it also separates "live" from "error" by hue. Danger is still a red: any red
that reads as an error sits near some team's red, so it is kept to text, thin
borders and tints, never a large fill. Every state colour's distance from the
team colours is `wiki/CodeContext/FrontendUI/tokens.md` §7.
