import { HttpResponse, http, type RequestHandler } from "msw";

import type { components } from "../api/schema";
import { TEST_AWAY_TEAM, TEST_HOME_TEAM } from "./games";

/**
 * FRONTEND-044: the Schedule page's network kit. Fixtures and an msw stub for
 * `GET /events/seasons/{season}/schedule` (`EVENTS-014`, [[0x02b-events-loading]] "The
 * schedule"), typed against the generated schema, so a fixture that drifts
 * from the route is a typecheck failure.
 *
 * Every `date` is the stored naive US-Eastern timestamp, with no `Z`, as the
 * route sends it: `2026-11-07T19:30:00` is 7:30 PM Eastern on 7 November.
 * A `time_tbd` game's stored time is `00:00:00` (the source's "not set yet");
 * its date is still the game's day.
 *
 * The default season, `NOVEMBER_SCHEDULE`, is 2026-27 around Saturday
 * 7 November 2026 (`SCHEDULE_TODAY`):
 *
 * - Thu 5 Nov: one final, Knicks 98 at Celtics 104 (game 9105).
 * - Fri 6 Nov: one final, Suns 109 at Raptors 117 (game 9106), the teams and
 *   score of `testRecentGame()`, so its card can be compared with a Recent
 *   Games card.
 * - Sat 7 Nov, in the route's order (date, then `nba_game_id`): a `time_tbd`
 *   Knicks at Suns; a final, Celtics 99 at Knicks 101 (game 9107); Raptors at
 *   Celtics at 7:30 PM; and an undecided away team at the Lakers at 7:30 PM.
 *   Neither the team names nor the scores are in that order, so a page that
 *   re-sorted them shows the wrong order.
 * - Sun 8 Nov: no game.
 * - Mon 9 Nov: Suns at Knicks at 10:00 PM.
 */

export type ScheduleOut = components["schemas"]["ScheduleOut"];
export type ScheduleGameOut = components["schemas"]["ScheduleGameOut"];
export type TeamRefOut = components["schemas"]["TeamRefOut"];

/** Saturday 7 November 2026, the clock's day in the page's tests. */
export const SCHEDULE_TODAY = "2026-11-07";
/** Noon Eastern on `SCHEDULE_TODAY` (EST, UTC-5, after 1 November). */
export const SCHEDULE_NOON = "2026-11-07T17:00:00Z";
export const SCHEDULE_SEASON = "2026-27";

export const RAPTORS: TeamRefOut = TEST_HOME_TEAM;
export const SUNS: TeamRefOut = TEST_AWAY_TEAM;
export const CELTICS_REF: TeamRefOut = {
  id: 3,
  name: "Boston Celtics",
  abbreviation: "BOS",
};
export const KNICKS_REF: TeamRefOut = {
  id: 4,
  name: "New York Knicks",
  abbreviation: "NYK",
};
export const LAKERS_REF: TeamRefOut = {
  id: 5,
  name: "Los Angeles Lakers",
  abbreviation: "LAL",
};

/** A played game: `final`, with its `game_id` and score. */
export function finalGame(
  overrides: Partial<ScheduleGameOut> & { game_id: number; date: string },
): ScheduleGameOut {
  return {
    nba_game_id: 22600000 + overrides.game_id,
    status: "final",
    time_tbd: false,
    game_type: "regular",
    label: null,
    sub_label: null,
    series_game_number: null,
    venue: null,
    home_team: RAPTORS,
    away_team: SUNS,
    home_score: 117,
    away_score: 109,
    ...overrides,
  };
}

/** A game not played yet: `scheduled`, no `game_id` or score. */
export function scheduledGame(
  overrides: Partial<ScheduleGameOut> & { nba_game_id: number; date: string },
): ScheduleGameOut {
  return {
    status: "scheduled",
    game_id: null,
    time_tbd: false,
    game_type: "regular",
    label: null,
    sub_label: null,
    series_game_number: null,
    venue: null,
    home_team: RAPTORS,
    away_team: SUNS,
    home_score: null,
    away_score: null,
    ...overrides,
  };
}

