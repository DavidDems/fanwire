# 05 — Brand assets: one check left

**Why:** the brand assets are made, approved and in the branding PR (#92).
They're under `brand/`, with masters and `PROVENANCE.md` in `brand/source/` and
exports in `brand/out/`. One check from `wiki/CodeContext/FrontendUI/branding.md`
§10 is still open, and only you can do it.

## Still needs you

- [ ] **Search the Canadian Trademarks Database**
  (https://ised-isde.canada.ca/cipo/trademark-search/srch).
  1. Search the **word** `fanwire`.
  2. Search **design marks** by Vienna code for the letter "f" and for wires,
     cables or plugs. "Additional search options" on the database's help pages
     explains Vienna codes.

  **Confirm:** no live mark is close to the name or to the wire-`f` symbol.
  Tell the agent the result so it can go into `brand/source/PROVENANCE.md`.
  If something is close, raise it before PR #92 merges.

  Google Lens and TinEye are done: no matches (2026-10-05).

## Already done (2026-10-05)

- The symbol: generated, traced and approved.
- The icon set, the wordmarks (Outfit 600) and the Open Graph image: built and
  approved.
- The provenance record.

## After this

Once the check is done and PR #92 is merged, delete this file and its row in
`TODO/README.md`. Placing the files into `frontend/` and wiring `index.html` is
an agent's implementation unit, planned by prompt 11 (`branding.md` §8).
