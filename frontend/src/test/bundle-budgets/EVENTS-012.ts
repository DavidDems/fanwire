import type { UnitBudget } from "../bundle-budget";

/**
 * EVENTS-012: the records registry becomes a catalog of at least 100 records,
 * and the Records screen reads holders through the new route. Everything it
 * touches is in the lazy Records chunk, so the entry does not grow: its gzip
 * and raw growth are 0 (the base's 0.1 kB tolerance holds Vite's noise), well
 * inside the spec's 2 KiB raw and 1 KiB gzip.
 *
 * - `RecordsTab`: the catalog query (`GET /events/records`), the holders
 *   query (`GET /events/records/holders?ids=`) and `SCREEN_RECORDS`, the ids
 *   the screen asks holders for. Base 3,541, measured 3,848.
 */
export default {
  unit: "EVENTS-012",
  entryJsGzipGrowth: 0,
  entryJsRawGrowth: 0,
  entryCssGzipGrowth: 0,
  changed: {
    RecordsTab: 4_100,
  },
} satisfies UnitBudget;
