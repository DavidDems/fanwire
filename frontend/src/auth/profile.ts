import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { apiClient } from "../api/client";
import type { components } from "../api/schema";

type MeOut = components["schemas"]["MeOut"];

/**
 * The caller's own profile — the second half of "is this person allowed here".
 *
 * A session says who someone is in Cognito; this says whether they have a
 * `User` row yet, and since `USERS-003` whether that row is deactivated. The
 * route guards, the shell and `auth/account.ts` read it, `ProfileSetupPage`
 * invalidates it after creating one, and they all share **one** cache entry:
 * the app's `staleTime` is 30s, so a second key would hand one guard a 404 the
 * other has already seen answered.
 */

/** The one key. Anything that changes the profile invalidates exactly this. */
export const PROFILE_QUERY_KEY = ["users", "me"] as const;

/**
 * `GET /users/me`'s third answer (`FRONTEND-012`): 403
 * `{"detail": "account_deactivated"}`, an account its owner deactivated.
 *
 * A marker of its own, compared by identity, because it is neither of the
 * other two: not an error (nothing failed, and the guards' "could not check"
 * would be a lie) and not `null` (offering profile creation to someone who has
 * a profile is the defect `RequireNewProfile` exists to prevent). Nothing but
 * `auth/account.ts` reads it: everyone else asks `useAccount()`.
 */
export const ACCOUNT_DEACTIVATED: unique symbol = Symbol("account_deactivated");

export type ProfileAnswer = MeOut | null | typeof ACCOUNT_DEACTIVATED;

/** Only that exact body is the state: any other 403 is still a failure. */
function isDeactivatedBody(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { detail?: unknown }).detail === "account_deactivated"
  );
}

/**
 * `null` means "authenticated, no profile row yet" — a routing state, not an
 * error ([[0x08-frontend]]).
 *
 * The 404 is not in the OpenAPI document (only the 200 is declared), so the
 * status is what is branched on. `openapi-fetch` cannot type an undeclared
 * response, and it turns a body-less non-2xx into `error: ""` — falsy — so
 * `if (error)` would send a 404 down the success path instead.
 */
export async function fetchProfile(): Promise<ProfileAnswer> {
  const { data, error, response } = await apiClient.GET("/users/me");

  if (response.status === 404) return null;
  if (response.status === 403 && isDeactivatedBody(error)) {
    return ACCOUNT_DEACTIVATED;
  }
  if (!response.ok || data === undefined) {
    throw new Error(`GET /users/me answered ${response.status}`);
  }
  return data;
}

/**
 * `enabled` is how a guard says "there is a session". With no token the request
 * would be a 401 the app then has to explain away, so it is never made.
 */
export function useProfile(
  enabled: boolean,
): UseQueryResult<ProfileAnswer, Error> {
  return useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: fetchProfile,
    enabled,
  });
}
