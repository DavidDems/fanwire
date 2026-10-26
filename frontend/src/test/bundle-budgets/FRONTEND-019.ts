import type { UnitBudget } from "../bundle-budget";

/**
 * FRONTEND-019 (the Records tab), Baseline (a): what the unit changes in the
 * bundle, as the skeptic's prototype measured it with `bundle-budget.test.ts`'s
 * own build (before figures from origin/main 4fc9b46; the prototype's in
 * brackets).
 *
 * - **The entry** grows by the Records route's `lazy()` line and Vite's
 *   preload list for its chunk only [+69 B gzip, +241 B raw]; no entry CSS.
 * - **The navigator becomes a shared chunk**, `StatsNavigator`, once Seasons
 *   and Records both import it [4,359], so SeasonsTab shrinks [1,771; before
 *   4,637] and the navigator's stylesheet, `css:StatsNavigator.css` [364],
 *   replaces `css:SeasonsTab.css`.
 * - **The leaders move** from Seasons to Records > Seasonal, and the Stats
 *   page's copy of the table CSS is retired (R24): `Stats.module` [1,214;
 *   before 1,055] and `css:Stats.css` [1,265; before 1,099].
 * - **RecordsTab** is the new lazy route [1,473].
 *
 * The declared JS sums to 9,850 and the CSS to 1,800. If Rollup names the
 * outputs otherwise, the Director corrects the names in its own commit after
 * a build of the implementation, keeping both sums (R20, R26).
 */
const budget: UnitBudget = {
  unit: "FRONTEND-019",
  entryJsGzipGrowth: 100,
  entryJsRawGrowth: 300,
  changed: {
    SeasonsTab: 1_900,
    "Stats.module": 1_350,
    "css:Stats.css": 1_400,
  },
  added: {
    RecordsTab: 1_700,
    StatsNavigator: 4_900,
    "css:StatsNavigator.css": 400,
  },
  removed: ["css:SeasonsTab.css"],
};

export default budget;
