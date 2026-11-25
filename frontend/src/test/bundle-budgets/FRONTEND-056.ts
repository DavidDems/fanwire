import type { UnitBudget } from "../bundle-budget";

/**
 * FRONTEND-056: Skip to search. `HomeView` is in the entry, so its link (the
 * shell's `skipLink` class, `SearchBar`'s `BOX_ID` and a focusing `onClick`)
 * grows the entry: measured with this test's build on the finished
 * implementation against `BASE` refolded at `3084e22`, the entry JS is
 * 465,831 B raw (+171, past the 100 B tolerance; the ceiling rounded up to the
 * next 100) and 147,270 B gzip (+23, inside). The entry CSS is unchanged
 * (7,457 B gzip). Every lazy output moved by 3 B or less, and none was added
 * or removed.
 */
const budget: UnitBudget = {
  unit: "FRONTEND-056",
  entryJsRawGrowth: 200,
};

export default budget;
