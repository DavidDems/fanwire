import { screen, waitFor } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import { HttpResponse, http, type RequestHandler } from "msw";
import { expect } from "vitest";

import type { components } from "../api/schema";
import { teamsAre } from "./auth";
import {
  AWAY_DID_NOT_PLAY,
  AWAY_PLAYERS,
  HOME_DID_NOT_PLAY,
  HOME_PLAYERS,
  gameDetailStub,
  testBoxScorePlayer,
  testGameDetail,
  testTeamBoxScore,
  type BoxScorePlayerOut,
  type GameDetailOut,
  type GameDetailStub,
} from "./games";
import {
  playerDetailStub,
  playersStub,
  seasonsStub,
  testPlayerDetail,
  testPlayerListItem,
  testStatLine,
  type PlayerDetailOut,
  type Stub,
} from "./stats";

/**
 * The composer's attachment kit (`FRONTEND-013`): fixtures, msw stubs and
 * picker drivers for attaching one sports-data link to a post.
 *
 * Every picker reads an existing `events/` route, so this file is mostly a
 * re-arrangement of `./games` and `./stats` around one game everybody agrees
 * on: **game 501, Phoenix Suns at Toronto Raptors, 117–109, 15 January 2024,
 * season 2023-24**, plus **game 502**, the same two teams a few days later
 * with both scores 0 — the backend's "not completed" rule, which the picker
 * must not offer.
 *
 * Game 501's box score gives every played row its own `line_id` (the shared
 * fixture gives them all 70001), keeps the shared two did-not-play players on
 * each side, and adds one played-shaped row whose `seconds_played` is null,
 * which is how a DNP row is stored ([[0x02-events]]): neither kind may be
 * offered as a "Player's game".
 *
 * The career player is LeBron James (2544) from `./stats`; `noPlayoffsCareer`
 * is the same player with no playoff games, so its "Playoffs" scope is not
 * offered.
 */

type GameOut = components["schemas"]["GameOut"];
export type DataLink = NonNullable<
  components["schemas"]["CreatePostRequest"]["data_link"]
>;

export const ATTACH_SEASON = "2023-24";
export const ATTACH_TEAM_ID = 1;

/** Game 501 as `GET /events/games` lists it. */
export const COMPLETED_GAME: GameOut = {
  id: 501,
  nba_game_id: 22300417,
  game_type: "regular",
  home_team_id: 1,
  away_team_id: 2,
  home_score: 117,
  away_score: 109,
  date: "2024-01-15T22:30:00",
  season: ATTACH_SEASON,
  venue: null,
};

/** Game 502: both scores 0, so not completed. */
export const UNPLAYED_GAME: GameOut = {
  id: 502,
  nba_game_id: 22300430,
  game_type: "regular",
  home_team_id: 2,
  away_team_id: 1,
  home_score: 0,
  away_score: 0,
  date: "2024-01-18T21:00:00",
  season: ATTACH_SEASON,
  venue: null,
};

/** Scottie Barnes's line in game 501: 22 points for Toronto. */
export const BARNES_LINE_ID = 80001;

/** A row in `players` that is stored as a DNP: `seconds_played` null. */
export const GHOST_LINE_ID = 80099;

function withLineIds(
  players: BoxScorePlayerOut[],
  first: number,
): BoxScorePlayerOut[] {
  return players.map((player, index) => ({
    ...player,
    line_id: first + index,
  }));
}

/** Game 501's detail, `GET /events/games/501`. */
export function attachGameDetail(
  overrides: Partial<GameDetailOut> = {},
): GameDetailOut {
  const ghost = testBoxScorePlayer({
    line_id: GHOST_LINE_ID,
    player_id: 1999999,
    first_name: "Ghost",
    last_name: "Rowman",
    // The schema types this as a number; the stored DNP row has null, and the
    // brief names that as the rule. Cast so the fixture can carry it.
    seconds_played: null as unknown as number,
  });
  return testGameDetail({
    id: 501,
    season: ATTACH_SEASON,
    home_box_score: testTeamBoxScore(
      [...withLineIds(HOME_PLAYERS, BARNES_LINE_ID), ghost],
      HOME_DID_NOT_PLAY,
    ),
    away_box_score: testTeamBoxScore(
      withLineIds(AWAY_PLAYERS, 80011),
      AWAY_DID_NOT_PLAY,
    ),
    ...overrides,
  });
}

/** Game 502's detail: an incomplete game. */
export function unplayedGameDetail(): GameDetailOut {
  return testGameDetail({
    id: 502,
    season: ATTACH_SEASON,
    home_team: { id: 2, name: "Phoenix Suns", abbreviation: "PHX" },
    away_team: { id: 1, name: "Toronto Raptors", abbreviation: "TOR" },
    home_score: 0,
    away_score: 0,
    home_line_score: null,
    away_line_score: null,
    home_box_score: testTeamBoxScore([], []),
    away_box_score: testTeamBoxScore([], []),
  });
}

/** LeBron with no playoff games: the "Playoffs" scope has nothing in it. */
export function noPlayoffsCareer(): PlayerDetailOut {
  return testPlayerDetail({
    career_playoffs: testStatLine({ games_played: 0 }),
  });
}

export interface TeamGamesStub {
  handler: RequestHandler;
  /** The query string of every `GET /events/games` answered, in order. */
  readonly queries: URLSearchParams[];
}

