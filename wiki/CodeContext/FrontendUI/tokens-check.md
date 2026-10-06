# FrontendUI — token check scripts

**Agent-facing, for whoever changes a colour.** The two scripts behind every
figure in `tokens.md` §3–§7. A styling unit doesn't need this page: its own
contrast test (`verification.md`) re-checks `tokens.css` in TypeScript. Read it
when you propose a palette or token change and have to show the new numbers.

They extend `branding.md` §9's `palette_check.py`, with the same WCAG 2.1
luminance and CIEDE2000 maths. They need numpy only. They were run on
2026-10-06, and they print unrounded ratios.

## 1. `parse_teams.py`: every team colour

Download the three league pages first (they are plain HTML tables; read
2026-10-06, 307 colours):

```powershell
foreach ($p in 'nba-team-color-codes','nfl-team-color-codes','mlb-color-codes') { curl.exe -sL -A "Mozilla/5.0" "https://teamcolorcodes.com/$p/" -o "$p.html" }
```

```python
import re, json
out = {}
for league, f in (("NBA","nba-team-color-codes.html"),("NFL","nfl-team-color-codes.html"),("MLB","mlb-color-codes.html")):
    s = open(f, encoding="utf8").read()
    for row in re.findall(r"<tr>(.*?)</tr>", s, re.S):
        th = re.search(r'<th scope="row">\s*(.*?)\s*</th>', row, re.S)
        if not th: continue
        team = re.sub(r"<.*?>", "", th.group(1)).strip()
        for td in re.findall(r"<td>(.*?)</td>", row, re.S):
            td = re.sub(r"<.*?>", "", td)
            m = re.search(r"(.*?)\s*(#[0-9a-fA-F]{6})", td)
            if m: out[f"{league} {team} {m.group(1).strip()}"] = m.group(2).upper()
json.dump(out, open("teams.json","w"), indent=0)
from collections import Counter
print(len(out), Counter(k.split()[0] for k in out))
```

## 2. `tokens_check.py`: contrast, banned pairs and team distance

Run `python tokens_check.py` next to `teams.json`. It exits non-zero if any
required pair fails.

