/**
 * FRONTEND-018: the stats reads, moved from `features/stats/api.ts` to
 * `src/api/stats.ts` so the shared navigator (`components/stats-nav/`) and,
 * later, the compose stats picker (FRONTEND-021) read through one module.
 *
 * The interface this file pins (`api/stats.ts`):
 *
 * - **Everything today's `features/stats/api.ts` exports, unchanged**: the
 *   fetchers (`fetchTeams`, `fetchSeasons`, `fetchChampion`,
 *   `fetchStandings`, `fetchLeaders`, `fetchSeasonGamesPage`,
 *   `fetchTeamSeason`, `fetchPlayersPage`), the page sizes
 *   (`GAMES_PAGE_SIZE` 50, `PLAYERS_PAGE_SIZE` 20), `nextOffset`, and the
 *   query keys, spelled exactly as before. `TEAMS_KEY` stays
 *   `["events", "teams"]`: `features/profile` and search spell it themselves,
 *   and a different key would split the cache. The type aliases are the
 *   typecheck's to pin.
 * - **The season reads carry their own `staleTime`.** `SEASON_STALE_TIME` is
 *   300,000 ms (five minutes: season data changes once a day at most), and
 *   four query-options factories hand it to `useQuery` with the key and the
 *   fetcher, so every caller of a season read shares one freshness rule:
 *   `championQuery(season)`, `standingsQuery(season)`,
 *   `leadersQuery(season, stat)` and `teamSeasonQuery(teamId, season)`, each
 *   `{ queryKey, queryFn, staleTime }`. The teams and seasons lists keep the
 *   client's default.
 */
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { server } from "../test/server";
import {
  CELTICS,
  championStub,
  leadersStub,
  standingsStub,
  teamSeasonStub,
  testChampion,
} from "../test/stats";
import * as stats from "./stats";
import {
  GAMES_PAGE_SIZE,
  PLAYERS_PAGE_SIZE,
  SEASONS_KEY,
  SEASON_STALE_TIME,
  TEAMS_KEY,
  championKey,
  championQuery,
  leadersKey,
  leadersQuery,
  nextOffset,
  playerSearchKey,
  seasonGamesKey,
  standingsKey,
  standingsQuery,
  teamSeasonKey,
  teamSeasonQuery,
} from "./stats";

function client(): QueryClient {
  // As the app's and the test kit's: staleTime 0 by default.
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("the moved reads keep today's exports", () => {
  it.each([
    "fetchTeams",
    "fetchSeasons",
    "fetchChampion",
    "fetchStandings",
    "fetchLeaders",
    "fetchSeasonGamesPage",
    "fetchTeamSeason",
    "fetchPlayersPage",
  ])("exports %s", (name) => {
    expect(typeof (stats as Record<string, unknown>)[name]).toBe("function");
  });

  it("keeps the page sizes and nextOffset", () => {
    expect(GAMES_PAGE_SIZE).toBe(50);
    expect(PLAYERS_PAGE_SIZE).toBe(20);
    expect(nextOffset([1, 2], 0, 2)).toBe(2);
    expect(nextOffset([1], 40, 2)).toBeUndefined();
  });
});

describe("the query keys are spelled as before", () => {
  it("TEAMS_KEY is the one features/profile and search spell", () => {
    expect(TEAMS_KEY).toEqual(["events", "teams"]);
  });

  it("keeps every other key", () => {
    expect(SEASONS_KEY).toEqual(["events", "seasons"]);
    expect(championKey("2023-24")).toEqual([
      "events",
      "seasons",
      "2023-24",
      "champion",
    ]);
    expect(standingsKey("2023-24")).toEqual([
      "events",
      "seasons",
      "2023-24",
      "standings",
    ]);
    expect(leadersKey("2023-24", "points")).toEqual([
      "events",
      "seasons",
      "2023-24",
      "leaders",
      "points",
    ]);
    expect(seasonGamesKey("2023-24")).toEqual([
      "events",
      "games",
      { season: "2023-24" },
    ]);
    expect(teamSeasonKey(3, "2023-24")).toEqual([
      "events",
      "teams",
      3,
      "seasons",
      "2023-24",
    ]);
    expect(playerSearchKey("jam")).toEqual([
      "events",
      "players",
      "search",
      "jam",
    ]);
  });
});

describe("the season reads carry staleTime 300,000 ms", () => {
  it("SEASON_STALE_TIME is five minutes", () => {
    expect(SEASON_STALE_TIME).toBe(300_000);
  });

  it.each([
    ["championQuery", () => championQuery("2023-24"), championKey("2023-24")],
    [
      "standingsQuery",
      () => standingsQuery("2023-24"),
      standingsKey("2023-24"),
    ],
    [
      "leadersQuery",
      () => leadersQuery("2023-24", "rebounds"),
      leadersKey("2023-24", "rebounds"),
    ],
    [
      "teamSeasonQuery",
      () => teamSeasonQuery(CELTICS.id, "2023-24"),
      teamSeasonKey(CELTICS.id, "2023-24"),
    ],
  ] as const)("%s has its key and the season staleTime", (_name, make, key) => {
    const options = make();
    expect(options.queryKey).toEqual(key);
    expect(options.staleTime).toBe(300_000);
    expect(typeof options.queryFn).toBe("function");
  });

  it("each factory's queryFn reads its endpoint, once, and a second read within the staleTime asks nothing", async () => {
    const champion = championStub({ "2023-24": testChampion("2023-24") });
    const standings = standingsStub();
    const leaders = leadersStub();
    const teamSeason = teamSeasonStub();
    server.use(
      champion.handler,
      standings.handler,
      leaders.handler,
      teamSeason.handler,
    );
    const queries = client();

    for (let round = 0; round < 2; round += 1) {
      const answer = await queries.fetchQuery(championQuery("2023-24"));
      expect(answer.champion?.name).toBe(CELTICS.name);
      await queries.fetchQuery(standingsQuery("2023-24"));
      await queries.fetchQuery(leadersQuery("2023-24", "assists"));
      const team = await queries.fetchQuery(
        teamSeasonQuery(CELTICS.id, "2023-24"),
      );
      expect(team?.team.id).toBe(CELTICS.id);
    }

    expect(champion.requests.map((r) => r.path.season)).toEqual(["2023-24"]);
    expect(standings.requests).toHaveLength(1);
    expect(leaders.requests.map((r) => r.query.get("stat"))).toEqual([
      "assists",
    ]);
    expect(teamSeason.requests.map((r) => r.path)).toEqual([
      { team_id: String(CELTICS.id), season: "2023-24" },
    ]);
  });

  it("a team season the API has none of is null, not an error", async () => {
    server.use(teamSeasonStub(() => null).handler);

    await expect(
      client().fetchQuery(teamSeasonQuery(CELTICS.id, "1999-00")),
    ).resolves.toBeNull();
  });
});
