import { apiClient } from "../../api/client";
import type { components } from "../../api/schema";

/**
 * The Stats page's reads ([[0x02-events]] "Seasons", "Players", and the game
 * list) and the cache keys their answers live under. Every type is an alias of
 * the generated schema, and all HTTP goes through `api/client.ts`.
 *
 * **Paging.** `GET /events/games` and `GET /events/players` answer bare lists
 * with no `next_offset`, so a page that comes back full is the only sign that
 * another may follow. Each fetcher sends its page size explicitly and
 * `nextOffset` reads the answer against it.
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

function failed(path: string, status: number): Error {
  return new Error(`GET ${path} answered ${status}`);
}

export async function fetchTeams(): Promise<TeamOut[]> {
  const { data, response } = await apiClient.GET("/events/teams");
  if (!response.ok || data === undefined)
    throw failed("/events/teams", response.status);
  return data;
}

/** Newest first, as the API sends them. */
export async function fetchSeasons(): Promise<string[]> {
  const { data, response } = await apiClient.GET("/events/seasons");
  if (!response.ok || data === undefined)
    throw failed("/events/seasons", response.status);
  return data;
}

/** A season with no champion yet is a 200 with nulls, not an error. */
export async function fetchChampion(season: string): Promise<ChampionOut> {
  const { data, response } = await apiClient.GET(
    "/events/seasons/{season}/champion",
    { params: { path: { season } } },
  );
  if (!response.ok || data === undefined)
    throw failed(`/events/seasons/${season}/champion`, response.status);
  return data;
}

export async function fetchStandings(season: string): Promise<StandingsOut> {
  const { data, response } = await apiClient.GET(
    "/events/seasons/{season}/standings",
    { params: { path: { season } } },
  );
  if (!response.ok || data === undefined)
    throw failed(`/events/seasons/${season}/standings`, response.status);
  return data;
}

export async function fetchLeaders(
  season: string,
  stat: LeaderStat,
): Promise<LeadersOut> {
  const { data, response } = await apiClient.GET(
    "/events/seasons/{season}/leaders",
    { params: { path: { season }, query: { stat } } },
  );
  if (!response.ok || data === undefined)
    throw failed(`/events/seasons/${season}/leaders`, response.status);
  return data;
}

/** One page of a season's games, newest first. */
export async function fetchSeasonGamesPage(
  season: string,
  offset: number,
): Promise<GameOut[]> {
  const { data, response } = await apiClient.GET("/events/games", {
    params: { query: { season, offset, limit: GAMES_PAGE_SIZE } },
  });
  if (!response.ok || data === undefined)
    throw failed("/events/games", response.status);
  return data;
}

/** One team's season, or `null` when the API has none for it (a 404). */
export async function fetchTeamSeason(
  teamId: number,
  season: string,
): Promise<TeamSeasonOut | null> {
  const { data, response } = await apiClient.GET(
    "/events/teams/{team_id}/seasons/{season}",
    { params: { path: { team_id: teamId, season } } },
  );
  if (response.status === 404) return null;
  if (!response.ok || data === undefined)
    throw failed(`/events/teams/${teamId}/seasons/${season}`, response.status);
  return data;
}

/** One page of players matching `q`, in the API's order. */
export async function fetchPlayersPage(
  q: string,
  offset: number,
): Promise<PlayerListItemOut[]> {
  const { data, response } = await apiClient.GET("/events/players", {
    params: { query: { q, offset, limit: PLAYERS_PAGE_SIZE } },
  });
  if (!response.ok || data === undefined)
    throw failed("/events/players", response.status);
  return data;
}
