/**
 * The game page's "Post about this" addresses (`FRONTEND-017`): the composer's
 * pre-filled links (`FRONTEND-013`), reached by address only, never by import
 * ([[0x00-architecture]] Connection rule). This is the one file of
 * `features/games/` that names the composer's path.
 */

const COMPOSE_PATH = "/compose";

function composeHref(params: Record<string, string | number>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    query.set(key, String(value));
  return `${COMPOSE_PATH}?${query.toString()}`;
}

/** Compose a post about game `gameId`'s result. */
export function postAboutGameHref(gameId: number): string {
  return composeHref({ link: "game_final", ref: gameId });
}

/** Compose a post about one played box-score line of game `gameId`. */
export function postAboutLineHref(lineId: number, gameId: number): string {
  return composeHref({ link: "player_game", ref: lineId, game: gameId });
}
