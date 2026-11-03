import type { UnitBudget } from "../bundle-budget";

/**
 * EVENTS-011: records show 73–9 (.890) and 12 (57.1%), switched on
 * `value_kind`. Everything it touches is in the lazy Records chunk and the
 * navigator's stylesheet, so the entry does not grow: its gzip and raw
 * growth are 0 (the base's 0.1 kB tolerance holds Vite's noise), well inside
 * the spec's 2 KiB raw and 1 KiB gzip.
 *
 * - `RecordsTab`: `recordLabels`, `RecordLevel` and `RecordsLevel` (the
 *   formats by kind, the visually-hidden phrase), base 3,205.
 * - `StatsNav.module` and `css:StatsNav.css`: a class for the muted
 *   percentage, if the unit adds one, base 445 and 1,295.
 */
export default {
  unit: "EVENTS-011",
  entryJsGzipGrowth: 0,
  entryJsRawGrowth: 0,
  entryCssGzipGrowth: 0,
  changed: {
    RecordsTab: 3_700,
    "StatsNav.module": 520,
    "css:StatsNav.css": 1_400,
  },
} satisfies UnitBudget;
