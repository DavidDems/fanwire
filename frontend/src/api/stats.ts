import { ok } from "./ok";
import { queryOptions } from "@tanstack/react-query";

import { apiClient } from "./client";
import type { components } from "./schema";

/**
 * The stats reads ([[0x02-events]] "Seasons", "Players", and the game list)
 * and the cache keys their answers live under, shared by the Stats page and
 * the stats navigator (`components/stats-nav/`). Every type is an alias of
 * the generated schema, and all HTTP goes through `api/client.ts`.
 *
 * **Paging.** `GET /events/games` and `GET /events/players` answer bare lists
 * with no `next_offset`, so a page that comes back full is the only sign that
 * another may follow. Each fetcher sends its page size explicitly and
 * `nextOffset` reads the answer against it.
 *
 * **Freshness.** A season's data changes once a day at most, so the season
 * reads (`championQuery` and friends) are fresh for `SEASON_STALE_TIME`:
 * returning to a level already shown asks nothing. `seasonsQuery` uses the
 * same freshness; game and player details use the app's 30 seconds. The
 * teams list keeps the client's default.
 */

export type TeamOut = components["schemas"]["TeamOut"];
export type TeamRefOut = components["schemas"]["TeamRefOut"];
export type GameOut = components["schemas"]["GameOut"];
export type ChampionOut = components["schemas"]["ChampionOut"];
export type StandingsOut = components["schemas"]["StandingsOut"];
export type StandingRowOut = components["schemas"]["StandingRowOut"];
export type LeadersOut = components["schemas"]["LeadersOut"];
export type LeaderStat = LeadersOut["stat"];
export type TeamSeasonOut = components["schemas"]["TeamSeasonOut"];
export type TeamSeasonGameOut = components["schemas"]["TeamSeasonGameOut"];
export type PlayerListItemOut = components["schemas"]["PlayerListItemOut"];

/** The API's default page sizes, sent explicitly. */
export const GAMES_PAGE_SIZE = 50;
export const PLAYERS_PAGE_SIZE = 20;

/** The offset of the page after `page`, or `undefined` when it was short. */
export function nextOffset<T>(
  page: T[],
  offset: number,
  size: number,
): number | undefined {
  return page.length < size ? undefined : offset + size;
}

/** `GET /events/teams`: the key `features/profile` and search spell too. */
export const TEAMS_KEY = ["events", "teams"] as const;
export const SEASONS_KEY = ["events", "seasons"] as const;

export function championKey(season: string) {
  return ["events", "seasons", season, "champion"] as const;
}

export function standingsKey(season: string) {
  return ["events", "seasons", season, "standings"] as const;
}

export function leadersKey(season: string, stat: LeaderStat) {
  return ["events", "seasons", season, "leaders", stat] as const;
}

export function seasonGamesKey(season: string) {
  return ["events", "games", { season }] as const;
}

export function teamSeasonKey(teamId: number, season: string) {
  return ["events", "teams", teamId, "seasons", season] as const;
}

export function playerSearchKey(q: string) {
  return ["events", "players", "search", q] as const;
}

export async function fetchTeams(): Promise<TeamOut[]> {
  return ok(await apiClient.GET("/events/teams"), "/events/teams");
}

/** Newest first, as the API sends them. */
export async function fetchSeasons(): Promise<string[]> {
  return ok(await apiClient.GET("/events/seasons"), "/events/seasons");
}

/** A season with no champion yet is a 200 with nulls, not an error. */
export async function fetchChampion(season: string): Promise<ChampionOut> {
  return ok(
    await apiClient.GET("/events/seasons/{season}/champion", {
      params: { path: { season } },
    }),
    `/events/seasons/${season}/champion`,
  );
}

export async function fetchStandings(season: string): Promise<StandingsOut> {
  return ok(
    await apiClient.GET("/events/seasons/{season}/standings", {
      params: { path: { season } },
    }),
    `/events/seasons/${season}/standings`,
  );
}

