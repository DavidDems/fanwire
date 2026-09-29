import { apiClient } from "../../api/client";
import type { components } from "../../api/schema";

/**
 * The `notifications/` reads and writes this feature makes, and the cache keys
 * they live under.
 *
 * Every type here comes from the generated schema and every request goes through
 * `api/client.ts` — nothing in this folder hand-writes an API shape.
 *
 * The keys are constants rather than literals spelled out in three components,
 * so the optimistic clear's patch, its rollback and the invalidation after it
 * name the *same* entry by construction rather than by three people spelling it
 * the same way.
 */

type NotificationOut = components["schemas"]["NotificationOut"];
type NotificationPreferenceOut = components["schemas"]["NotificationPreferenceOut"];
type PublicUserOut = components["schemas"]["PublicUserOut"];

/**
 * The list and the preference are **siblings**, not one nested under the other.
 *
 * `queryKey` matching is a prefix match, so a preference at
 * `["notifications", "preference"]` sitting under a list at `["notifications"]`
 * would be cancelled and refetched by every clear — correct only for as long as
 * nobody forgets `exact: true`. Two disjoint keys make that impossible rather
 * than merely discouraged. Every call below still passes `exact: true`, the way
 * `features/profile` does.
 */
export const NOTIFICATIONS_QUERY_KEY = ["notifications", "list"] as const;

/** `GET`/`PUT /notifications/preference` — one flag, and there is no in-app equivalent. */
export const PREFERENCE_QUERY_KEY = ["notifications", "preference"] as const;

/**
 * An actor's public profile — deliberately the same entry `features/profile`
 * reads a viewed user from, so opening a profile from a notification finds it
 * already warm.
 *
 * The id is a **number**, because that is what the path parameter is in the
 * generated schema. `["users", "42"]` and `["users", 42]` are two different
 * cache entries, and a list that wrote one and read the other would issue one
 * request per row while looking perfectly correct ([[0x08-frontend]]).
 *
 * Declared here rather than imported from `features/profile/api.ts`: a feature
 * folder never reaches into another feature's internals, and one two-element
 * array is a far smaller cost than that coupling.
 */
export function actorKey(userId: number): readonly ["users", number] {
  return ["users", userId] as const;
}

/**
 * How long a resolved actor stays fresh.
 *
 * A username does not change while someone reads their notifications, and this
 * is also what stops a row *restored* after a failed clear from re-asking for an
 * actor the page already knows.
 */
export const ACTOR_STALE_TIME_MS = 5 * 60 * 1000;

export async function fetchNotifications(): Promise<NotificationOut[]> {
  const { data, response } = await apiClient.GET("/notifications");
  if (!response.ok || data === undefined) {
    throw new Error(`GET /notifications answered ${response.status}`);
  }
  return data;
}

/** The actor named in an entry. `GET /users/{user_id}` returns `PublicUserOut`. */
export async function fetchActor(userId: number): Promise<PublicUserOut> {
  const { data, response } = await apiClient.GET("/users/{user_id}", {
    params: { path: { user_id: userId } },
  });
  if (!response.ok || data === undefined) {
    throw new Error(`GET /users/${userId} answered ${response.status}`);
  }
  return data;
}

/**
 * `POST /notifications/{notification_id}/clear`.
 *
 * A soft delete on the backend (`cleared_at`, [[0x05-notifications]]); from here
 * it is a 204 with no body, so `response.ok` is the whole result and nothing in
 * this feature exposes the distinction.
 */
export async function clearNotification(notificationId: number): Promise<void> {
  const { response } = await apiClient.POST("/notifications/{notification_id}/clear", {
    params: { path: { notification_id: notificationId } },
  });
  if (!response.ok) {
    throw new Error(`POST /notifications/${notificationId}/clear answered ${response.status}`);
  }
}

export async function fetchEmailPreference(): Promise<NotificationPreferenceOut> {
  const { data, response } = await apiClient.GET("/notifications/preference");
  if (!response.ok || data === undefined) {
    throw new Error(`GET /notifications/preference answered ${response.status}`);
  }
  return data;
}

export async function setEmailPreference(enabled: boolean): Promise<NotificationPreferenceOut> {
  const { data, response } = await apiClient.PUT("/notifications/preference", {
    body: { email_notifications_enabled: enabled },
  });
  if (!response.ok || data === undefined) {
    throw new Error(`PUT /notifications/preference answered ${response.status}`);
  }
  return data;
}
