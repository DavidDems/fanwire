import { apiClient } from "../../api/client";
import type { components } from "../../api/schema";

/**
 * The one read the game page makes, `GET /events/games/{game_id}`, and its
 * cache key. The types are the generated schema's, field names and all.
 */

export type GameDetailOut = components["schemas"]["GameDetailOut"];
export type TeamBoxScoreOut = components["schemas"]["TeamBoxScoreOut"];
export type BoxScorePlayerOut = components["schemas"]["BoxScorePlayerOut"];
export type DidNotPlayOut = components["schemas"]["DidNotPlayOut"];
export type TeamRefOut = components["schemas"]["TeamRefOut"];

export function gameKey(gameId: number): readonly ["events", "games", number] {
  return ["events", "games", gameId] as const;
}

/**
 * The game, or `null` when there is no game with that id. A 404 is what a
 * mistyped or stale link answers, so it is a normal result rather than an
 * error; every other failure throws.
 */
export async function fetchGame(gameId: number): Promise<GameDetailOut | null> {
  const { data, response } = await apiClient.GET("/events/games/{game_id}", {
    params: { path: { game_id: gameId } },
  });
  if (response.status === 404) return null;
  if (!response.ok || data === undefined) {
    throw new Error(`GET /events/games/${gameId} answered ${response.status}`);
  }
  return data;
}