export async function fetchLeaders(
  season: string,
  stat: LeaderStat,
): Promise<LeadersOut> {
  return ok(
    await apiClient.GET("/events/seasons/{season}/leaders", {
      params: { path: { season }, query: { stat } },
    }),
    `/events/seasons/${season}/leaders`,
  );
}

/** One page of a season's games, newest first. */
export async function fetchSeasonGamesPage(
  season: string,
  offset: number,
): Promise<GameOut[]> {
  return ok(
    await apiClient.GET("/events/games", {
      params: { query: { season, offset, limit: GAMES_PAGE_SIZE } },
    }),
    "/events/games",
  );
}

/** One team's season, or `null` when the API has none for it (a 404). */
export async function fetchTeamSeason(
  teamId: number,
  season: string,
): Promise<TeamSeasonOut | null> {
  const answer = await apiClient.GET(
    "/events/teams/{team_id}/seasons/{season}",
    { params: { path: { team_id: teamId, season } } },
  );
  return answer.response.status === 404
    ? null
    : ok(answer, `/events/teams/${teamId}/seasons/${season}`);
}

/** One page of players matching `q`, in the API's order. */
export async function fetchPlayersPage(
  q: string,
  offset: number,
): Promise<PlayerListItemOut[]> {
  return ok(
    await apiClient.GET("/events/players", {
      params: { query: { q, offset, limit: PLAYERS_PAGE_SIZE } },
    }),
    "/events/players",
  );
}

/** Five minutes: how long a season read is fresh. */
export const SEASON_STALE_TIME = 300_000;

export function championQuery(season: string) {
  return queryOptions({
    queryKey: championKey(season),
    queryFn: () => fetchChampion(season),
    staleTime: SEASON_STALE_TIME,
  });
}

export function standingsQuery(season: string) {
  return queryOptions({
    queryKey: standingsKey(season),
    queryFn: () => fetchStandings(season),
    staleTime: SEASON_STALE_TIME,
  });
}

export function leadersQuery(season: string, stat: LeaderStat) {
  return queryOptions({
    queryKey: leadersKey(season, stat),
    queryFn: () => fetchLeaders(season, stat),
    staleTime: SEASON_STALE_TIME,
  });
}

export function teamSeasonQuery(teamId: number, season: string) {
  return queryOptions({
    queryKey: teamSeasonKey(teamId, season),
    queryFn: () => fetchTeamSeason(teamId, season),
    staleTime: SEASON_STALE_TIME,
  });
}

export type GameDetailOut = components["schemas"]["GameDetailOut"];
export type PlayerDetailOut = components["schemas"]["PlayerDetailOut"];
export async function fetchGameDetail(
  id: number,
): Promise<GameDetailOut | null> {
  const answer = await apiClient.GET("/events/games/{game_id}", {
    params: { path: { game_id: id } },
  });
  return answer.response.status === 404
    ? null
    : ok(answer, `/events/games/${id}`);
}
export async function fetchPlayerDetail(
  id: number,
): Promise<PlayerDetailOut | null> {
  const answer = await apiClient.GET("/events/players/{player_id}", {
    params: { path: { player_id: id } },
  });
  return answer.response.status === 404
    ? null
    : ok(answer, `/events/players/${id}`);
}
export function seasonsQuery() {
  return queryOptions({
    queryKey: SEASONS_KEY,
    queryFn: fetchSeasons,
    staleTime: SEASON_STALE_TIME,
  });
}
export function gameDetailQuery(id: number) {
  return queryOptions({
    queryKey: ["events", "games", id] as const,
    queryFn: () => fetchGameDetail(id),
    staleTime: 30_000,
  });
}
export function playerDetailQuery(id: number) {
  return queryOptions({
    queryKey: ["events", "players", id] as const,
    queryFn: () => fetchPlayerDetail(id),
    staleTime: 30_000,
  });
}
