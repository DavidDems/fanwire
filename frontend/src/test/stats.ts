import { HttpResponse, http, type RequestHandler } from "msw";

import type { components } from "../api/schema";

/**
 * The stats unit's network kit (`FRONTEND-009`): fixtures and msw handler
 * factories for the seasons API (`EVENTS-007`), the players API (`EVENTS-006`)
 * and the season's game list (`GET /events/games?season=`, `EVENTS-005`), as
 * [[0x02-events]] "Players" and "Seasons" describe them.
 *
 * Everything is typed against the generated schema, so a fixture that drifts
 * from `backend/openapi.json` is a typecheck failure. Nothing here mocks
 * `apiClient` or `fetch`.
 *
 * **Paging.** `GET /events/games`, `GET /events/players` and
 * `GET /events/players/{id}/games` answer bare lists, with no `next_offset`.
 * The stubs here slice a fixed list by `offset` and `limit`, defaulting
 * `limit` to the API's own default (50, 20 and 50), so a page that comes back
 * full is the only sign that another may follow. Every stub records the path
 * parameters and the query string of every request it answered, so a test can
 * read exactly what was asked.
 *
 * The teams are six, in name order as `GET /events/teams` might send them.
 * Their ids keep `testTeams()`'s two (1 Toronto Raptors, 2 Phoenix Suns), so
 * a component that also reads the shared teams fixture sees the same names.
 */

export type TeamOut = components["schemas"]["TeamOut"];
export type TeamRefOut = components["schemas"]["TeamRefOut"];
export type GameOut = components["schemas"]["GameOut"];
export type ChampionOut = components["schemas"]["ChampionOut"];
export type StandingsOut = components["schemas"]["StandingsOut"];
export type StandingRowOut = components["schemas"]["StandingRowOut"];
export type LeadersOut = components["schemas"]["LeadersOut"];
export type LeaderOut = components["schemas"]["LeaderOut"];
export type TeamSeasonOut = components["schemas"]["TeamSeasonOut"];
export type TeamSeasonGameOut = components["schemas"]["TeamSeasonGameOut"];
export type PlayerListItemOut = components["schemas"]["PlayerListItemOut"];
export type PlayerDetailOut = components["schemas"]["PlayerDetailOut"];
export type PlayerGameOut = components["schemas"]["PlayerGameOut"];
export type StatLineOut = components["schemas"]["StatLineOut"];
export type SeasonLineOut = components["schemas"]["SeasonLineOut"];
export type LeaderStat = LeadersOut["stat"];

// ---------------------------------------------------------------- teams

function team(
  id: number,
  name: string,
  abbreviation: string,
  conference: string,
  division: string,
): TeamOut {
  return {
    id,
    nba_team_id: 1610612700 + id,
    name,
    abbreviation,
    conference,
    division,
    logo_url: null,
  };
}

export const RAPTORS = team(1, "Toronto Raptors", "TOR", "Eastern", "Atlantic");
export const SUNS = team(2, "Phoenix Suns", "PHX", "Western", "Pacific");
export const CELTICS = team(3, "Boston Celtics", "BOS", "Eastern", "Atlantic");
export const MAVERICKS = team(4, "Dallas Mavericks", "DAL", "Western", "Southwest");
export const NUGGETS = team(5, "Denver Nuggets", "DEN", "Western", "Northwest");
export const NETS = team(6, "Brooklyn Nets", "BKN", "Eastern", "Atlantic");

/** Six teams, in name order. */
export function statsTeams(): TeamOut[] {
  return [CELTICS, NETS, MAVERICKS, NUGGETS, SUNS, RAPTORS];
}

export function ref(t: TeamOut): TeamRefOut {
  return { id: t.id, name: t.name, abbreviation: t.abbreviation };
}

export function teamById(id: number): TeamOut {
  const found = statsTeams().find((t) => t.id === id);
  if (found === undefined) throw new Error(`no stats team ${id}`);
  return found;
}

// -------------------------------------------------------------- seasons

