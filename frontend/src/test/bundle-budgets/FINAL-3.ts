import type { UnitBudget } from "../bundle-budget";

/**
 * Final track item 3 (ADR 0045): unmapped Cognito codes get fixed text.
 * `errors` gains `pageAlert`, its two messages and the throttled-code set
 * (moved from `ForgotPasswordPage`): measured with this test's build on the
 * finished implementation against `BASE`, it is 368 B gzip (+101, just past
 * the 100 B tolerance; the ceiling rounded up to the next 100). Every other
 * lazy output and the entry stay within tolerance, and none was added or
 * removed.
 */
const budget: UnitBudget = {
  unit: "FINAL-3",
  changed: { errors: 400 },
};

export default budget;
