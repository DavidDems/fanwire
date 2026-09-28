import { apiClient } from "../../api/client";
import type { components } from "../../api/schema";

/**
 * The `users/` reads and writes this feature makes, and the cache keys they live
 * under.
 *
 * Every type here comes from the generated schema — nothing in this folder
 * hand-writes an API shape, and all HTTP goes through `api/client.ts`.
 *
 * The keys are functions rather than literals scattered over four components so
 * that the optimistic follow patches, and the invalidation after it, name the
 * *same* entry by construction rather than by two people spelling it the same
 * way.
 */

type MeOut = components["schemas"]["MeOut"];
type PublicUserOut = components["schemas"]["PublicUserOut"];
type TeamOut = components["schemas"]["TeamOut"];
type UpdateMeRequest = components["schemas"]["UpdateMeRequest"];

/**
 * The viewed user's public profile.
 *
 * The id is a **number**, because that is what the path parameter is in the
 * generated schema. `["users", "42"]` and `["users", 42]` are two different
 * cache entries, and a page that wrote one and read the other would refetch on
 * every render and never look wrong.
 */
export function viewedUserKey(userId: number): readonly ["users", number] {
  return ["users", userId] as const;
}

/** The caller's follow set. One key, separate from `PROFILE_QUERY_KEY`. */
export const FOLLOWING_QUERY_KEY = ["users", "me", "following"] as const;

/** `preferred_team_id` is an FK into `events/`, so the choices come from the API. */
export const TEAMS_QUERY_KEY = ["events", "teams"] as const;

export async function fetchPublicProfile(userId: number): Promise<PublicUserOut> {
  const { data, response } = await apiClient.GET("/users/{user_id}", {
    params: { path: { user_id: userId } },
  });
  if (!response.ok || data === undefined) {
    throw new Error(`GET /users/${userId} answered ${response.status}`);
  }
  return data;
}

/** `GET /users/me/following` is a bare `list[int]` ([[0x01-users]]). */
export async function fetchFollowing(): Promise<number[]> {
  const { data, response } = await apiClient.GET("/users/me/following");
  if (!response.ok || data === undefined) {
    throw new Error(`GET /users/me/following answered ${response.status}`);
  }
  return data;
}

export async function fetchTeams(): Promise<TeamOut[]> {
  const { data, response } = await apiClient.GET("/events/teams");
  if (!response.ok || data === undefined) {
    throw new Error(`GET /events/teams answered ${response.status}`);
  }
  return data;
}

/**
 * Follow (`POST`) or unfollow (`DELETE`) on the one path. Both answer 204, so
 * there is no body to read and `response.ok` is the whole result.
 */
export async function setFollowing(userId: number, following: boolean): Promise<void> {
  const options = { params: { path: { user_id: userId } } } as const;
  const { response } = following
    ? await apiClient.POST("/users/{user_id}/follow", options)
    : await apiClient.DELETE("/users/{user_id}/follow", options);

  if (!response.ok) {
    throw new Error(
      `${following ? "POST" : "DELETE"} /users/${userId}/follow answered ${response.status}`,
    );
  }
}

/**
 * `PATCH /users/me`.
 *
 * The body is assembled by the caller and is deliberately partial: the backend
 * reads it with `model_fields_set` semantics ([[0x01-users]]), so a field
 * *absent* is left untouched while a field present as `null` clears it.
 */
export async function updateMe(body: UpdateMeRequest): Promise<MeOut> {
  const { data, response } = await apiClient.PATCH("/users/me", { body });
  if (!response.ok || data === undefined) {
    throw new Error(`PATCH /users/me answered ${response.status}`);
  }
  return data;
}
