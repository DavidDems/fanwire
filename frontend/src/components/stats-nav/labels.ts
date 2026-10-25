/** Small text forms the Stats page uses beside `games/format`'s figures. */

/** A team's record as `64-18`. */
export function formatRecord(wins: number, losses: number): string {
  return `${wins}-${losses}`;
}

const GAME_TYPES: Record<string, string> = {
  regular: "Regular season",
  playoffs: "Playoffs",
  "play-in": "Play-in",
  "cup-final": "Cup final",
};

/** A game type in words; an unknown code is shown as given. */
export function formatGameType(gameType: string | null): string {
  if (gameType === null) return "";
  return GAME_TYPES[gameType] ?? gameType;
}
