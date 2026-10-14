import { HttpResponse, http, type RequestHandler } from "msw";

import type { components } from "../api/schema";

/**
 * The game page's network kit (`FRONTEND-008`): fixtures and msw handler
 * factories for `GET /events/games/{game_id}` ([[0x02-events]] "Game").
 *
 * Everything is typed against the generated schema (`GameDetailOut`,
 * `TeamBoxScoreOut`, `BoxScorePlayerOut`, `DidNotPlayOut`), so a fixture that
 * drifts from `backend/openapi.json` is a typecheck failure rather than a
 * suite that passes against a body the backend never sends. Nothing here
 * renames a field, and nothing mocks `apiClient` or `fetch`.
 *
 * The default game is a regular-season Phoenix Suns at Toronto Raptors,
 * 109–117, with a four-quarter line score and a full box score on both sides:
 * two starters then two bench players (in an order that is neither
 * alphabetical nor by minutes nor by points, so a component that sorted them
 * shows the wrong order), and two players who did not play — one with a
 * reason, one without. Its date is the stored naive US-Eastern timestamp,
 * 22:30 on 15 January 2024, with no `Z`.
 *
 * The box-score totals are summed from the played rows, as the backend does,
 * and are deliberately not the final score ([[0x02-events]]: "never adjusted
 * to the final score").
 */

export type GameDetailOut = components["schemas"]["GameDetailOut"];
export type TeamBoxScoreOut = components["schemas"]["TeamBoxScoreOut"];
export type BoxScorePlayerOut = components["schemas"]["BoxScorePlayerOut"];
export type DidNotPlayOut = components["schemas"]["DidNotPlayOut"];
export type ShootingOut = components["schemas"]["ShootingOut"];
export type TeamRefOut = components["schemas"]["TeamRefOut"];

export const TEST_HOME_TEAM: TeamRefOut = {
  id: 1,
  name: "Toronto Raptors",
  abbreviation: "TOR",
};

export const TEST_AWAY_TEAM: TeamRefOut = {
  id: 2,
  name: "Phoenix Suns",
  abbreviation: "PHX",
};

/** A played row. Every counting stat zero unless overridden; no attempts. */
export function testBoxScorePlayer(
  overrides: Partial<BoxScorePlayerOut> = {},
): BoxScorePlayerOut {
  return {
    player_id: 9001,
    first_name: "Test",
    last_name: "Player",
    starter: false,
    starting_position: null,
    seconds_played: 0,
    field_goals_made: 0,
    field_goals_attempted: 0,
    field_goal_pct: null,
    three_pointers_made: 0,
    three_pointers_attempted: 0,
    three_point_pct: null,
    free_throws_made: 0,
    free_throws_attempted: 0,
    free_throw_pct: null,
    offensive_rebounds: 0,
    defensive_rebounds: 0,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    personal_fouls: 0,
    plus_minus: 0,
    points: 0,
    ...overrides,
  };
}

export function testDidNotPlay(
  overrides: Partial<DidNotPlayOut> = {},
): DidNotPlayOut {
  return {
    player_id: 9101,
    first_name: "Bench",
    last_name: "Player",
    dnp_reason: null,
    ...overrides,
  };
}

/** made / attempted to three places, `null` when nothing was attempted. */
function pct(made: number, attempted: number): number | null {
  return attempted === 0 ? null : Math.round((made / attempted) * 1000) / 1000;
}

