import type { UnitBudget } from "../bundle-budget";

export default {
  unit: "FRONTEND-023",
  entryJsGzipGrowth: 512,
  entryJsRawGrowth: 1_000,
  entryCssGzipGrowth: 0,
  changed: {
    PlayerPage: 5_149,
    "css:PlayerPage.css": 1_004,
    StatsNavigator: 8_196,
    "css:StatsNavigator.css": 564,
    "StatsNav.module": 425,
    "css:StatsNav.css": 1_252,
  },
} satisfies UnitBudget;
