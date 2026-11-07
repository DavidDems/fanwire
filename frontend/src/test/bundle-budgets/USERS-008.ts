import type { UnitBudget } from "../bundle-budget";

/** USERS-008 destructive account-deletion confirmation and success state. */
export default {
  unit: "USERS-008",
  entryJsRawGrowth: 2_048,
  entryJsGzipGrowth: 1_000,
  entryCssGzipGrowth: 1_000,
  changed: {
    AccountSettings: 3_500,
    "css:AccountSettings.css": 700,
  },
} satisfies UnitBudget;