/** The team line, summed from the played rows the way the backend does. */
export function totalsOf(players: BoxScorePlayerOut[]): ShootingOut {
  const sum = (field: keyof ShootingOut & keyof BoxScorePlayerOut): number =>
    players.reduce((total, player) => total + Number(player[field] ?? 0), 0);
  const fgm = sum("field_goals_made");
  const fga = sum("field_goals_attempted");
  const tpm = sum("three_pointers_made");
  const tpa = sum("three_pointers_attempted");
  const ftm = sum("free_throws_made");
  const fta = sum("free_throws_attempted");
  return {
    seconds_played: sum("seconds_played"),
    field_goals_made: fgm,
    field_goals_attempted: fga,
    field_goal_pct: pct(fgm, fga),
    three_pointers_made: tpm,
    three_pointers_attempted: tpa,
    three_point_pct: pct(tpm, tpa),
    free_throws_made: ftm,
    free_throws_attempted: fta,
    free_throw_pct: pct(ftm, fta),
    offensive_rebounds: sum("offensive_rebounds"),
    defensive_rebounds: sum("defensive_rebounds"),
    rebounds: sum("rebounds"),
    assists: sum("assists"),
    steals: sum("steals"),
    blocks: sum("blocks"),
    turnovers: sum("turnovers"),
    personal_fouls: sum("personal_fouls"),
    points: sum("points"),
  };
}

export function testTeamBoxScore(
  players: BoxScorePlayerOut[],
  didNotPlay: DidNotPlayOut[] = [],
): TeamBoxScoreOut {
  return { players, did_not_play: didNotPlay, totals: totalsOf(players) };
}

/** A side with no box score at all: no rows, no DNPs, zero totals. */
export function emptyBoxScore(): TeamBoxScoreOut {
  return testTeamBoxScore([], []);
}

/**
 * The home side's played rows, in API order. Barnes is the row the format
 * tests read: 27:04, 8-13 (.615), 2-5 (.400), 4-4 (1.000), +12, 22 points.
 * Dick attempted nothing (every percentage null) and is -3; Boucher is 0
 * plus-minus and 0:59.
 */
export const HOME_PLAYERS: BoxScorePlayerOut[] = [
  testBoxScorePlayer({
    player_id: 1630567,
    first_name: "Scottie",
    last_name: "Barnes",
    starter: true,
    starting_position: "F",
    seconds_played: 1624,
    field_goals_made: 8,
    field_goals_attempted: 13,
    field_goal_pct: 0.615,
    three_pointers_made: 2,
    three_pointers_attempted: 5,
    three_point_pct: 0.4,
    free_throws_made: 4,
    free_throws_attempted: 4,
    free_throw_pct: 1,
    offensive_rebounds: 1,
    defensive_rebounds: 6,
    rebounds: 7,
    assists: 5,
    steals: 1,
    blocks: 0,
    turnovers: 2,
    personal_fouls: 3,
    plus_minus: 12,
    points: 22,
  }),
  testBoxScorePlayer({
    player_id: 1631096,
    first_name: "Immanuel",
    last_name: "Quickley",
    starter: true,
    starting_position: "G",
    seconds_played: 2100,
    field_goals_made: 9,
    field_goals_attempted: 18,
    field_goal_pct: 0.5,
    three_pointers_made: 3,
    three_pointers_attempted: 8,
    three_point_pct: 0.375,
    free_throws_made: 4,
    free_throws_attempted: 5,
    free_throw_pct: 0.8,
    defensive_rebounds: 4,
    rebounds: 4,
    assists: 7,
    plus_minus: 8,
    points: 25,
  }),
  testBoxScorePlayer({
    player_id: 1641711,
    first_name: "Gradey",
    last_name: "Dick",
    seconds_played: 245,
    plus_minus: -3,
  }),
  testBoxScorePlayer({
    player_id: 1628449,
    first_name: "Chris",
    last_name: "Boucher",
    seconds_played: 59,
    field_goals_made: 1,
    field_goals_attempted: 1,
    field_goal_pct: 1,
    plus_minus: 0,
    points: 2,
  }),
];

export const HOME_DID_NOT_PLAY: DidNotPlayOut[] = [
  testDidNotPlay({
    player_id: 1627751,
    first_name: "Jakob",
    last_name: "Poeltl",
    dnp_reason: "Injury/Illness - Left Knee; Soreness",
  }),
  testDidNotPlay({
    player_id: 1642263,
    first_name: "Jamal",
    last_name: "Shead",
    dnp_reason: null,
  }),
];

