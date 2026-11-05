import type { UnitBudget } from "../bundle-budget";

/** USERS-007 optional email-verification and profile-onboarding UI allowance. */
export default {
  unit: "USERS-007",
  entryJsRawGrowth: 2_048,
  entryJsGzipGrowth: 1_000,
  entryCssGzipGrowth: 1_000,
  changed: {
    SignUpPage: 1_500,
  },
} satisfies UnitBudget;
