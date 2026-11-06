import type { UnitBudget } from "../bundle-budget";

/**
 * FRONTEND-037: compact game results and season-aware game views.
 *
 * The unit changes, and adds no lazy output:
 *
 * - `StatsNavigator`, `StatsNav.module`, `css:StatsNav.css`: the team level's
 *   result cards (a newest-first list, one link or button each, short names,
 *   W/L) and the cumulative wins-and-losses chart with its record table, in
 *   place of the point-margin chart and the dated games table.
 * - `format`: `teamShortName`, the team name without its city.
 * - `GamePage`, `css:GamePage.css`: team links in the heading that carry the
 *   season, and the two team tabs (winner first) over one box score at a time,
 *   in place of the spelled-out final-score sentence.
 * - `RecentGames`, `css:RecentGames.css`: the compact card (short names,
 *   overall records in parentheses, the losing side muted, season-aware link).
 * - `SeasonsTab`: the route adapter's game link with the season.
 * - `StatsPicker`, `css:StatsPicker.css`: the picker's game choices as the same
 *   result card.
 *
 * The entry may grow by the shared adapter's season argument and the links
 * that carry it: within 1 KiB raw and 512 bytes gzip, as the task allows. The
 * entry stylesheet does not change. Each ceiling below is the base's size plus
 * headroom for the change, and stays within the task's 8 KiB gzip per output.
 */
export default {
  unit: "FRONTEND-037",
  entryJsRawGrowth: 1_024,
  entryJsGzipGrowth: 512,
  entryCssGzipGrowth: 0,
  changed: {
    StatsNavigator: 5_800,
    "StatsNav.module": 800,
    "css:StatsNav.css": 2_300,
    format: 650,
    GamePage: 4_900,
    "css:GamePage.css": 1_400,
    RecentGames: 1_900,
    "css:RecentGames.css": 1_000,
    SeasonsTab: 1_900,
    StatsPicker: 2_500,
    "css:StatsPicker.css": 600,
  },
} satisfies UnitBudget;