export const AWAY_PLAYERS: BoxScorePlayerOut[] = [
  testBoxScorePlayer({
    player_id: 1626164,
    first_name: "Devin",
    last_name: "Booker",
    starter: true,
    starting_position: "G",
    seconds_played: 2400,
    field_goals_made: 10,
    field_goals_attempted: 20,
    field_goal_pct: 0.5,
    three_pointers_made: 2,
    three_pointers_attempted: 6,
    three_point_pct: 0.333,
    free_throws_made: 5,
    free_throws_attempted: 6,
    free_throw_pct: 0.833,
    plus_minus: -6,
    points: 27,
  }),
  testBoxScorePlayer({
    player_id: 201142,
    first_name: "Kevin",
    last_name: "Durant",
    starter: true,
    starting_position: "F",
    seconds_played: 2160,
    field_goals_made: 9,
    field_goals_attempted: 17,
    field_goal_pct: 0.529,
    three_pointers_made: 1,
    three_pointers_attempted: 4,
    three_point_pct: 0.25,
    free_throws_made: 6,
    free_throws_attempted: 7,
    free_throw_pct: 0.857,
    plus_minus: -4,
    points: 25,
  }),
  testBoxScorePlayer({
    player_id: 1628960,
    first_name: "Grayson",
    last_name: "Allen",
    seconds_played: 1500,
    field_goals_made: 3,
    field_goals_attempted: 7,
    field_goal_pct: 0.429,
    three_pointers_made: 2,
    three_pointers_attempted: 5,
    three_point_pct: 0.4,
    plus_minus: 2,
    points: 8,
  }),
];

export const AWAY_DID_NOT_PLAY: DidNotPlayOut[] = [
  testDidNotPlay({
    player_id: 1627755,
    first_name: "Damion",
    last_name: "Lee",
    dnp_reason: "Injury/Illness - Right Knee; Meniscus",
  }),
  testDidNotPlay({
    player_id: 1628386,
    first_name: "Bol",
    last_name: "Bol",
    dnp_reason: null,
  }),
];

/** Phoenix Suns at Toronto Raptors, 109–117, 22:30 ET on 15 January 2024. */
export function testGameDetail(
  overrides: Partial<GameDetailOut> = {},
): GameDetailOut {
  return {
    id: 501,
    nba_game_id: 22300417,
    season: "2023-24",
    date: "2024-01-15T22:30:00",
    game_type: "regular",
    label: null,
    sub_label: null,
    series_game_number: null,
    venue: null,
    home_team: TEST_HOME_TEAM,
    away_team: TEST_AWAY_TEAM,
    home_score: 117,
    away_score: 109,
    home_line_score: [30, 28, 31, 28],
    away_line_score: [25, 27, 30, 27],
    home_box_score: testTeamBoxScore(HOME_PLAYERS, HOME_DID_NOT_PLAY),
    away_box_score: testTeamBoxScore(AWAY_PLAYERS, AWAY_DID_NOT_PLAY),
    ...overrides,
  };
}

export interface GameDetailStub {
  handler: RequestHandler;
  /** The `{game_id}` of every request answered, in order. */
  readonly requests: number[];
}

/**
 * `GET /events/games/{game_id}` → 200 with the game of that id; 404 for any
 * id not given, which is what the backend answers for an unknown game.
 */
export function gameDetailStub(games: GameDetailOut[]): GameDetailStub {
  const requests: number[] = [];
  const byId = new Map(games.map((game) => [game.id, game]));

  return {
    handler: http.get<{ game_id: string }>(
      "*/events/games/:game_id",
      ({ params }) => {
        const gameId = Number(params.game_id);
        requests.push(gameId);
        const game = byId.get(gameId);
        if (game === undefined) {
          return HttpResponse.json(
            { detail: "Game not found" },
            { status: 404 },
          );
        }
        return HttpResponse.json<GameDetailOut>(game);
      },
    ),
    requests,
  };
}

/** `GET /events/games/{game_id}` → a 500 for every id. */
export function gameDetailFails(): RequestHandler {
  return http.get("*/events/games/:game_id", () =>
    HttpResponse.json({ detail: "Internal Server Error" }, { status: 500 }),
  );
}
