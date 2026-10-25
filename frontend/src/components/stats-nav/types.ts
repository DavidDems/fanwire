import type { ReactNode } from "react";

/** A season level's standings tab: both conferences, or one. */
export type Conference = "all" | "east" | "west";

/**
 * One level of the stats navigator, as data. The union may grow
 * (FRONTEND-021 adds a game and a box score); each kind has a view here.
 */
export type StatsLevel =
  | { kind: "season"; season: string; conf: Conference }
  | { kind: "team"; season: string; teamId: number };

/** What the caller decides: how a game, a player and a level are reached. */
export interface StatsNavAdapter {
  /** A game's link; `children` is its text. */
  gameLink(gameId: number, children: ReactNode): ReactNode;
  /** A player's link; `children` is its text. */
  playerLink(playerId: number, children: ReactNode): ReactNode;
  /**
   * The address of a level, when levels have one: a control that opens or
   * returns to a level is then a link whose plain click calls open or pop;
   * without it, the control is a button.
   */
  levelHref?(level: StatsLevel): string;
}
