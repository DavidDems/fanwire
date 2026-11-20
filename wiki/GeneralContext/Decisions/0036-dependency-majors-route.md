---
type: decision
---

# 0036 - How dependency majors that need code changes land

Decision: 2026-11-20, the human, answering the Director during Outstanding-work
track 2 (`Prompts/31`).

## Context

Every pending Renovate major was probed alone from `main`'s manifest. Several
pass only with source changes, and some of those changes work on the new
version only (`msw` 3's `onUnhandledFrame`, `jsdom` 31's Blob internals). A unit
may not edit `package.json` (`.ai/policy.json` `_dependency_changes`), and a
frontend source edit is not a Director edit, so the docs named no route for a
change that has to land together with its bump. Two majors also grow the
bundle past its budget, and AWS now runs Python 3.15 and Postgres 18.

## Choice

- **Dual-version units.** Each major that needs code changes gets a `hand`
  unit, test-first and guarded, that makes the code work on the current *and*
  the new version. Renovate's pull request then merges unchanged. Support for
  the old version is removed by a follow-up unit inside the same track. No
  policy change: manifests still move only through Renovate or a Director PR,
  and nobody edits `package.json` by hand to land a major.
- **`vite` 8:** accept its measured growth (the lazy `Stats.module` chunk,
  377 to 502 B) as a declared budget. The bundle test stays strict.
- **React 19:** the unit reports what grew, takes the cheap wins (for example
  lazy-loading a heavy route), and declares the remaining growth as the new
  entry budget.
- **Python 3.15 and Postgres 18** are done in track 2, last, each as its own
  planned unit; Postgres 18 is an in-place RDS major upgrade behind a manual
  snapshot.
- Track 2 closes with nothing left over except what upstream blocks
  (`typescript` 7 until typescript-eslint, ts-jest and openapi-typescript
  accept it; the `aws-cdk-lib`-bundled `minimatch` alert until AWS ships 11).

## Consequences

- `Prompts/31` holds the unit order. Each unit names the Renovate pull
  requests it unblocks, and is proven on a local merged preview with the new
  versions before its Renovate pull request is ticked.
- A dual-version shim is temporary by definition; its removal is a named unit
  in the same track, never a backlog row.
- Bundle-budget growth is declared per unit, as any unit that changes output
  declares it.
