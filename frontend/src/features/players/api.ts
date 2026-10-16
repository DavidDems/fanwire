import { apiClient } from "../../api/client";
import type { components } from "../../api/schema";

/**
 * The player page's two reads, `GET /events/players/{id}` and
 * `GET /events/players/{id}/games` ([[0x02-events]] "Players"), and their
 * cache keys. The types are the generated schema's, field names and all.
 */

export type PlayerDetailOut = components["schemas"]["PlayerDetailOut"];
export type PlayerGameOut = components["schemas"]["PlayerGameOut"];
export type StatLineOut = components["schemas"]["StatLineOut"];
export type SeasonLineOut = components["schemas"]["SeasonLineOut"];

/** The API's default page of a game log, sent explicitly. */
export const GAME_LOG_PAGE_SIZE = 50;

export function playerKey(playerId: number) {
  return ["events", "players", playerId] as const;
}

export function playerGamesKey(playerId: number) {
  return ["events", "players", playerId, "games"] as const;
}

/**
 * The player, or `null` when there is no player with that id. A 404 is what a
 * mistyped or stale link answers, so it is a normal result; every other
 * failure throws.
 */
export async function fetchPlayer(
  playerId: number,
): Promise<PlayerDetailOut | null> {
  const { data, response } = await apiClient.GET(
    "/events/players/{player_id}",
    {
      params: { path: { player_id: playerId } },
    },
  );
  if (response.status === 404) return null;
  if (!response.ok || data === undefined)
    throw new Error(
      `GET /events/players/${playerId} answered ${response.status}`,
    );
  return data;
}

/** One page of the player's games, newest first, as the API sends them. */
export async function fetchPlayerGamesPage(
  playerId: number,
  offset: number,
): Promise<PlayerGameOut[]> {
  const { data, response } = await apiClient.GET(
    "/events/players/{player_id}/games",
    {
      params: {
        path: { player_id: playerId },
        query: { offset, limit: GAME_LOG_PAGE_SIZE },
      },
    },
  );
  if (!response.ok || data === undefined)
    throw new Error(
      `GET /events/players/${playerId}/games answered ${response.status}`,
    );
  return data;
}
