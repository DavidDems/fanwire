import type { UnitBudget } from "../bundle-budget";

/**
 * FRONTEND-050: the username rule as a standing hint on the profile-setup
 * form. The hint's text and `hint: true` on the username's `describeField`
 * grow `ProfileSetupPage`; nothing else moves. Measured with this test's
 * build: 1,539 B gzip before, 1,596 B with the hint; the ceiling rounds that
 * up (BASE 1,538 + 62 B, inside the 120 B the task allows).
 */
const budget: UnitBudget = {
  unit: "FRONTEND-050",
  changed: { ProfileSetupPage: 1_600 },
};

export default budget;
