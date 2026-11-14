/**
 * The player page's "Post about this" address (`FRONTEND-017`): the
 * composer's pre-filled link (`FRONTEND-013`), reached by address only, never
 * by import ([[0x00-architecture]] Connection rule). This is the one file of
 * `features/players/` that names the composer's path.
 */

const COMPOSE_PATH = "/compose";

/** The part of a career a post is about, as the composer's address names it. */
export type CareerScope = "regular" | "playoffs";

/** Compose a post about player `playerId`'s career in `scope`. */
export function postAboutCareerHref(
  playerId: number,
  scope: CareerScope,
): string {
  const query = new URLSearchParams({
    link: "player_career",
    ref: String(playerId),
    scope,
  });
  return `${COMPOSE_PATH}?${query.toString()}`;
}
