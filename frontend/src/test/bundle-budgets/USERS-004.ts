import type { UnitBudget } from "../bundle-budget";

export default {
  unit: "USERS-004",
  entryJsGzipGrowth: 1_000,
  entryJsRawGrowth: 2_000,
  entryCssGzipGrowth: 39,
  changed: {
    ProfilePage: 3_121,
    "css:ProfilePage.css": 813,
  },
} satisfies UnitBudget;
