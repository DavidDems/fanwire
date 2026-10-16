import { apiClient } from "../../api/client";
import type { components } from "../../api/schema";
import { FEED_KEY_ROOT } from "../feed/api";

/**
 * The two reads this feature makes, `GET /search/accounts` and
 * `GET /search/posts` ([[0x07-search]] Routes), and the cache keys their
 * answers live under. The games filter that also lived here moved to the Stats
 * page in `FRONTEND-009`, and its client code went with it.
 *
 * Every type here is an alias of the generated schema, and all HTTP goes
 * through `api/client.ts`. The keys are built by functions so that the query
 * that fills an entry and anything that later names it agree by construction.
 */

export type AccountResult = components["schemas"]["AccountResult"];
export type AccountsPageBody = components["schemas"]["AccountsPage"];
export type PostsPageBody = components["schemas"]["PostsPage"];

/** `GET /search/accounts` — one infinite query per search text. */
export function accountsKey(
  q: string,
): readonly ["search", "accounts", string] {
  return ["search", "accounts", q] as const;
}

/**
 * `GET /search/posts` — one infinite query per search text, **under the feed's
 * key root on purpose.** The feed's post actions (`TogglePostAction`) patch a
 * like or a repost optimistically into every cached entry under
 * `FEED_KEY_ROOT` that holds the post (`cacheHolds` / `mapCachedPosts`, which
 * also reach the original inside a repost), and a `PostsPage` has the same
 * `{ items }` page shape those helpers walk. Keyed anywhere else, a like on a
 * search result would wait for the server before its count moved, unlike the
 * same post on the feed.
 */
export function postsKey(q: string): readonly ["feed", "search", string] {
  return [...FEED_KEY_ROOT, "search", q] as const;
}

export async function fetchAccountsPage(
  q: string,
  offset: number,
): Promise<AccountsPageBody> {
  const { data, response } = await apiClient.GET("/search/accounts", {
    params: { query: { q, offset } },
  });
  if (!response.ok || data === undefined) {
    throw new Error(`GET /search/accounts answered ${response.status}`);
  }
  return data;
}

export async function fetchPostsPage(
  q: string,
  offset: number,
): Promise<PostsPageBody> {
  const { data, response } = await apiClient.GET("/search/posts", {
    params: { query: { q, offset } },
  });
  if (!response.ok || data === undefined) {
    throw new Error(`GET /search/posts answered ${response.status}`);
  }
  return data;
}
