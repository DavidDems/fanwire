import type { UnitBudget } from "../bundle-budget";

export default {
  unit: "FRONTEND-022",
  entryJsGzipGrowth: 512,
  entryJsRawGrowth: 1_000,
  entryCssGzipGrowth: 113,
  changed: {
    GamePage: 3_884,
    "css:GamePage.css": 1_081,
  },
  added: {
    PeriodScores: 2_000,
  },
} satisfies UnitBudget;
