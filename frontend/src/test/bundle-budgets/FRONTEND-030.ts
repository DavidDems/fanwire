import type { UnitBudget } from "../bundle-budget";

/**
 * FRONTEND-030: the records home and its search. Within the spec's caps:
 * the entry grows at most 2 KiB raw and 1 KiB gzip, and no output reaches
 * 500,000 raw bytes.
 *
 * - The entry: AppLayout chooses main's column from the route (a route match
 *   and a class), and its stylesheet gains `--content-max-wide` in
 *   `tokens.css` and the wide rule in `AppLayout.module.css`. A few dozen
 *   bytes gzip; the ceilings leave room for Vite's noise.
 * - `StatsNav.module` (base 457) and `css:StatsNav.css` (base 1,311): the
 *   grid's 64rem column rule, the card's category line and held holder area,
 *   the shot_pct share, the Load more row, the empty state and the count.
 * - `RecordsTab` (base 3,848, measured 6,272): the search, the paging, the
 *   featured page and the live region that announces the result count.
 */
export default {
  unit: "FRONTEND-030",
  entryJsGzipGrowth: 150,
  entryJsRawGrowth: 400,
  entryCssGzipGrowth: 60,
  changed: {
    RecordsTab: 6_700,
    "StatsNav.module": 650,
    "css:StatsNav.css": 1_700,
  },
} satisfies UnitBudget;
