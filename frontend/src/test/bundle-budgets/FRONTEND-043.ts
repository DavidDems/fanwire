import type { UnitBudget } from "../bundle-budget";

/**
 * FRONTEND-043: Records > Seasonal's eleven leader cards, each with a View
 * all dialog of its top ten, in place of the three leader tables.
 *
 * The unit changes one lazy output, and adds none: `RecordsTab` (the leader
 * cards, the dialog table and the card shared with the Historical records)
 * measured 7,184 bytes gzip against a base of 6,394. The ceiling is that
 * measurement plus headroom. Every other output, the stats-nav stylesheet
 * and module included, stays within the base's tolerance.
 */
export default {
  unit: "FRONTEND-043",
  changed: {
    RecordsTab: 7_500,
  },
} satisfies UnitBudget;
