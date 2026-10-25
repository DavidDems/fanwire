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
// The Director's correction after a build of the implementation (R20): the
// reads in api/stats.ts and links.ts share one chunk, which Rollup names
// after Stats.module, so `links` is gone; SegmentedTabs' stylesheet is a new
// lazy output. Measured (gzip): SeasonsTab 4,599, Stats.module 1,036,
// PlayersTab 1,138, format 430, StatsPage 386 (7,589); css:Stats.css 1,094,
// css:StatsPage.css 398, css:SeasonsTab.css 364 (1,856). The ceilings keep
// the two sums at 7,800 and 1,900. Respread after the skeptic's second
// pass so every JS output has at least 24 B over its measured size.
const budget: UnitBudget = {
  unit: "FRONTEND-018",
  entryJsGzipGrowth: 100,
  entryJsRawGrowth: 200,
  changed: {
    StatsPage: 410,
    SeasonsTab: 4_685,
    PlayersTab: 1_170,
    "Stats.module": 1_080,
    format: 455,
    "css:Stats.css": 1_115,
    "css:StatsPage.css": 410,
  },
  added: {
    "css:SeasonsTab.css": 375,
  },
  removed: ["links"],
};

export default budget;