export const NOV_5_FINAL = finalGame({
  game_id: 9105,
  date: "2026-11-05T19:30:00",
  away_team: KNICKS_REF,
  home_team: CELTICS_REF,
  away_score: 98,
  home_score: 104,
});

export const NOV_6_FINAL = finalGame({
  game_id: 9106,
  date: "2026-11-06T19:30:00",
  away_team: SUNS,
  home_team: RAPTORS,
  away_score: 109,
  home_score: 117,
});

/** Sat 7 Nov, the route's order. */
export const NOV_7_TIME_TBD = scheduledGame({
  nba_game_id: 22600150,
  date: "2026-11-07T00:00:00",
  time_tbd: true,
  away_team: KNICKS_REF,
  home_team: SUNS,
});
export const NOV_7_FINAL = finalGame({
  game_id: 9107,
  nba_game_id: 22600151,
  date: "2026-11-07T13:00:00",
  away_team: CELTICS_REF,
  home_team: KNICKS_REF,
  away_score: 99,
  home_score: 101,
});
export const NOV_7_EVENING = scheduledGame({
  nba_game_id: 22600152,
  date: "2026-11-07T19:30:00",
  away_team: RAPTORS,
  home_team: CELTICS_REF,
});
export const NOV_7_UNDECIDED = scheduledGame({
  nba_game_id: 22600153,
  date: "2026-11-07T19:30:00",
  away_team: null,
  home_team: LAKERS_REF,
});

export const NOV_9_LATE = scheduledGame({
  nba_game_id: 22600170,
  date: "2026-11-09T22:00:00",
  away_team: SUNS,
  home_team: KNICKS_REF,
});

export const NOVEMBER_SCHEDULE: ScheduleOut = {
  season: SCHEDULE_SEASON,
  games: [
    NOV_5_FINAL,
    NOV_6_FINAL,
    NOV_7_TIME_TBD,
    NOV_7_FINAL,
    NOV_7_EVENING,
    NOV_7_UNDECIDED,
    NOV_9_LATE,
  ],
};

export function testSchedule(
  season: string,
  games: ScheduleGameOut[] = [],
): ScheduleOut {
  return { season, games };
}

export interface ScheduleRequest {
  season: string;
  query: URLSearchParams;
}

export interface ScheduleStub {
  handler: RequestHandler;
  /** Every request answered, in order, recorded before answering. */
  readonly requests: ScheduleRequest[];
  /** The `{season}` of every request, in order. */
  seasons(): string[];
  /** Answer everything from here on with a 500. */
  fail(): void;
  /** Answer from the seasons again. */
  recover(): void;
}

/**
 * `GET /events/seasons/{season}/schedule`: the season's body from `seasons`
 * (a record by season, or a function of it), a 404 `{"detail": "Season or
 * team not found"}` for a season it has none of (`null` or absent).
 */
export function scheduleStub(
  seasons:
    | Record<string, ScheduleOut | null>
    | ((season: string) => ScheduleOut | null) = {
    [SCHEDULE_SEASON]: NOVEMBER_SCHEDULE,
  },
): ScheduleStub {
  const requests: ScheduleRequest[] = [];
  let failing = false;
  const answer =
    typeof seasons === "function"
      ? seasons
      : (season: string) => seasons[season] ?? null;
  return {
    handler: http.get<{ season: string }>(
      "*/events/seasons/:season/schedule",
      ({ request, params }) => {
        const season = String(params.season);
        requests.push({ season, query: new URL(request.url).searchParams });
        if (failing) {
          return HttpResponse.json(
            { detail: "Internal Server Error" },
            { status: 500 },
          );
        }
        const body = answer(season);
        if (body === null) {
          return HttpResponse.json(
            { detail: "Season or team not found" },
            { status: 404 },
          );
        }
        return HttpResponse.json<ScheduleOut>(body);
      },
    ),
    requests,
    seasons: () => requests.map((request) => request.season),
    fail(): void {
      failing = true;
    },
    recover(): void {
      failing = false;
    },
  };
}

/** Every season answered with no games: for tests that only render the shell. */
export function anyScheduleStub(): ScheduleStub {
  return scheduleStub((season) => testSchedule(season));
}
