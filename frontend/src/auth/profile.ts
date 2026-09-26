import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { apiClient } from "../api/client";
import type { components } from "../api/schema";

type MeOut = components["schemas"]["MeOut"];

/**
 * The caller's own profile — the second half of "is this person allowed here".
 *
 * A session says who someone is in Cognito; this says whether they have a
 * `User` row yet. Both route guards read it, `ProfileSetupPage` invalidates it
 * after creating one, and they all share **one** cache entry: the app's
 * `staleTime` is 30s, so a second key would hand one guard a 404 the other has
 * already seen answered.
 */

/** The one key. Anything that changes the profile invalidates exactly this. */
export const PROFILE_QUERY_KEY = ["users", "me"] as const;

/**
 * `null` means "authenticated, no profile row yet" — a routing state, not an
 * error ([[0x08-frontend]]).
 *
 * The 404 is not in the OpenAPI document (only the 200 is declared), so the
 * status is what is branched on. `openapi-fetch` cannot type an undeclared
 * response, and it turns a body-less non-2xx into `error: ""` — falsy — so
 * `if (error)` would send a 404 down the success path instead.
 */
export async function fetchProfile(): Promise<MeOut | null> {
  const { data, response } = await apiClient.GET("/users/me");

  if (response.status === 404) return null;
  if (!response.ok || data === undefined) {
    throw new Error(`GET /users/me answered ${response.status}`);
  }
  return data;
}

/**
 * `enabled` is how a guard says "there is a session". With no token the request
 * would be a 401 the app then has to explain away, so it is never made.
 */
export function useProfile(enabled: boolean): UseQueryResult<MeOut | null, Error> {
  return useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: fetchProfile,
    enabled,
  });
}
