"""fanwire palette check: WCAG 2.1 contrast, CIEDE2000 distance to team colours,
and colour-vision-deficiency simulation (Machado, Oliveira & Fernandes 2009,
severity 1.0). numpy only."""
import sys
import numpy as np

PALETTE = {"ink": "#022b3a", "accent": "#1f7a8c", "sky": "#bfdbf7"}
EXTRA = dict(arg.split("=") for arg in sys.argv[1:])  # name=#hex candidates

def rgb(h): h = h.lstrip("#"); return np.array([int(h[i:i+2], 16) for i in (0, 2, 4)]) / 255
def lin(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def unlin(c): c = np.clip(c, 0, 1); return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)
def lum(c): return float(lin(c) @ [0.2126, 0.7152, 0.0722])
def ratio(a, b): la, lb = sorted([lum(a), lum(b)], reverse=True); return (la + 0.05) / (lb + 0.05)

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

CVD = {  # Machado et al. 2009, severity 1.0, applied in linear RGB
    "protanopia": [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    "deuteranopia": [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    "tritanopia": [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
}
def simulate(c, kind): return unlin(np.array(CVD[kind]) @ lin(c))
def hx(c): return "#" + "".join(f"{round(v * 255):02x}" for v in np.clip(c, 0, 1))

TEAMS = {  # teamcolorcodes.com, read 2026-10-05 (excerpt: the near neighbours;
           # the full run used every NBA/NFL/MLB colour on the league pages)
    "Charlotte Hornets teal": "#00788C", "Charlotte Hornets purple": "#1D1160",
    "San Jose Sharks Pacific teal": "#006D75", "Jacksonville Jaguars teal": "#006778",
    "Jacksonville Jaguars black": "#101820", "Miami Dolphins aqua": "#008E97", "Miami Dolphins blue": "#005778",
    "Philadelphia Eagles midnight green": "#004C54", "Seattle Mariners NW green": "#005C5C",
    "Seattle Mariners navy": "#0C2C56", "Seattle Kraken deep sea blue": "#001628",
    "Seattle Kraken ice blue": "#99D9D9", "Seattle Kraken shadow blue": "#68A2B9",
    "Seattle Kraken boundless blue": "#355464", "Houston Texans deep steel blue": "#03202F",
    "Tampa Bay Rays light blue": "#8FBCE6", "Miami Marlins blue": "#41748D",
    "Memphis Grizzlies beale st blue": "#5D76A9", "Memphis Grizzlies navy": "#12173F",
    "Denver Nuggets midnight blue": "#0E2240", "Minnesota Timberwolves blue": "#236192",
    "Dallas Mavericks silver": "#B8C4CA", "NBA logo blue": "#1D428A", "Vancouver Canucks dark blue": "#041C2C",
}

def main():
    W = rgb("#ffffff")
    cols = {**PALETTE, **EXTRA}
    print("== WCAG 2.1 contrast ==")
    names = list(cols) + ["white"]; vals = {**{n: rgb(h) for n, h in cols.items()}, "white": W}
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            print(f"  {a:>10} / {b:<10} {ratio(vals[a], vals[b]):5.2f}:1")
    print("== nearest team colours (CIEDE2000) ==")
    for n, h in cols.items():
        near = sorted((de2000(rgb(h), rgb(t)), tn, t) for tn, t in TEAMS.items())[:3]
        print(f"  {n:>10} {h}: " + "; ".join(f"{tn} {t} dE={d:.1f}" for d, tn, t in near))
    print("== colour-vision deficiency (simulated) ==")
    for kind in CVD:
        sim = {n: simulate(v, kind) for n, v in vals.items() if n != "white"}
        print(f"  {kind}: " + ", ".join(f"{n}->{hx(c)}" for n, c in sim.items()))
        keys = list(sim)
        for i, a in enumerate(keys):
            for b in keys[i + 1:]:
                print(f"     {a}/{b}: dE={de2000(sim[a], sim[b]):5.1f} contrast={ratio(sim[a], sim[b]):.2f}:1")

if __name__ == "__main__":
    main()