/** Newest first, as the API sends them. */
export const TEST_SEASON_LIST = ["2024-25", "2023-24", "2022-23"];
export const NEWEST_SEASON = TEST_SEASON_LIST[0];

/** 2023-24: Boston over Dallas, 4-1. */
export function testChampion(season = "2023-24"): ChampionOut {
  return {
    season,
    champion: ref(CELTICS),
    runner_up: ref(MAVERICKS),
    result: "4-1",
  };
}

/** A season without a champion yet: the same shape, nulls, in a 200. */
export function noChampion(season: string): ChampionOut {
  return { season, champion: null, runner_up: null, result: null };
}

export const TIE_BREAK =
  "Win percentage, then wins, then team name (NBA tie-breakers not applied)";

function row(
  t: TeamOut,
  wins: number,
  losses: number,
  gamesBehind: number,
  home: [number, number],
  away: [number, number],
): StandingRowOut {
  return {
    team: ref(t),
    wins,
    losses,
    win_pct: Math.round((wins / (wins + losses)) * 1000) / 1000,
    games_behind: gamesBehind,
    home_wins: home[0],
    home_losses: home[1],
    away_wins: away[0],
    away_losses: away[1],
  };
}

/**
 * Two conferences, by name, then divisions by name, as the API sends them.
 *
 * The West's three divisions, in division order, hold Denver (57-25), Phoenix
 * (49-33) and Dallas (50-32): **not** the conference order, which is Denver,
 * Dallas, Phoenix. One table per conference must list its teams in the
 * conference's order (the tie-break rule), so a table that just concatenated
 * the divisions shows Phoenix above Dallas.
 */
export function testStandings(season = "2023-24"): StandingsOut {
  return {
    season,
    tie_break: TIE_BREAK,
    conferences: [
      {
        conference: "Eastern",
        divisions: [
          {
            division: "Atlantic",
            teams: [
              row(CELTICS, 64, 18, 0, [37, 4], [27, 14]),
              row(NETS, 32, 50, 32, [18, 23], [14, 27]),
              row(RAPTORS, 25, 57, 39, [16, 25], [9, 32]),
            ],
          },
        ],
      },
      {
        conference: "Western",
        divisions: [
          {
            division: "Northwest",
            teams: [row(NUGGETS, 57, 25, 0, [33, 8], [24, 17])],
          },
          {
            division: "Pacific",
            teams: [row(SUNS, 49, 33, 8, [25, 16], [24, 17])],
          },
          {
            division: "Southwest",
            teams: [row(MAVERICKS, 50, 32, 7, [25, 16], [25, 16])],
          },
        ],
      },
    ],
  };
}

export const RULE_65 = "65 games (NBA rule from 2023-24)";
export const RULE_70 = "70% of 82 team games, rounded up: 58";

function leader(
  player_id: number,
  first_name: string,
  last_name: string,
  teams: string[],
  games_played: number,
  average: number,
): LeaderOut {
  return { player_id, first_name, last_name, teams, games_played, average };
}

/** The three boards the Seasons tab shows, each with a distinct leader. */
export const TEST_LEADERS: Record<"points" | "rebounds" | "assists", LeaderOut[]> = {
  points: [
    leader(1629029, "Luka", "Doncic", ["DAL"], 70, 33.9),
    leader(203507, "Giannis", "Antetokounmpo", ["MIL"], 73, 30.4),
    leader(1628983, "Shai", "Gilgeous-Alexander", ["OKC"], 75, 30.1),
  ],
  rebounds: [
    leader(1627734, "Domantas", "Sabonis", ["SAC"], 82, 13.7),
    leader(203999, "Nikola", "Jokic", ["DEN"], 79, 12.4),
  ],
  assists: [
    leader(1630169, "Tyrese", "Haliburton", ["IND"], 69, 10.9),
    leader(1627732, "Ben", "Simmons", ["BKN", "PHX"], 66, 6.1),
  ],
};

