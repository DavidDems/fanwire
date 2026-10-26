import type { ReactNode } from "react";

import type { RecordGroup } from "../../api/records";

/** A season level's standings tab: both conferences, or one. */
export type Conference = "all" | "east" | "west";

export type { RecordGroup };

/**
 * One level of the stats navigator, as data. The union may grow
 * (FRONTEND-021 adds a game and a box score); each kind has a view here, and
 * every use narrows by `kind`.
 *
 * The records levels (FRONTEND-019) carry no season: `records` is a group's
 * record cards (`group` is `null` while the record level above it has not
 * yet said which group it belongs to), and `record` is one record's list.
 */
export type StatsLevel =
  | { kind: "season"; season: string; conf: Conference }
  | { kind: "team"; season: string; teamId: number }
  | { kind: "records"; group: RecordGroup | null }
  | { kind: "record"; id: string };

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
  /**
   * A team's link, for that season or none (a record's list); without it, a
   * team's name there is plain text.
   */
  teamLink?(
    teamId: number,
    season: string | null,
    children: ReactNode,
  ): ReactNode;
}