/**
 * `GET /events/games?team_id&season` → `games` for team 1 in 2023-24, `[]`
 * for anything else, so a picker that forgot either filter lists nothing.
 */
export function teamGamesStub(
  games: GameOut[] = [COMPLETED_GAME, UNPLAYED_GAME],
): TeamGamesStub {
  const queries: URLSearchParams[] = [];
  return {
    handler: http.get("*/events/games", ({ request }) => {
      const query = new URL(request.url).searchParams;
      queries.push(query);
      const matches =
        query.get("team_id") === String(ATTACH_TEAM_ID) &&
        query.get("season") === ATTACH_SEASON;
      return HttpResponse.json<GameOut[]>(matches ? games : []);
    }),
    queries,
  };
}

export interface AttachServer {
  games: TeamGamesStub;
  detail: GameDetailStub;
  players: Stub;
  player: Stub;
}

export interface AttachServerOptions {
  games?: GameOut[];
  details?: GameDetailOut[];
  career?: PlayerDetailOut;
}

/**
 * Every read the three pickers make, in handlers for `server.use`.
 * `GET /events/players?q=` answers LeBron for any query containing "jam"
 * (case-insensitive), and nobody otherwise.
 */
export function attachServer(options: AttachServerOptions = {}): {
  handlers: RequestHandler[];
  stubs: AttachServer;
} {
  const games = teamGamesStub(options.games);
  const detail = gameDetailStub(
    options.details ?? [attachGameDetail(), unplayedGameDetail()],
  );
  const players = playersStub((q) =>
    q !== null && q.toLowerCase().includes("jam") ? [testPlayerListItem()] : [],
  );
  const player = playerDetailStub([options.career ?? testPlayerDetail()]);
  return {
    handlers: [
      teamsAre(),
      seasonsStub([ATTACH_SEASON, "2022-23"]).handler,
      games.handler,
      detail.handler,
      players.handler,
      player.handler,
    ],
    stubs: { games, detail, players, player },
  };
}

// ------------------------------------------------------------ the picker

type User = ReturnType<typeof userEvent.setup>;

/** The control that opens the picker. */
export function attachStatsButton(): HTMLElement {
  return screen.getByRole("button", { name: /^attach stats$/i });
}

export function queryAttachStatsButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: /^attach stats$/i });
}

/** The three choices, by the names the criterion gives them. */
export const CHOICES = {
  game: /^game result$/i,
  playerGame: /^player.s game$/i,
  career: /^player career$/i,
} as const;

/**
 * The summary of what is attached: a region named "Attached stats"
 * (`<section aria-label="Attached stats">`), or `null` when nothing is.
 */
export function attachedSummary(): HTMLElement | null {
  return screen.queryByRole("region", { name: /^attached stats$/i });
}

export async function findAttachedSummary(): Promise<HTMLElement> {
  return screen.findByRole("region", { name: /^attached stats$/i });
}

/** One line, whitespace collapsed. */
export function textOf(element: HTMLElement): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** A game choice for game 501, by its two scores. */
export const COMPLETED_GAME_NAME = /(?=.*\b117\b)(?=.*\b109\b)/;

export async function openPicker(user: User): Promise<void> {
  await user.click(attachStatsButton());
}

/** Choose `choice`, then narrow to Toronto in 2023-24. */
async function narrowToTorontoIn202324(user: User, choice: RegExp) {
  await user.click(await screen.findByRole("button", { name: choice }));
  await user.selectOptions(
    await screen.findByRole("combobox", { name: /team/i }),
    await screen.findByRole("option", { name: /Toronto Raptors/ }),
  );
  await user.selectOptions(
    await screen.findByRole("combobox", { name: /season/i }),
    await screen.findByRole("option", { name: ATTACH_SEASON }),
  );
}

/** Open the picker and attach game 501 as a game result. */
export async function attachGameResult(user: User): Promise<void> {
  await openPicker(user);
  await narrowToTorontoIn202324(user, CHOICES.game);
  await user.click(
    await screen.findByRole("button", { name: COMPLETED_GAME_NAME }),
  );
}

/** Open the picker, choose game 501 and attach Scottie Barnes's line. */
export async function attachBarnesLine(user: User): Promise<void> {
  await openPicker(user);
  await narrowToTorontoIn202324(user, CHOICES.playerGame);
  await user.click(
    await screen.findByRole("button", { name: COMPLETED_GAME_NAME }),
  );
  await user.click(await screen.findByRole("button", { name: /Barnes/ }));
}

/** The player search box in the career picker. */
export async function findPlayerSearch(): Promise<HTMLElement> {
  return screen.findByLabelText(/player/i, { selector: "input" });
}

/** Open the picker, find LeBron by name and attach a career scope. */
export async function attachLebronCareer(
  user: User,
  scope: RegExp = /^regular season/i,
): Promise<void> {
  await openPicker(user);
  await user.click(await screen.findByRole("button", { name: CHOICES.career }));
  await user.type(await findPlayerSearch(), "James");
  await user.click(await screen.findByRole("button", { name: /LeBron James/ }));
  await user.click(await screen.findByRole("button", { name: scope }));
}

/** Wait until the summary is on screen and return it. */
export async function summaryShown(): Promise<HTMLElement> {
  const summary = await findAttachedSummary();
  await waitFor(() => expect(textOf(summary)).not.toBe(""));
  return summary;
}