export function testLeaders(
  season: string,
  stat: LeaderStat,
  rule = RULE_65,
): LeadersOut {
  const board =
    stat === "points" || stat === "rebounds" || stat === "assists"
      ? TEST_LEADERS[stat]
      : [];
  return {
    season,
    stat,
    game_type: "regular",
    rule,
    minimum_games: rule === RULE_65 ? 65 : 58,
    leaders: board,
  };
}

// ---------------------------------------------------------------- games

/**
 * The `index`-th game of a season, newest first: ids 7000 + index, one day
 * apart going back from 15 April, teams rotating through `statsTeams()`.
 */
export function seasonGame(season: string, index: number): GameOut {
  const teams = statsTeams();
  const home = teams[index % teams.length];
  const away = teams[(index + 1) % teams.length];
  const date = new Date(Date.UTC(2025, 3, 15) - index * 86_400_000);
  return {
    id: 7000 + index,
    nba_game_id: 22400000 + index,
    game_type: "regular",
    season,
    date: date.toISOString().slice(0, 19),
    home_team_id: home.id,
    away_team_id: away.id,
    home_score: 100 + (index % 30),
    away_score: 131 - (index % 30),
    venue: null,
  };
}

export function seasonGames(season: string, count: number): GameOut[] {
  return Array.from({ length: count }, (_, index) => seasonGame(season, index));
}

/** One team's 2023-24, from its own side, newest first. */
export function testTeamSeason(
  t: TeamOut = CELTICS,
  season = "2023-24",
): TeamSeasonOut {
  return {
    season,
    team: t,
    record: {
      wins: 64,
      losses: 18,
      home_wins: 37,
      home_losses: 4,
      away_wins: 27,
      away_losses: 14,
    },
    games: [
      {
        game_id: 9101,
        date: "2024-06-17T20:30:00",
        game_type: "playoffs",
        label: "NBA Finals",
        sub_label: "Game 5",
        opponent: ref(MAVERICKS),
        is_home: true,
        team_score: 106,
        opponent_score: 88,
        won: true,
      },
      {
        game_id: 9102,
        date: "2024-03-20T19:30:00",
        game_type: "regular",
        label: null,
        sub_label: null,
        opponent: ref(SUNS),
        is_home: false,
        team_score: 111,
        opponent_score: 117,
        won: false,
      },
      {
        game_id: 9103,
        date: "2024-01-15T19:00:00",
        game_type: "regular",
        label: null,
        sub_label: null,
        opponent: ref(RAPTORS),
        is_home: true,
        team_score: 126,
        opponent_score: 104,
        won: true,
      },
    ],
  };
}

// -------------------------------------------------------------- players

export function testPlayerListItem(
  overrides: Partial<PlayerListItemOut> = {},
): PlayerListItemOut {
  return {
    id: 2544,
    first_name: "LeBron",
    last_name: "James",
    position: "F",
    jersey: "23",
    first_season: "2003-04",
    last_season: "2024-25",
    latest_team_abbreviation: "LAL",
    ...overrides,
  };
}

/** Every counting stat zero and every average and percentage null. */
export function testStatLine(overrides: Partial<StatLineOut> = {}): StatLineOut {
  return {
    games_played: 0,
    games_started: 0,
    seconds_played: 0,
    points: 0,
    rebounds: 0,
    offensive_rebounds: 0,
    defensive_rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    personal_fouls: 0,
    field_goals_made: 0,
    field_goals_attempted: 0,
    field_goal_pct: null,
    three_pointers_made: 0,
    three_pointers_attempted: 0,
    three_point_pct: null,
    free_throws_made: 0,
    free_throws_attempted: 0,
    free_throw_pct: null,
    points_per_game: null,
    rebounds_per_game: null,
    assists_per_game: null,
    steals_per_game: null,
    blocks_per_game: null,
    turnovers_per_game: null,
    three_pointers_made_per_game: null,
    minutes_per_game: null,
    ...overrides,
  };
}

export function testSeasonLine(
  overrides: Partial<SeasonLineOut> = {},
): SeasonLineOut {
  return {
    ...testStatLine(),
    season: "2023-24",
    game_type: "regular",
    teams: ["LAL"],
    ...overrides,
  };
}

