import type { UnitBudget } from "../bundle-budget";

/**
 * FRONTEND-044: the Schedule page, its nav item, the schedule client and the
 * compact game card shared with Recent Games.
 *
 * The unit adds six lazy outputs and changes no base output past its
 * tolerance or an earlier unit's ceiling (Recent Games' chunk and stylesheet,
 * FRONTEND-037's, shrink as the card moves out):
 *
 * - `SchedulePage`, `css:SchedulePage.css`: the page and its cells, measured
 *   2,266 and 552 bytes gzip.
 * - `GameCard`, `css:GameCard.css`: the card, out of Recent Games into a chunk
 *   both pages load, 607 and 496.
 * - `useQueries`: TanStack Query's `useQueries`, now used by the Schedule page
 *   as well as the stats pages, so Rollup splits it out, 1,525.
 * - `ok`: `api/ok.ts`, now shared by the stats and schedule clients, 150.
 *
 * Each ceiling is that measurement plus headroom. The entry grows only by the
 * route and the nav item (with its calendar icon), and stays within the
 * combined ceilings, so no entry growth is declared: `npm run build` measured
 * it at 478.85 kB raw and 152.14 kB gzip, under the 480 kB raw hard limit.
 */
export default {
  unit: "FRONTEND-044",
  added: {
    SchedulePage: 2_600,
    "css:SchedulePage.css": 700,
    GameCard: 750,
    "css:GameCard.css": 600,
    useQueries: 1_700,
    ok: 250,
  },
} satisfies UnitBudget;
