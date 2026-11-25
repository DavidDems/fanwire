import type { UnitBudget } from "../bundle-budget";

/**
 * FRONTEND-053: `Field`'s checkbox and row layouts. `FormField` is in the
 * entry, so its new layout prop and its `.checkbox` and `.row` rules grow the
 * entry: measured with this test's build on the finished implementation, the
 * entry JS +109 B gzip and +267 B raw, the entry CSS +113 B gzip, each
 * ceiling rounded up to the next 100 B. The notifications page's own
 * exception into `Field`'s markup is deleted, so `css:NotificationsPage.css`
 * shrinks from 496 B to 365 B gzip (ceiling 400). Every other output stays
 * inside the 100 B tolerance.
 */
const budget: UnitBudget = {
  unit: "FRONTEND-053",
  entryJsGzipGrowth: 200,
  entryJsRawGrowth: 300,
  entryCssGzipGrowth: 200,
  changed: { "css:NotificationsPage.css": 400 },
};

export default budget;
