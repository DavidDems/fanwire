import type { UnitBudget } from "../bundle-budget";

/**
 * The records tab's hand-made layout change (2026-11-04, Director branch
 * `director/records-tab-header`, no spec): one title on the records home
 * and the Historical / Seasonal bar in the group bar's row.
 *
 * - `SegmentedTabs` (base 585, measured 701): `end`, function children and
 *   the exported `SegmentedRow` that lays a bar beside other things.
 * - `RecordsTab` and `StatsNavigator` also move a little (the view bar's
 *   placement, the `rootCrumb` opt-out); FRONTEND-031's file already claims
 *   both, and they stay inside its ceilings.
 * - No entry growth: neither file is in the entry chunk.
 */
export default {
  unit: "records-tab-header",
  changed: {
    SegmentedTabs: 800,
  },
} satisfies UnitBudget;