/**
 * LeBron James, 6'9" (81 inches). Three season lines: 2023-24 regular and
 * playoffs (two rows of one season, told apart by their figures), and a
 * two-team 2003-04 whose teams are in the order first played, MIA then CLE.
 */
export function testPlayerDetail(
  overrides: Partial<PlayerDetailOut> = {},
): PlayerDetailOut {
  return {
    id: 2544,
    first_name: "LeBron",
    last_name: "James",
    position: "F",
    jersey: "23",
    height_inches: 81,
    weight_lbs: 250,
    birth_date: "1984-12-30",
    country: "USA",
    school: "St. Vincent-St. Mary HS",
    draft_year: 2003,
    draft_round: 1,
    draft_number: 1,
    first_season: "2003-04",
    last_season: "2024-25",
    career_regular: testStatLine({
      games_played: 1492,
      games_started: 1491,
      points_per_game: 27.1,
      rebounds_per_game: 7.5,
      assists_per_game: 7.4,
      minutes_per_game: 37.9,
      field_goal_pct: 0.506,
      three_point_pct: 0.348,
      free_throw_pct: 0.736,
    }),
    career_playoffs: testStatLine({
      games_played: 287,
      games_started: 287,
      points_per_game: 28.4,
      rebounds_per_game: 9.0,
      assists_per_game: 7.2,
      minutes_per_game: 41.9,
      field_goal_pct: 0.495,
      three_point_pct: 0.331,
      free_throw_pct: 0.741,
    }),
    seasons: [
      testSeasonLine({
        season: "2023-24",
        game_type: "regular",
        teams: ["LAL"],
        games_played: 71,
        games_started: 71,
        minutes_per_game: 35.3,
        points_per_game: 25.7,
        rebounds_per_game: 7.3,
        assists_per_game: 8.3,
        steals_per_game: 1.3,
        blocks_per_game: 0.5,
        field_goal_pct: 0.54,
        three_point_pct: 0.41,
        free_throw_pct: 0.75,
      }),
      testSeasonLine({
        season: "2023-24",
        game_type: "playoffs",
        teams: ["LAL"],
        games_played: 5,
        games_started: 5,
        minutes_per_game: 40.8,
        points_per_game: 27.8,
        rebounds_per_game: 6.6,
        assists_per_game: 8.8,
        steals_per_game: 1.2,
        blocks_per_game: 1.0,
        field_goal_pct: 0.566,
        three_point_pct: 0.385,
        free_throw_pct: 0.739,
      }),
      testSeasonLine({
        season: "2003-04",
        game_type: "regular",
        teams: ["MIA", "CLE"],
        games_played: 79,
        games_started: 79,
        minutes_per_game: 39.5,
        points_per_game: 20.9,
        rebounds_per_game: 5.5,
        assists_per_game: 5.9,
        steals_per_game: 1.6,
        blocks_per_game: 0.7,
        field_goal_pct: 0.417,
        three_point_pct: 0.29,
        free_throw_pct: 0.754,
      }),
    ],
    ...overrides,
  };
}

/**
 * A player the API knows almost nothing about: every attribute null, 6'0"
 * (72 inches) the one exception, no seasons and two zero career lines.
 */
export function sparsePlayerDetail(): PlayerDetailOut {
  return testPlayerDetail({
    id: 77,
    first_name: "Test",
    last_name: "Rookie",
    position: null,
    jersey: null,
    height_inches: 72,
    weight_lbs: null,
    birth_date: null,
    country: null,
    school: null,
    draft_year: null,
    draft_round: null,
    draft_number: null,
    first_season: null,
    last_season: null,
    career_regular: testStatLine(),
    career_playoffs: testStatLine(),
    seasons: [],
  });
}

