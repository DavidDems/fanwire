import type { components } from "../api/schema";
import { testPostView, type PostView } from "./feed";
import {
  AWAY_DID_NOT_PLAY,
  AWAY_PLAYERS,
  HOME_DID_NOT_PLAY,
  HOME_PLAYERS,
  testGameDetail,
  testTeamBoxScore,
  type BoxScorePlayerOut,
  type GameDetailOut,
} from "./games";
import {
  playerGame,
  testPlayerDetail,
  type PlayerDetailOut,
  type PlayerGameOut,
} from "./stats";

/**
 * The data-link preview kit (`FRONTEND-014`): a `PostView` carrying each of
 * POSTS-006's three `data_link_preview` types, and the game and player reads
 * their detail links land on.
 *
 * Everything is typed from the generated schema (`GameFinalPreviewView`,
 * `PlayerGamePreviewView`, `PlayerCareerPreviewView`, `DataLinkOut`); nothing
 * here restates a field.
 *
 * One game everybody agrees on, as in `./attach`: **game 501, Phoenix Suns at
 * Toronto Raptors, 109–117, 15 January 2024**. Its box score gives every
 * played row its own `line_id` (the shared `./games` fixture gives them all
 * the same one): Toronto's from 80001 (Scottie Barnes first), Phoenix's from
 * 80011. Scottie Barnes's line is the `player_game` preview's; his figures in
 * the preview are deliberately distinctive (31 points, 13 rebounds, 9
 * assists, 36:15, 11-19, 4-8, 5-6), so a test can find each one in a card
 * without matching a date or a count by accident.
 */

export type GameFinalPreviewView =
  components["schemas"]["GameFinalPreviewView"];
export type PlayerGamePreviewView =
  components["schemas"]["PlayerGamePreviewView"];
export type PlayerCareerPreviewView =
  components["schemas"]["PlayerCareerPreviewView"];
export type DataLinkOut = components["schemas"]["DataLinkOut"];
export type DataLinkPreview = NonNullable<PostView["data_link_preview"]>;

export const PREVIEW_GAME_ID = 501;
/** A second game, reached from a player's game log. */
export const SECOND_GAME_ID = 503;

export const BARNES_ID = 1630567;
export const BARNES_LINE_ID = 80001;
export const LEBRON_ID = 2544;

const RAPTORS = { id: 1, name: "Toronto Raptors", abbreviation: "TOR" };
const SUNS = { id: 2, name: "Phoenix Suns", abbreviation: "PHX" };

/** Phoenix Suns at Toronto Raptors, 109–117: a regular-season final. */
export function gameFinalPreview(
  overrides: Partial<GameFinalPreviewView> = {},
): GameFinalPreviewView {
  return {
    type: "game_final",
    game_id: PREVIEW_GAME_ID,
    season: "2023-24",
    date: "2024-01-15T22:30:00",
    game_type: "regular",
    label: null,
    sub_label: null,
    series_game_number: null,
    home_team: RAPTORS,
    away_team: SUNS,
    home_score: 117,
    away_score: 109,
    home_line_score: null,
    away_line_score: null,
    ...overrides,
  };
}

/** Scottie Barnes's line in game 501: a Toronto win, 117–109, at home. */
export function playerGamePreview(
  overrides: Partial<PlayerGamePreviewView> = {},
): PlayerGamePreviewView {
  return {
    type: "player_game",
    line_id: BARNES_LINE_ID,
    game_id: PREVIEW_GAME_ID,
    player_id: BARNES_ID,
    first_name: "Scottie",
    last_name: "Barnes",
    season: "2023-24",
    date: "2024-01-15T22:30:00",
    game_type: "regular",
    label: null,
    team: RAPTORS,
    opponent: SUNS,
    is_home: true,
    team_score: 117,
    opponent_score: 109,
    starter: true,
    seconds_played: 2175,
    dnp_reason: null,
    points: 31,
    rebounds: 13,
    assists: 9,
    steals: 2,
    blocks: 1,
    turnovers: 3,
    plus_minus: 14,
    field_goals_made: 11,
    field_goals_attempted: 19,
    field_goal_pct: 0.579,
    three_pointers_made: 4,
    three_pointers_attempted: 8,
    three_point_pct: 0.5,
    free_throws_made: 5,
    free_throws_attempted: 6,
    free_throw_pct: 0.833,
    ...overrides,
  };
}

