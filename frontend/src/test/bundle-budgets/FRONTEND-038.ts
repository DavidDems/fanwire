import type { UnitBudget } from "../bundle-budget";

/**
 * FRONTEND-038 removes an entry-loaded floating control and its icon. The
 * entry and its stylesheet may not grow; no lazy output changes.
 */
export default {
  unit: "FRONTEND-038",
  entryJsRawGrowth: 0,
  entryCssGzipGrowth: 0,
} satisfies UnitBudget;