/** One row of a game log: the `index`-th newest game, ids 8000 + index. */
export function playerGame(index: number, overrides: Partial<PlayerGameOut> = {}): PlayerGameOut {
  const date = new Date(Date.UTC(2025, 3, 13) - index * 2 * 86_400_000);
  return {
    game_id: 8000 + index,
    date: date.toISOString().slice(0, 19),
    season: "2024-25",
    game_type: "regular",
    label: null,
    team: { id: 14, name: "Los Angeles Lakers", abbreviation: "LAL" },
    opponent: ref(SUNS),
    is_home: index % 2 === 0,
    team_score: 110 + (index % 9),
    opponent_score: 100 + (index % 13),
    starter: true,
    starting_position: "F",
    seconds_played: 2100 + index,
    points: 20 + (index % 15),
    rebounds: 7,
    offensive_rebounds: 1,
    defensive_rebounds: 6,
    assists: 8,
    steals: 1,
    blocks: 1,
    turnovers: 3,
    personal_fouls: 2,
    plus_minus: 5,
    field_goals_made: 9,
    field_goals_attempted: 17,
    field_goal_pct: 0.529,
    three_pointers_made: 2,
    three_pointers_attempted: 6,
    three_point_pct: 0.333,
    free_throws_made: 4,
    free_throws_attempted: 5,
    free_throw_pct: 0.8,
    dnp_reason: null,
    ...overrides,
  };
}

/** A did-not-play row: no minutes, every count zero, a reason. */
export function dnpGame(index: number, reason: string | null): PlayerGameOut {
  return playerGame(index, {
    starter: false,
    starting_position: null,
    seconds_played: null,
    points: 0,
    rebounds: 0,
    offensive_rebounds: 0,
    defensive_rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    personal_fouls: 0,
    plus_minus: 0,
    field_goals_made: 0,
    field_goals_attempted: 0,
    field_goal_pct: null,
    three_pointers_made: 0,
    three_pointers_attempted: 0,
    three_point_pct: null,
    free_throws_made: 0,
    free_throws_attempted: 0,
    free_throw_pct: null,
    dnp_reason: reason,
  });
}

export function playerGames(count: number): PlayerGameOut[] {
  return Array.from({ length: count }, (_, index) => playerGame(index));
}

// ---------------------------------------------------------------- stubs

export interface RecordedRequest {
  /** The route's named path parameters, as strings (msw's wildcard "0" left out). */
  path: Record<string, string>;
  query: URLSearchParams;
}

export interface Stub {
  handler: RequestHandler;
  /** Every request answered, in order. */
  readonly requests: RecordedRequest[];
  /** Answer everything from here on with a 500. */
  fail(): void;
}

/**
 * A GET stub: `answer` returns the body, or `null` for a 404. Requests are
 * recorded before answering, so a failed one is still observable as sent.
 */
function stub(
  path: string,
  answer: (request: RecordedRequest) => unknown,
): Stub {
  const requests: RecordedRequest[] = [];
  let failing = false;
  return {
    handler: http.get(path, ({ request, params }) => {
      const recorded: RecordedRequest = {
        // The leading `*` of every stub's path is a wildcard msw also reports,
        // as the numbered parameter "0" (the origin and `/api`): not a path
        // parameter of the route, so it is left out.
        path: Object.fromEntries(
          Object.entries(params)
            .filter(([key]) => !/^\d+$/.test(key))
            .map(([key, value]) => [key, String(value)]),
        ),
        query: new URL(request.url).searchParams,
      };
      requests.push(recorded);
      if (failing)
        return HttpResponse.json(
          { detail: "Internal Server Error" },
          { status: 500 },
        );
      const body = answer(recorded);
      if (body === null)
        return HttpResponse.json({ detail: "Not Found" }, { status: 404 });
      return HttpResponse.json(body as object);
    }),
    requests,
    fail(): void {
      failing = true;
    },
  };
}

/** The offset a request asked for: absent is 0. */
export function offsetOf(query: URLSearchParams): number {
  const raw = query.get("offset");
  return raw === null ? 0 : Number(raw);
}

/** The limit a request asked for, or the API's default when absent. */
export function limitOf(query: URLSearchParams, fallback: number): number {
  const raw = query.get("limit");
  return raw === null ? fallback : Number(raw);
}

function page<T>(items: T[], query: URLSearchParams, fallback: number): T[] {
  const offset = offsetOf(query);
  return items.slice(offset, offset + limitOf(query, fallback));
}

