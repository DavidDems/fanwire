import type { UnitBudget } from "../bundle-budget";

/**
 * FRONTEND-031: team icons. Within the spec's caps: the entry grows at most
 * 2 KiB raw and 1 KiB gzip, and no output reaches 500,000 raw bytes.
 *
 * **Every number here is an estimate, written in the test commit before
 * the implementation exists. The Director's measurement step re-measures
 * the build and tightens each ceiling to what it finds.**
 *
 * - The entry: the feed's game and player previews are in the entry
 *   (`LinkPreview` imports them statically), so `TeamIcon`, its stylesheet
 *   and `lib/teamColors.ts` (two eight- and five-entry palettes and a
 *   thirty-row mapping) load there, and the lazy chunks import them from it.
 *   About 1.4 kB raw and 0.6 kB gzip of JS; the CSS gains thirteen
 *   `--team-*` tokens in `tokens.css` and the icon's rules (a class per
 *   palette key, the sizes, the neutral form, forced colors).
 * - `StatsNavigator` (base 3,670): the icon beside standings rows and the
 *   team level. The records levels' changes land in `RecordsTab`,
 *   `StatsNav.module` and `css:StatsNav.css`, which `FRONTEND-030.ts` still
 *   declares until it is folded into the base; two files may not declare
 *   one output (`combine`), so the Director adds them here, if the
 *   measurement shows this unit moved them, once FRONTEND-030 is folded.
 * - `SeasonsTab` (base 1,662): the team search's options. `Stats.module`
 *   (375) and `css:Stats.css` (469): an option's icon and name in a row.
 * - `GamePage` (base 4,048) and `css:GamePage.css` (1,081): the header's
 *   two icons and each box score heading's.
 * - `PlayerPage` (base 3,833) and `css:PlayerPage.css` (879): the current
 *   team, a line the page did not have before.
 * - `StatsPicker` (base 2,205) and `css:StatsPicker.css` (466): the box
 *   score rows' team cells.
 */
export default {
  unit: "FRONTEND-031",
  entryJsGzipGrowth: 900,
  entryJsRawGrowth: 2_000,
  entryCssGzipGrowth: 600,
  changed: {
    StatsNavigator: 3_950,
    SeasonsTab: 1_850,
    "Stats.module": 450,
    "css:Stats.css": 560,
    GamePage: 4_300,
    "css:GamePage.css": 1_220,
    PlayerPage: 4_150,
    "css:PlayerPage.css": 1_020,
    StatsPicker: 2_400,
    "css:StatsPicker.css": 560,
  },
} satisfies UnitBudget;
