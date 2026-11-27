import type { UnitBudget } from "../bundle-budget";

/**
 * FINAL-4: dialog focus on a detail change. `Dialog` is in the entry, so its
 * new `detailKey` rule (a header and heading ref, the heading's `tabIndex`
 * and one layout effect) and `DetailModal` passing the flow's depth grow the
 * entry: measured with this test's build against the tip before the fix
 * (`6db0127`, 465,025 B raw and 146,943 B gzip, the base exactly), the
 * entry JS is 465,314 B raw (+289, past the 100 B tolerance; the ceiling
 * rounded up to the next 100) and 147,014 B gzip (+71, inside). The entry
 * CSS and every lazy output pass unchanged, and none was added or removed.
 */
const budget: UnitBudget = {
  unit: "FINAL-4",
  entryJsRawGrowth: 300,
};

export default budget;
