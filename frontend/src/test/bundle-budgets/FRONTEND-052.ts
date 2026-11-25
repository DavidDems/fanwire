import type { UnitBudget } from "../bundle-budget";

/**
 * FRONTEND-052: the frontend tidy-ups. The one shared `ScrollTable`
 * (`components/ui/`), imported by the stats chunks, the compose picker and
 * `PlayerPage`, becomes its own lazy chunk: 283 B gzip measured with this
 * test's build on the finished implementation, the ceiling rounded up to the
 * next 100 B. Every other output stays inside the 100 B tolerance (the entry
 * JS +92 B gzip, -12 B raw; the entry CSS +8 B), so nothing else is declared.
 */
const budget: UnitBudget = {
  unit: "FRONTEND-052",
  added: { ScrollTable: 300 },
};

export default budget;
