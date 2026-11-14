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
