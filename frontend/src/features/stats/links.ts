import { createElement, type ReactNode } from "react";
import { Link } from "react-router-dom";

import type { StatsNavAdapter } from "../../components/stats-nav/types";

/**
 * The addresses the Stats page links to. Games and players are other pages,
 * reached by address only; a team is this page's own Seasons tab, filtered.
 */

export function gameHref(gameId: number): string {
  return `/games/${gameId}`;
}

export function playerHref(playerId: number): string {
  return `/players/${playerId}`;
}

/**
 * The Seasons tab filtered to one team. `season` is the season the address
 * already carries, or `null`: the default season is never written into the
 * URL by a link either, so it stays "the current season".
 */
export function teamHref(teamId: number, season: string | null): string {
  const params = new URLSearchParams();
  if (season !== null) params.set("season", season);
  params.set("team", String(teamId));
  return `/stats/seasons?${params.toString()}`;
}

/** The stats navigator's game, player and team links, as router links. */
export const ROUTE_LINKS: StatsNavAdapter = {
  gameLink: (gameId: number, children: ReactNode) =>
    createElement(Link, { to: gameHref(gameId) }, children),
  playerLink: (playerId: number, children: ReactNode) =>
    createElement(Link, { to: playerHref(playerId) }, children),
  teamLink: (teamId: number, season: string | null, children: ReactNode) =>
    createElement(Link, { to: teamHref(teamId, season) }, children),
};
