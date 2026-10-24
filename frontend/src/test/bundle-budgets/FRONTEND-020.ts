import type { UnitBudget } from "../bundle-budget";

/**
 * FRONTEND-020, the compose modal: the overlay route, the floating + and the
 * new image flow grow the entry (the skeptic's prototype: +807 B gzip, +2,907
 * raw, +222 CSS), and the compose chunk and its stylesheet change. Every other
 * lazy output is unchanged.
 */
const budget: UnitBudget = {
  unit: "FRONTEND-020",
  entryJsGzipGrowth: 1000,
  entryJsRawGrowth: 3500,
  entryCssGzipGrowth: 300,
  changed: { ComposePage: 5600, "css:ComposePage.css": 700 },
};

export default budget;