/** The same line stored as a did-not-play: no minutes, zeros, a reason. */
export function dnpPlayerGamePreview(
  reason: string | null,
): PlayerGamePreviewView {
  return playerGamePreview({
    starter: false,
    seconds_played: null,
    dnp_reason: reason,
    points: 0,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
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
  });
}

/** LeBron James's regular-season career averages. */
export function playerCareerPreview(
  overrides: Partial<PlayerCareerPreviewView> = {},
): PlayerCareerPreviewView {
  return {
    type: "player_career",
    player_id: LEBRON_ID,
    first_name: "LeBron",
    last_name: "James",
    position: "F",
    first_season: "2003-04",
    last_season: "2024-25",
    scope: "regular",
    games_played: 1492,
    minutes_per_game: 37.9,
    points_per_game: 27.1,
    rebounds_per_game: 7.5,
    assists_per_game: 7.4,
    field_goal_pct: 0.506,
    three_point_pct: 0.348,
    free_throw_pct: 0.736,
    ...overrides,
  };
}

/** The stored attachment a preview was built from, in `DataLinkOut`'s shape. */
export function dataLinkOf(preview: DataLinkPreview): DataLinkOut {
  switch (preview.type) {
    case "game_final":
      return { type: "game_final", ref_id: preview.game_id, scope: null };
    case "player_game":
      return { type: "player_game", ref_id: preview.line_id, scope: null };
    case "player_career":
      return {
        type: "player_career",
        ref_id: preview.player_id,
        scope: preview.scope === "playoffs" ? "playoffs" : "regular",
      };
  }
}

/** A post carrying `preview`, and the link it was built from. */
export function postWithPreview(
  preview: DataLinkPreview,
  overrides: Partial<PostView> = {},
): PostView {
  return testPostView({
    like_count: 0,
    data_link: dataLinkOf(preview),
    data_link_preview: preview,
    ...overrides,
  });
}

/** A post whose link is set but whose target has no preview. */
export function postWithUnavailableLink(
  overrides: Partial<PostView> = {},
): PostView {
  return testPostView({
    like_count: 0,
    data_link: { type: "game_final", ref_id: PREVIEW_GAME_ID, scope: null },
    data_link_preview: null,
    ...overrides,
  });
}

function withLineIds(
  players: BoxScorePlayerOut[],
  first: number,
): BoxScorePlayerOut[] {
  return players.map((player, index) => ({
    ...player,
    line_id: first + index,
  }));
}

/** Game 501's detail, every played row with its own `line_id`. */
export function linedGameDetail(
  overrides: Partial<GameDetailOut> = {},
): GameDetailOut {
  return testGameDetail({
    id: PREVIEW_GAME_ID,
    home_box_score: testTeamBoxScore(
      withLineIds(HOME_PLAYERS, BARNES_LINE_ID),
      HOME_DID_NOT_PLAY,
    ),
    away_box_score: testTeamBoxScore(
      withLineIds(AWAY_PLAYERS, 80011),
      AWAY_DID_NOT_PLAY,
    ),
    ...overrides,
  });
}

/** Game 503: the game Scottie Barnes's game log links to. */
export function secondGameDetail(): GameDetailOut {
  return linedGameDetail({
    id: SECOND_GAME_ID,
    date: "2024-01-19T19:30:00",
    venue: "Footprint Center",
  });
}

/** Scottie Barnes, reached from game 501's box score. */
export function barnesDetail(): PlayerDetailOut {
  return testPlayerDetail({
    id: BARNES_ID,
    first_name: "Scottie",
    last_name: "Barnes",
    jersey: "4",
    birth_date: "2001-08-01",
    country: "USA",
    school: "Florida State",
    draft_year: 2021,
    draft_round: 1,
    draft_number: 4,
    first_season: "2021-22",
    last_season: "2024-25",
    seasons: [],
  });
}

/** Scottie Barnes's game log: one game, 503. */
export function barnesGameLog(): PlayerGameOut[] {
  return [
    playerGame(0, {
      game_id: SECOND_GAME_ID,
      date: "2024-01-19T19:30:00",
      season: "2023-24",
      team: RAPTORS,
      opponent: SUNS,
    }),
  ];
}
