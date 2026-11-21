---
type: decision
---

# 0041 - React 19's entry growth raises the entry cap

Decision: 2026-11-21, the human, answering the Director during Outstanding-work
track 2 (`Prompts/31`), after [ADR 0036](0036-dependency-majors-route.md).

## Context

ADR 0036 lets React 19's unit take cheap trims, then declare the remaining
growth as the new entry budget. Probed on `main` a777aae (vite 8), React 19
grows the entry (the entry chunk plus its static imports) from 149,210 to
172,561 bytes gzip and from 474,565 to 554,083 raw. All of it is
`react-dom` 19's client build; no application code moves. The bundle-budget
rules could not express that: R1 clamps the entry at 480 kB raw whatever a
unit declares, and R13 lets one unit grow it by at most 1 kB gzip.

R1 dates from when the entry was one file just under Vite's 500 kB per-file
warning. Since FRONTEND-046 the entry is several chunks (nine on React 19,
the largest 416 kB raw), and the per-file rule, no output file of
500,000 bytes or more, still holds every one of them. Trimming 75 kB raw
would mean lazy-loading sign-in (Cognito) or the home feed inside a
dependency bump, with behaviour risk on the app's two most important paths.

## Choice

- **Raise the cap, measured, not round.** A unit that lands a dependency
  major under ADR 0036 may declare entry growth past R13's 1 kB, and its raw
  growth lifts R1's cap by the same amount. Its unit file must name the
  major and this ADR; no other unit may. The growth it declares is the
  measured new entry minus `BASE`, plus at most 1% of the measured entry.
- **Cheap trims first.** The unit lazy-loads the routes that are not on the
  home path and keeps each trim that takes at least 1 kB gzip out of the
  entry with no behaviour change.
- **Every other rule stays strict.** Lazy outputs keep their ±100 B band and
  ceilings, and the per-file 500,000-byte limit is unchanged.
- **The fold resets the cap.** When React 19's unit is folded into `BASE`,
  `ENTRY_JS_RAW_HARD_MAX` becomes the measured React 19 entry plus about 1%,
  and later units are back under R13's 1 kB.
- **Trimming stays tracked.** The backlog row about the entry sitting near
  its limit stays open with the new numbers; real trimming (sign-in,
  `date-fns`, the `buffer` polyfill) belongs to the frontend track, where it
  can be browser-tested.

## Consequences

- React 19 and `eslint` 10 are not held; track 2 holds nothing that is not
  blocked upstream.
- First load grows by about 23 kB gzip, once, then is cached.
- The exception is narrow by construction: `combine` refuses a growth over
  1 kB from a unit file that does not name a dependency major and its ADR.
