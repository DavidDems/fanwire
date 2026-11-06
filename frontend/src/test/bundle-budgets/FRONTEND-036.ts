import type { UnitBudget } from "../bundle-budget";

/**
 * FRONTEND-036: the home page's right rail. Within the spec's caps: the entry
 * grows at most 2 KiB raw and 1 KiB gzip, and no output reaches 500,000 raw
 * bytes.
 *
 * Declared in the test commit, before anything is measured: `HomeView`,
 * `SearchBar` and `SearchPage` are imported statically by `routes/routes.tsx`,
 * so the rail, its results preview and compact rows, `useMediaQuery`, the
 * bar's submit to `/?q=`, and their stylesheets (the rail, `main`'s width on
 * `/` from 72em, the three-line clamp) all load in the entry and its
 * stylesheet. No lazy output imports any of them, so none is declared
 * changed, added or removed; each stays within the 0.1 kB tolerance of its
 * base.
 */
export default {
  unit: "FRONTEND-036",
  entryJsRawGrowth: 2_048,
  entryJsGzipGrowth: 1_000,
  entryCssGzipGrowth: 600,
} satisfies UnitBudget;
