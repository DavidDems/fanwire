# FRONTEND-031: team icons

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Decided by the human, 2026-11-02

Team logos cannot be used, so each team gets an icon: its initials, on an inner
colour, with an outer ring, as plain text and CSS. This supersedes "no team colours
anywhere" (`FrontendUI/components.md`, `direction.md`, `branding.md` §10). The human
knows those entries and is doing this regardless; the decision is recorded in
`human-decisions.md` §5.

"Initials" means the stored `abbreviation` (BOS, LAL), already in every team
response and already shown as text.

## The palette

Chosen by a sub-agent under a hard cap, then remapped by the Director for accuracy.
A script computed every contrast below. Every inner colour takes black text, which
is why dark team colours are rings and inner colours are lighter tints: a real
Celtics green under black text would fail contrast. Each list has one colour per hue
family, at least CIEDE2000 20 apart.

**Inner** (8):

| Key | Name | Hex | On black text |
|---|---|---|---|
| `gold` | Gold | `#FFD23F` | 14.54 |
| `orange` | Orange | `#F58A1F` | 8.54 |
| `red` | Red | `#FA7B82` | 8.22 |
| `green` | Green | `#7CC24B` | 9.68 |
| `sky` | Sky Blue | `#4FA8F7` | 8.28 |
| `lavender` | Lavender | `#A98DE6` | 7.64 |
| `silver` | Silver | `#D3D8DC` | 14.63 |
| `teal` | Teal | `#26D0C0` | 10.87 |

**Outer** (5):

| Key | Name | Hex |
|---|---|---|
| `blue` | Blue | `#0A4A9A` |
| `crimson` | Crimson | `#9B0F26` |
| `black` | Black | `#0A0A0A` |
| `purple` | Purple | `#6A1B8F` |
| `forest` | Forest Green | `#0B5D2E` |

## The mapping

Pairs repeat on purpose (18 distinct across 30): with
this few colours, requiring a unique pair for every team gave Chicago a green ring.
The letters tell teams apart, and the colours say roughly who they are. Accuracy is
limited by the single shade each hue gets: reds and golds are lighter than the real
thing, and navy and royal share `blue`.

| Team | Inner | Outer | Ring contrast |
|---|---|---|---|
| ATL | `red` | `black` | 7.75 |
| BKN | `silver` | `black` | 13.79 |
| BOS | `green` | `forest` | 3.69 |
| CHA | `teal` | `purple` | 5.02 |
| CHI | `red` | `black` | 7.75 |
| CLE | `gold` | `crimson` | 5.84 |
| DAL | `sky` | `blue` | 3.37 |
| DEN | `gold` | `blue` | 5.91 |
| DET | `sky` | `crimson` | 3.32 |
| GSW | `gold` | `blue` | 5.91 |
| HOU | `silver` | `crimson` | 5.87 |
| IND | `gold` | `blue` | 5.91 |
| LAC | `red` | `blue` | 3.34 |
| LAL | `gold` | `purple` | 6.71 |
| MEM | `sky` | `blue` | 3.37 |
| MIA | `red` | `black` | 7.75 |
| MIL | `silver` | `forest` | 5.58 |
| MIN | `green` | `blue` | 3.93 |
| NOP | `gold` | `blue` | 5.91 |
| NYK | `orange` | `blue` | 3.47 |
| OKC | `sky` | `blue` | 3.37 |
| ORL | `sky` | `black` | 7.80 |
| PHI | `red` | `blue` | 3.34 |
| PHX | `orange` | `purple` | 3.94 |
| POR | `red` | `black` | 7.75 |
| SAC | `lavender` | `black` | 7.20 |
| SAS | `silver` | `black` | 13.79 |
| TOR | `red` | `black` | 7.75 |
| UTA | `gold` | `black` | 13.71 |
| WAS | `red` | `blue` | 3.34 |

## Traps

- **No outer colour reaches 3:1 against the dark surface** (`#0F1417`): black is
  1.07. The inner fill still makes the icon visible, and the letters carry its
  meaning, so the ring is decoration on dark. Add a 1 px `--color-border` hairline
  outside the ring so a black ring still reads as a ring. Check it in the dark rows.
- `FrontendUI/tokens.md` documents the theme tokens. These stay fixed between themes:
  a team's colours do not change with the page.
- `tokens-check.md` and `tokens.test.ts` may list tokens: follow them.
- Keep the mapping as data, one row per team, not branching in the component.
- `USERS-005` reads the two palette arrays for the avatar picker, so keep them
  exported and ordered.
- Team name lookups are not needed: every response that names a team has its
  abbreviation, except `GameScore`-style strings; check each site.

## Later Director PR, not this spec

`FrontendUI/components.md` and `tokens.md` for `TeamIcon` and the tokens as built.