```python
"""fanwire token check: every text/background pair, unrounded, plus CIEDE2000
distance from every new chromatic colour to every NBA/NFL/MLB team colour.
Extends branding.md §9's palette_check.py (same maths)."""
import json, sys
import numpy as np

def rgb(h): h = h.lstrip("#"); return np.array([int(h[i:i+2], 16) for i in (0, 2, 4)]) / 255
def lin(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def lum(c): return float(lin(c) @ [0.2126, 0.7152, 0.0722])
def ratio(a, b): la, lb = sorted([lum(rgb(a)), lum(rgb(b))], reverse=True); return (la + 0.05) / (lb + 0.05)

def lab(c):
    xyz = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750],
                    [0.0193339, 0.1191920, 0.9503041]]) @ lin(c) / [0.95047, 1.0, 1.08883]
    f = np.where(xyz > (6 / 29) ** 3, np.cbrt(xyz), xyz / (3 * (6 / 29) ** 2) + 4 / 29)
    return np.array([116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])])

def de2000(c1, c2):
    L1, a1, b1 = lab(c1); L2, a2, b2 = lab(c2)
    C1, C2 = np.hypot(a1, b1), np.hypot(a2, b2); Cb = (C1 + C2) / 2
    G = 0.5 * (1 - np.sqrt(Cb**7 / (Cb**7 + 25**7)))
    a1p, a2p = a1 * (1 + G), a2 * (1 + G)
    C1p, C2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p, h2p = np.degrees(np.arctan2(b1, a1p)) % 360, np.degrees(np.arctan2(b2, a2p)) % 360
    dLp, dCp = L2 - L1, C2p - C1p
    dh = h2p - h1p
    if C1p * C2p == 0: dh = 0
    elif dh > 180: dh -= 360
    elif dh < -180: dh += 360
    dHp = 2 * np.sqrt(C1p * C2p) * np.sin(np.radians(dh / 2))
    Lbp, Cbp = (L1 + L2) / 2, (C1p + C2p) / 2
    hs = h1p + h2p
    if C1p * C2p == 0: hbp = hs
    elif abs(h1p - h2p) <= 180: hbp = hs / 2
    else: hbp = (hs + 360) / 2 if hs < 360 else (hs - 360) / 2
    T = (1 - 0.17 * np.cos(np.radians(hbp - 30)) + 0.24 * np.cos(np.radians(2 * hbp))
         + 0.32 * np.cos(np.radians(3 * hbp + 6)) - 0.20 * np.cos(np.radians(4 * hbp - 63)))
    dtheta = 30 * np.exp(-(((hbp - 275) / 25) ** 2))
    Rc = 2 * np.sqrt(Cbp**7 / (Cbp**7 + 25**7))
    Sl = 1 + 0.015 * (Lbp - 50) ** 2 / np.sqrt(20 + (Lbp - 50) ** 2)
    Sc, Sh = 1 + 0.045 * Cbp, 1 + 0.015 * Cbp * T
    Rt = -np.sin(np.radians(2 * dtheta)) * Rc
    return float(np.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh)))

# ---------------------------------------------------------------- tokens
NEUTRAL = {  # tinted toward Jet Black's hue
    "0": "#ffffff", "50": "#f3f7f9", "100": "#e6eef2", "200": "#d0dde4", "300": "#aabfca",
    "400": "#7f98a5", "500": "#5c7684", "600": "#465f6c", "700": "#2f4753", "800": "#173543",
    "900": "#022b3a", "950": "#011d28",
}
LIGHT = {
    "bg": NEUTRAL["50"], "surface": NEUTRAL["0"], "surface-muted": NEUTRAL["100"],
    "text": "#022b3a", "text-muted": NEUTRAL["600"], "border": NEUTRAL["200"], "border-strong": NEUTRAL["500"],
    "action": "#1f7a8c", "action-hover": "#17606f", "on-action": "#ffffff", "link": "#1f7a8c", "focus": "#1f7a8c",
    "brand-tile": "#022b3a", "on-brand-tile": "#bfdbf7",
    "danger": "#9b1c1c", "danger-subtle": "#fdecea",
    "success": "#1b6e4a", "success-subtle": "#e7f4ec",
    "warning": "#8a5300", "warning-subtle": "#fdf1dc",
    "live": "#c0176f", "on-live": "#ffffff",
}
DARK = {
    "bg": NEUTRAL["950"], "surface": "#022b3a", "surface-muted": NEUTRAL["800"],
    "text": "#bfdbf7", "text-muted": "#8fb0c4", "border": "#1f4757", "border-strong": "#6d8fa1",
    "action": "#bfdbf7", "action-hover": "#e1eefb", "on-action": "#022b3a", "link": "#279ab1", "focus": "#bfdbf7",
    "brand-tile": "#022b3a", "on-brand-tile": "#bfdbf7",
    "danger": "#ffa08a", "danger-subtle": "#2e0f17",
    "success": "#6fd39a", "success-subtle": "#0e2a13",
    "warning": "#efbd71", "warning-subtle": "#3d350f",
    "live": "#f58cc8", "on-live": "#011d28",
}
# (foreground, background, minimum, kind)
PAIRS = [
    ("text", "bg", 4.5, "body text"), ("text", "surface", 4.5, "body text"), ("text", "surface-muted", 4.5, "body text"),
    ("text-muted", "bg", 4.5, "secondary text"), ("text-muted", "surface", 4.5, "secondary text"),
    ("text-muted", "surface-muted", 4.5, "secondary text"),
    ("link", "bg", 4.5, "link"), ("link", "surface", 4.5, "link"),
    ("on-action", "action", 4.5, "primary button label"), ("on-action", "action-hover", 4.5, "primary button label, hover"),
    ("live", "bg", 3.0, "live badge vs page (non-text)"), ("danger", "surface-muted", 4.5, "error text on muted"),
    ("action", "bg", 3.0, "primary button vs page (non-text)"), ("action", "surface", 3.0, "primary button vs card (non-text)"),
    ("focus", "bg", 3.0, "focus ring"), ("focus", "surface", 3.0, "focus ring"), ("focus", "surface-muted", 3.0, "focus ring"),
    ("border-strong", "bg", 3.0, "input boundary"), ("border-strong", "surface", 3.0, "input boundary"),
    ("danger", "surface", 4.5, "error text"), ("danger", "bg", 4.5, "error text"), ("danger", "danger-subtle", 4.5, "alert text on tint"),
    ("success", "surface", 4.5, "success text"), ("success", "success-subtle", 4.5, "status text on tint"),
    ("warning", "surface", 4.5, "warning text"), ("warning", "warning-subtle", 4.5, "warning text on tint"),
    ("on-live", "live", 4.5, "live badge label"), ("live", "surface", 3.0, "live badge vs card (non-text)"),
    ("on-brand-tile", "brand-tile", 4.5, "symbol on tile"),
]

FORBIDDEN = [  # pairs the plan bans; printed so the ban has a number beside it
    ("light", "#1f7a8c", "#022b3a", "Teal on Jet Black"), ("dark", "#279ab1", "#173543", "accent-on-dark on surface-muted"),
    ("dark", "#1f7a8c", "#011d28", "Teal on dark bg"), ("light", "#279ab1", "#ffffff", "accent-on-dark on white"),
    ("light", "#ffffff", "#c0176f", "(ok) white on live"), ("light", "#7f98a5", "#ffffff", "neutral-400 as text on white"),
]

def main():
    for th, fg, bg, what in FORBIDDEN:
        print(f"  banned/ref [{th}] {what}: {fg} on {bg} {ratio(fg, bg):.3f}:1")
    fails = 0
    for theme, t in (("light", LIGHT), ("dark", DARK)):
        print(f"== {theme}")
        for fg, bg, need, kind in PAIRS:
            r = ratio(t[fg], t[bg]); ok = r >= need; fails += not ok
            print(f"  {'PASS' if ok else 'FAIL'} {fg:>14} {t[fg]} on {bg:<14} {t[bg]}  {r:.3f}:1  (needs {need}) {kind}")
    print("== neutral ramp on white / on Jet Black")
    for k, v in NEUTRAL.items():
        print(f"  neutral-{k:<4} {v}  on white {ratio(v, '#ffffff'):.3f}  on ink {ratio(v, '#022b3a'):.3f}")
    teams = json.load(open("teams.json"))
    print("== new chromatic colours: nearest team colours (CIEDE2000), of", len(teams))
    new = {f"{th}.{k}": v for th, t in (("light", LIGHT), ("dark", DARK)) for k, v in t.items()
           if k in ("danger", "success", "warning", "live", "danger-subtle", "success-subtle", "warning-subtle")}
    new.update({"dark.text-muted": DARK["text-muted"], "dark.border": DARK["border"]})
    for n, h in new.items():
        near = sorted((de2000(rgb(h), rgb(c)), tn, c) for tn, c in teams.items())[:2]
        print(f"  {n:<22} {h}: " + "; ".join(f"{tn} {c} dE={d:.1f}" for d, tn, c in near))
    print("FAILS:", fails)
    return fails

if __name__ == "__main__":
    sys.exit(main())
```

## 3. How the values were chosen

- **Neutral ramp:** hand-stepped along Jet Black's hue, so `--neutral-600`
  clears 4.5 on every light surface and `--neutral-500` clears 3:1 for input
  boundaries.
- **State colours:** a grid search over hue, saturation and lightness, kept to
  the hue band that reads as the state (red for danger, amber for warning,
  green for success, raspberry for live). Each had to pass every pair in §2,
  and the pick maximised the minimum ΔE to all 307 team colours. An
  unconstrained search drives "danger" to brown, which no longer reads as an
  error, so the hue band is a hard constraint.