/** `GET /events/seasons` → the list, newest first. */
export function seasonsStub(seasons: string[] = TEST_SEASON_LIST): Stub {
  return stub("*/events/seasons", () => seasons);
}

/** `GET /events/seasons/{season}/champion` → by season; no champion for any other known one. */
export function championStub(
  bySeason: Record<string, ChampionOut> = { "2023-24": testChampion() },
): Stub {
  return stub("*/events/seasons/:season/champion", ({ path }) => {
    return bySeason[path.season] ?? noChampion(path.season);
  });
}

/** `GET /events/seasons/{season}/standings` → `testStandings` for any season. */
export function standingsStub(
  answer: (season: string) => StandingsOut | null = (season) =>
    testStandings(season),
): Stub {
  return stub("*/events/seasons/:season/standings", ({ path }) =>
    answer(path.season),
  );
}

/** `GET /events/seasons/{season}/leaders?stat=` → `testLeaders`, with `rules[season]` when given. */
export function leadersStub(rules: Record<string, string> = {}): Stub {
  return stub("*/events/seasons/:season/leaders", ({ path, query }) => {
    const stat = (query.get("stat") ?? "points") as LeaderStat;
    return testLeaders(path.season, stat, rules[path.season] ?? RULE_65);
  });
}

/**
 * `GET /events/games` → that season's games, sliced by `offset` and `limit`
 * (default 50). A request with no `season` gets `[]`.
 */
export function seasonGamesStub(bySeason: Record<string, GameOut[]> = {}): Stub {
  return stub("*/events/games", ({ query }) => {
    const season = query.get("season");
    return season === null ? [] : page(bySeason[season] ?? [], query, 50);
  });
}

/** `GET /events/teams/{team_id}/seasons/{season}` → `testTeamSeason`, for a known team. */
export function teamSeasonStub(
  answer: (teamId: number, season: string) => TeamSeasonOut | null = (
    teamId,
    season,
  ) => {
    const found = statsTeams().find((t) => t.id === teamId);
    return found === undefined ? null : testTeamSeason(found, season);
  },
): Stub {
  return stub("*/events/teams/:team_id/seasons/:season", ({ path }) =>
    answer(Number(path.team_id), path.season),
  );
}

/**
 * `GET /events/players?q=` → `answer(q)`, sliced by `offset` and `limit`
 * (default 20).
 */
export function playersStub(
  answer: (q: string | null) => PlayerListItemOut[] = () => [],
): Stub {
  return stub("*/events/players", ({ query }) =>
    page(answer(query.get("q")), query, 20),
  );
}

/** `GET /events/players/{player_id}` → the player of that id; 404 for any other. */
export function playerDetailStub(
  players: PlayerDetailOut[] = [testPlayerDetail()],
): Stub {
  const byId = new Map(players.map((p) => [p.id, p]));
  return stub("*/events/players/:player_id", ({ path }) =>
    byId.get(Number(path.player_id)) ?? null,
  );
}

/**
 * `GET /events/players/{player_id}/games` → that player's log, sliced by
 * `offset` and `limit` (default 50); 404 for a player not given.
 */
export function playerGamesStub(
  byPlayer: Record<number, PlayerGameOut[]> = { 2544: [] },
): Stub {
  return stub("*/events/players/:player_id/games", ({ path, query }) => {
    const log = byPlayer[Number(path.player_id)];
    return log === undefined ? null : page(log, query, 50);
  });
}

/**
 * Every read the stats and player routes make on mount, answered quietly,
 * for the shell's own sweeps (`arrangeVisitor`). A test that asserts on any
 * of them passes its own stubs to `renderAppAt`, which installs them after
 * these, so they win.
 */
export function statsDefaults(): RequestHandler[] {
  return [
    seasonsStub().handler,
    championStub().handler,
    standingsStub().handler,
    leadersStub().handler,
    seasonGamesStub().handler,
    teamSeasonStub().handler,
    playersStub().handler,
    playerDetailStub().handler,
    playerGamesStub().handler,
  ];
}
