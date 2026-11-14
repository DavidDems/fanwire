import { createElement, type ReactNode } from "react";
import { Link } from "react-router-dom";

import type { StatsNavAdapter } from "../../components/stats-nav/types";
import { DetailLink } from "./DetailLink";

/**
 * The addresses the Stats page links to. Games and players are other pages,
 * reached by address only, and open as the detail modal over the Stats page
 * (FRONTEND-041); a team is this page's own Seasons tab, filtered.
 */

/**
 * A game's page; `season`, when given, rides along as `?season=` so the game
 * page's team links return to the season it was opened from (FRONTEND-037).
 */
export function gameHref(gameId: number, season?: string): string {
  return season === undefined
    ? `/games/${gameId}`
    : `/games/${gameId}?${new URLSearchParams({ season }).toString()}`;
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

/**
 * The stats navigator's game, player and team links, as router links. Game
 * and player links are `DetailLink`s, which carry the modal flow's state;
 * a team link is plain in-page navigation.
 */
export const ROUTE_LINKS: StatsNavAdapter = {
  gameLink: (gameId: number, children: ReactNode, season?: string) =>
    createElement(DetailLink, { to: gameHref(gameId, season) }, children),
  playerLink: (playerId: number, children: ReactNode) =>
    createElement(DetailLink, { to: playerHref(playerId) }, children),
  teamLink: (teamId: number, season: string | null, children: ReactNode) =>
    createElement(Link, { to: teamHref(teamId, season) }, children),
};
