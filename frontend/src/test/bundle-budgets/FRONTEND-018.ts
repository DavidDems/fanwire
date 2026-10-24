import type { UnitBudget } from "../bundle-budget";

/**
 * FRONTEND-018 (the stats navigator, and Stats rebuilt on it), Baseline (a).
 *
 * The navigator is reached only from the lazy Stats page, so the entry is
 * held near its base: 100 B gzip and 200 B raw of growth, and no entry CSS.
 *
 * The Stats JS chunks together may reach 7,800 B gzip (base 6,830: StatsPage
 * 383, SeasonsTab 3,787, PlayersTab 1,131, links 740, Stats.module 359,
 * format 429), and the Stats stylesheets 1,900 B (base 1,254: Stats.css 902,
 * StatsPage.css 352). The headroom is spread in proportion to each output's
 * base size; the ceilings below sum to 7,798 and 1,899.
 *
 * Rollup names a chunk after its first module, so moving the reads to
 * `api/stats.ts` and adding `components/stats-nav/` may rename, add or remove
 * chunks (R20). The Director may correct the names here in its own commit
 * after a build of the implementation, keeping the two sums.
 */
const budget: UnitBudget = {
  unit: "FRONTEND-018",
  entryJsGzipGrowth: 100,
  entryJsRawGrowth: 200,
  changed: {
    StatsPage: 437,
    SeasonsTab: 4_325,
    PlayersTab: 1_291,
    links: 845,
    "Stats.module": 410,
    format: 490,
    "css:Stats.css": 1_366,
    "css:StatsPage.css": 533,
  },
};

export default budget;
