import type { UnitBudget } from "../bundle-budget";

/**
 * AUTH-001 finishes the native Cognito reset: the verify reminder, one answer
 * for every address, Confirm password on reset and sign-up, the sign-out
 * before recovery, and Account details on the settings page.
 *
 * Measured on outstanding-track-6 at fb1f8a4 with this test's build, before
 * and after the unit (gzip bytes):
 *
 * - Entry JS: 146,947 → 146,947 gzip, 465,011 → 465,025 raw. Within the
 *   tolerance; no growth is declared.
 * - Entry CSS: 7,449 → 7,450.
 * - ForgotPasswordPage: 1,199 → 1,675, the reminder, the generic answer, the
 *   Confirm password field and the sign-out. Ceiling 1,900.
 * - AccountSettings: 2,404 → 2,598, the Account details section. Ceiling
 *   2,800.
 *
 * Moved within the tolerance, so not declared: SignUpPage 1,030 → 1,097,
 * css:AccountSettings.css 403 → 485, errors 235 → 267.
 */
export default {
  unit: "AUTH-001",
  entryJsGzipGrowth: 0,
  entryJsRawGrowth: 0,
  entryCssGzipGrowth: 0,
  changed: {
    ForgotPasswordPage: 1_900,
    AccountSettings: 2_800,
  },
} satisfies UnitBudget;
