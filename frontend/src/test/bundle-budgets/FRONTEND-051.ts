import type { UnitBudget } from "../bundle-budget";

/**
 * FRONTEND-051: the Cognito SDK loads lazily through `DeferredAuthService`.
 * `CognitoAuthService` and the SDK it imports become one new lazy chunk,
 * 26,421 B gzip measured with this test's build, rounded up to the next
 * 100 B. `AuthService.ts` (the `AuthError` class) leaves the entry with it:
 * the entry now imports only its types, so it becomes a 139 B shared chunk
 * for the auth pages, `AccountSettings` and the Cognito chunk. The entry
 * shrinks (554,756 B raw / 172,741 B gzip before, 465,471 B raw / 147,059 B
 * gzip after), which needs no declaration.
 */
const budget: UnitBudget = {
  unit: "FRONTEND-051",
  added: { CognitoAuthService: 26_500, AuthService: 200 },
};

export default budget;
