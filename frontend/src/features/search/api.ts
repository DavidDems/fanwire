import { apiClient } from "../../api/client";
import type { components } from "../../api/schema";
import { FEED_KEY_ROOT } from "../feed/api";

/**
 * The five reads this feature makes and the cache keys their answers live
 * under ([[0x07-search]] Routes, plus `GET /events/teams` from [[0x02-events]]).
 *
 * Every type here is an alias of the generated schema, and all HTTP goes
 * through `api/client.ts`. The keys are built by functions so that the query
 * that fills an entry and anything that later names it agree by construction.
 */

export type AccountResult = components["schemas"]["AccountResult"];
export type AccountsPageBody = components["schemas"]["AccountsPage"];
export type PostsPageBody = components["schemas"]["PostsPage"];
export type GameOut = components["schemas"]["GameOut"];
export type GamesPageBody = components["schemas"]["GamesPage"];
export type GameFiltersOut = components["schemas"]["GameFiltersOut"];
export type TeamOut = components["schemas"]["TeamOut"];

/**
 * The three dropdowns' values as the selects hold them: `""` is "any", and is
 * never sent. `teamId` stays a string until the request is built, because that
 * is what an `<option>` value is.
 */
export interface GameFilters {
  season: string;
  teamId: string;
  position: string;
}

export const NO_GAME_FILTERS: GameFilters = {
  season: "",
  teamId: "",
  position: "",
};

/** Whether any filter is set — with none, there is nothing to ask for. */
export function hasGameFilter(filters: GameFilters): boolean {
  return (
    filters.season !== "" || filters.teamId !== "" || filters.position !== ""
  );
}

/** `GET /search/accounts` — one infinite query per search text. */
export function accountsKey(
  q: string,
): readonly ["search", "accounts", string] {
  return ["search", "accounts", q] as const;
}

/**
 * `GET /search/posts` — one infinite query per search text, **under the feed's
 * key root on purpose.** `LikeButton` patches a like optimistically into every
 * cached entry under `FEED_KEY_ROOT` that holds the post (`cacheHolds` /
 * `mapCachedPosts`), and a `PostsPage` has the same `{ items }` page shape those
 * helpers walk. Keyed anywhere else, a like on a search result would wait for
 * the server before its count moved, unlike the same post on the feed.
 */
export function postsKey(q: string): readonly ["feed", "search", string] {
  return [...FEED_KEY_ROOT, "search", q] as const;
}

/** `GET /search/games` — the filters are the key, so changing one asks again. */
export function gamesKey(
  filters: GameFilters,
): readonly ["search", "games", GameFilters] {
  return ["search", "games", filters] as const;
}

/** `GET /search/games/filters` — the seasons and positions on offer. */
export const GAME_FILTERS_KEY = ["search", "game-filters"] as const;

/**
 * `GET /events/teams`. The same key `features/profile` spells for the same
 * read: one endpoint, one answer, so both features can share one entry.
 */
export const TEAMS_KEY = ["events", "teams"] as const;

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

/**
 * `GET /search/games` with only the filters that are set. An "any" filter is
 * absent from the query string rather than sent empty: the route checks
 * `position` against its allowed list and answers 422 for anything else
 * ([[0x07-search]] Routes), and `""` is not on it.
 */
export async function fetchGamesPage(
  filters: GameFilters,
  offset: number,
): Promise<GamesPageBody> {
  const { data, response } = await apiClient.GET("/search/games", {
    params: {
      query: {
        ...(filters.season === "" ? {} : { season: filters.season }),
        ...(filters.teamId === "" ? {} : { team_id: Number(filters.teamId) }),
        ...(filters.position === "" ? {} : { position: filters.position }),
        offset,
      },
    },
  });
  if (!response.ok || data === undefined) {
    throw new Error(`GET /search/games answered ${response.status}`);
  }
  return data;
}

export async function fetchGameFilters(): Promise<GameFiltersOut> {
  const { data, response } = await apiClient.GET("/search/games/filters");
  if (!response.ok || data === undefined) {
    throw new Error(`GET /search/games/filters answered ${response.status}`);
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
