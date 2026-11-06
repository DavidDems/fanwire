import type { ReactNode } from "react";

import type { RecordGroup } from "../../api/records";

/** A season level's standings tab: both conferences, or one. */
export type Conference = "all" | "east" | "west";

export type { RecordGroup };

/**
 * A records level's bar (FRONTEND-030): the featured Top records, or one
 * group's whole library.
 */
export type RecordsBar = "top" | RecordGroup;

/**
 * One level of the stats navigator, as data. Each use narrows by `kind`;
 * callers supply the records and select-mode game/player views.
 *
 * The records levels (FRONTEND-019) carry no season: `records` is a bar's
 * record cards (`group` is null only while an unknown id's group has not
 * arrived) and its search `q` (FRONTEND-030, empty or absent for none), and
 * `record` is one record's list.
 */
export type StatsLevel =
  | { kind: "season"; season: string; conf: Conference }
  | { kind: "team"; season: string; teamId: number }
  | { kind: "records"; group: RecordsBar | null; q?: string }
  | { kind: "record"; id: string }
  | { kind: "game"; gameId: number }
  | { kind: "players" }
  | { kind: "player"; playerId: number };

/** What the caller decides: how a game, a player and a level are reached. */
export interface StatsNavAdapter {
  /**
   * A game's link; `children` is its text. `season`, when given, is the
   * season it was reached from (a team level's), which a route adapter may
   * carry to the game page so its team links return to that season.
   */
  gameLink(gameId: number, children: ReactNode, season?: string): ReactNode;
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
