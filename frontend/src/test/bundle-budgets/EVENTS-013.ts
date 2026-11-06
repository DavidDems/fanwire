import type { UnitBudget } from "../bundle-budget";

// The shared budget harness also enforces the 500,000 raw-byte output cap.
export default {
  unit: "EVENTS-013",
  entryJsRawGrowth: 2_048,
  entryJsGzipGrowth: 1_000,
  entryCssGzipGrowth: 0,
  added: { RecentGames: 3_000, "css:RecentGames.css": 1_200 },
} satisfies UnitBudget;
