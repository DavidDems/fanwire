import type { UnitBudget } from "../bundle-budget";

/**
 * FRONTEND-039: tablet sidebar and home rail breakpoints. The shell and
 * HomeView are imported by the entry, so their CSS Modules and query logic
 * stay in the entry outputs. No lazy output is changed.
 */
export default {
  unit: "FRONTEND-039",
  entryJsRawGrowth: 1_024,
  entryJsGzipGrowth: 512,
  entryCssGzipGrowth: 512,
} satisfies UnitBudget;
