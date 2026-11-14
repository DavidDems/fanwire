---
type: runbook
---

# FrontendUI — token check scripts

**Agent-facing, for whoever changes a colour.** A styling unit doesn't need this page: its own contrast test (`verification.md`) re-checks `tokens.css` in TypeScript.

The steps that reproduce the numbers behind `tokens.md` §3 through `tokens.md`
§7, for a proposed palette or token change. The scripts are in `brand/tools/`;
they need numpy only, use the WCAG 2.1 luminance and CIEDE2000 maths of
`palette_check.py`, and print unrounded ratios. Run every step from the
repository root.

## 1. Download the three league pages

They are plain HTML tables (307 colours when read on 2026-10-06).

```powershell
foreach ($p in 'nba-team-color-codes','nfl-team-color-codes','mlb-color-codes') { curl.exe -sL -A "Mozilla/5.0" "https://teamcolorcodes.com/$p/" -o "$p.html" }
```

## 2. Parse every team colour

```powershell
python brand/tools/parse_teams.py
```

Expected: it writes `teams.json` and prints `307` followed by the per-league
counter (NBA 101, NFL 96, MLB 110 when read on 2026-10-06).

## 3. Check contrast, banned pairs and team distance

The token values are the `NEUTRAL`, `LIGHT` and `DARK` tables in
`brand/tools/tokens_check.py`; put a proposed value there first. It reads
`teams.json` from the current folder.

```powershell
python brand/tools/tokens_check.py
```

Expected: one `PASS` or `FAIL` line per required pair in each theme, the banned
pairs with their ratios, the neutral ramp, the nearest team colours, and a last
line of `FAILS: 0`. It exits non-zero if any required pair fails.

## 4. Check a candidate against the palette, the teams and colour-vision deficiency

```powershell
python brand/tools/palette_check.py name=#hex
```

Expected: the WCAG 2.1 contrast of every pair among the palette, the candidate
and white; the three nearest team colours for each (CIEDE2000, from the
script's excerpt of near neighbours); and the simulated protanopia,
deuteranopia and tritanopia distances.

## 5. Constraints a new value must meet

- **Neutral ramp:** stepped along Jet Black's hue, so `--neutral-600` clears
  4.5:1 on every light surface and `--neutral-500` clears 3:1 for input
  boundaries.
- **State colours:** kept to the hue band that reads as the state (red for
  danger, amber for warning, green for success, raspberry for live), passing
  every pair step 3 checks, and chosen to maximise the minimum ΔE to all 307
  team colours. The hue band is a hard constraint: an unconstrained search
  drives "danger" to brown, which no longer reads as an error.

## 6. Remove the downloads

```powershell
Remove-Item nba-team-color-codes.html, nfl-team-color-codes.html, mlb-color-codes.html, teams.json
```
