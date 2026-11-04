import type { UnitBudget } from "../bundle-budget";

/**
 * FRONTEND-031: team icons. Within the spec's caps: the entry grows at most
 * 2 KiB raw and 1 KiB gzip, and no output reaches 500,000 raw bytes.
 *
 * Measured by the test's own build on agent/FRONTEND-031 (63a836e) against
 * `BASE` (main 9d0012f with FRONTEND-030 folded in). Largest output 469,936
 * bytes raw (the entry).
 *
 * - The entry: the feed's game and player previews are in the entry
 *   (`LinkPreview` imports them statically), so `TeamIcon`, its stylesheet
 *   and `lib/teamColors.ts` load there, and the lazy chunks import them from
 *   it. JS 468,154 → 469,936 raw (+1,782) and 148,665 → 149,292 gzip (+627);
 *   CSS 5,831 → 6,297 gzip (+466): thirteen `--team-*` tokens in
 *   `tokens.css` and the icon's rules. The icon's styles all live in the
 *   entry, so no lazy stylesheet but `StatsNav.css` moved.
 * - `StatsNavigator` 3,681 → 3,736: the icon beside standings rows, the
 *   season and team levels.
 * - `RecordsTab` 6,270 → 6,321, `StatsNav.module` 472 → 478 and
 *   `css:StatsNav.css` 1,427 → 1,442: the records levels' icons and their
 *   row rule.
 * - `SeasonsTab` 1,663 → 1,691: the team search's options.
 * - `GamePage` 4,049 → 4,079: the header's and box scores' icons.
 * - `PlayerPage` 3,833 → 3,929: the current team, a new line.
 * - `StatsPicker` 2,206 → 2,225: the box score rows' team cells.
 *
 * Each is within the 0.1 kB tolerance of its base, but this unit's diff
 * changes it, so it is declared, with a ceiling a little over the measure.
 */
export default {
  unit: "FRONTEND-031",
  entryJsGzipGrowth: 750,
  entryJsRawGrowth: 2_000,
  entryCssGzipGrowth: 550,
  changed: {
    StatsNavigator: 3_900,
    RecordsTab: 6_500,
    "StatsNav.module": 550,
    "css:StatsNav.css": 1_550,
    SeasonsTab: 1_800,
    GamePage: 4_250,
    PlayerPage: 4_100,
    StatsPicker: 2_350,
  },
} satisfies UnitBudget;
