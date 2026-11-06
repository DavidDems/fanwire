import type { UnitBudget } from "../bundle-budget";

/**
 * FRONTEND-034: a reply's card shows its parent. Within the spec's caps: the
 * entry grows at most 2 KiB raw and 1 KiB gzip, and no output reaches 500,000
 * raw bytes.
 *
 * Declared in the test commit, before anything is measured: `PostNode`,
 * `PreparedPostNode` and `ThreadModal` are all in the entry (the feed, search
 * and the thread modal are imported statically by `routes/routes.tsx`), and
 * `PostNode.module.css` is in the entry's stylesheet. The lazy pages that
 * show cards (`HistoryPage`) import `PreparedPostNode` from the entry rather
 * than bundling it, so no lazy output is declared changed, added or removed;
 * each stays within the 0.1 kB tolerance of its base.
 */
export default {
  unit: "FRONTEND-034",
  entryJsRawGrowth: 2_048,
  entryJsGzipGrowth: 1_000,
  entryCssGzipGrowth: 400,
} satisfies UnitBudget;
