import type { UnitBudget } from "../bundle-budget";

export default {
  unit: "USERS-006",
  entryJsRawGrowth: 2_048,
  entryJsGzipGrowth: 1_000,
  // AppLayout.module.css is in the entry stylesheet; this holds its menu
  // target/layout change.
  entryCssGzipGrowth: 1_000,
  // Deactivation leaves ProfilePage and is added to its own lazy settings page.
  changed: {
    ProfilePage: 3_121,
    "css:ProfilePage.css": 813,
  },
  added: {
    AccountSettings: 12_000,
    "css:AccountSettings.css": 3_000,
  },
} satisfies UnitBudget;
