import type { UnitBudget } from "../bundle-budget";

export default {
  unit: "POSTS-008",
  entryJsRawGrowth: 2_048,
  entryJsGzipGrowth: 1_000,
  // Sharing the in-page tabs with History extracts them from the navigator.
  changed: { StatsNavigator: 4_010 },
  removed: ["css:StatsNavigator.css"],
  added: {
    HistoryPage: 4_000,
    "css:HistoryPage.css": 700,
    SegmentedTabs: 1_400,
    "css:SegmentedTabs.css": 500,
  },
} satisfies UnitBudget;
