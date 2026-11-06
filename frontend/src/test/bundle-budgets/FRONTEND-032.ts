import type { UnitBudget } from "../bundle-budget";

/**
 * FRONTEND-032: the Invite button. Within the spec's caps: the entry grows at
 * most 2 KiB raw and 1 KiB gzip, and no output reaches 500,000 raw bytes.
 *
 * Declared in the test commit, before anything is measured: `AppLayout` is
 * imported statically by `routes/routes.tsx`, so `InviteButton`, its
 * stylesheet and the new `LinkIcon` all load in the entry and its stylesheet.
 * No lazy output imports any of them, so none is declared changed, added or
 * removed; each stays within the 0.1 kB tolerance of its base.
 */
export default {
  unit: "FRONTEND-032",
  entryJsRawGrowth: 2_048,
  entryJsGzipGrowth: 1_000,
  entryCssGzipGrowth: 500,
} satisfies UnitBudget;
