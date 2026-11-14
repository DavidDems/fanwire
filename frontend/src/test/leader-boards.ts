import type { components } from "../api/schema";
import { RULE_65, RULE_70, stub, type Stub } from "./stats";

/**
 * FRONTEND-043: the leader-boards kit. Fixtures and an msw stub for
 * `GET /events/seasons/{season}/leader-boards` (`EVENTS-017`, [[0x02c-events-routes]]
 * "Seasons"), typed against the generated schema.
 *
 * The seasons are `TEST_SEASON_LIST`'s:
 *
 * - **2024-25, in progress** (`complete: false`, the on-pace rule). Its
 *   three-point % board has no leader ("No player qualifies yet.").
 * - **2023-24, complete** (`RULE_65`). Its points board is the real one
 *   (Dončić 33.9, Antetokounmpo 30.4, Gilgeous-Alexander 30.1); its assists
 *   board has a **tie at the top** (two players on 10.9); its rebounds board
 *   a tie **below** the leader (two on 12.4, who stay regular); its field
 *   goal % board is a percentage board with made and attempted.
 * - **2022-23, complete** (`RULE_70`).
 *
 * Every non-empty board has ten leaders (the `limit` the page asks for), the
 * ones after the named players generated: `Bench <Stat><rank>`, so every
 * name on a page is distinct.
 */

export type LeaderBoardsOut = components["schemas"]["LeaderBoardsOut"];
export type LeaderBoardOut = components["schemas"]["LeaderBoardOut"];
export type BoardLeaderOut = components["schemas"]["BoardLeaderOut"];
export type BoardStat = LeaderBoardOut["stat"];

/** EVENTS-017's board order, which the cards keep. */
export const BOARD_ORDER: readonly BoardStat[] = [
  "points",
  "assists",
  "rebounds",
  "blocks",
  "steals",
  "field_goals_made",
  "threes",
  "field_goal_pct",
  "three_point_pct",
  "field_goals_attempted",
  "three_pointers_attempted",
];

/**
 * Whether a card's title names its board. The wording is the implementer's
 * ("Points per game", "FG%" or "Field goal %" alike); the board is not, and
 * each test here holds for its own board's title and no other's.
 */
const THREE = /\bthree|\b3/i;
const FIELD_GOAL = /field goal|\bfg/i;
const PCT = /%|percent|pct/i;
const MADE = /made|fgm|3pm/i;
const ATTEMPTED = /attempt|fga|3pa/i;

export const BOARD_TITLE: Record<BoardStat, (title: string) => boolean> = {
  points: (t) => /^points\b/i.test(t),
  assists: (t) => /^assists\b/i.test(t),
  rebounds: (t) => /^rebounds\b/i.test(t),
  blocks: (t) => /^blocks\b/i.test(t),
  steals: (t) => /^steals\b/i.test(t),
  field_goals_made: (t) =>
    FIELD_GOAL.test(t) && MADE.test(t) && !THREE.test(t) && !PCT.test(t),
  threes: (t) => THREE.test(t) && !PCT.test(t) && !ATTEMPTED.test(t),
  field_goal_pct: (t) => FIELD_GOAL.test(t) && PCT.test(t) && !THREE.test(t),
  three_point_pct: (t) => THREE.test(t) && PCT.test(t),
  field_goals_attempted: (t) =>
    FIELD_GOAL.test(t) && ATTEMPTED.test(t) && !THREE.test(t),
  three_pointers_attempted: (t) =>
    THREE.test(t) && ATTEMPTED.test(t) && !PCT.test(t),
};

export const PERCENTAGE_BOARDS: readonly BoardStat[] = [
  "field_goal_pct",
  "three_point_pct",
];

export const IN_PROGRESS_SEASON = "2024-25";
export const COMPLETE_SEASON = "2023-24";
export const OLDER_SEASON = "2022-23";

export const ON_PACE_RULE =
  "On pace for 65 games: 42, with 52 team games played";

export const LIMIT = 10;

function leader(
  player_id: number,
  first_name: string,
  last_name: string,
  teams: string[],
  games_played: number,
  value: number,
  made: number | null = null,
  attempted: number | null = null,
): BoardLeaderOut {
  return {
    player_id,
    first_name,
    last_name,
    teams,
    games_played,
    value,
    made,
    attempted,
  };
}

const SHORT: Record<BoardStat, string> = {
  points: "Pts",
  assists: "Ast",
  rebounds: "Reb",
  blocks: "Blk",
  steals: "Stl",
  field_goals_made: "Fgm",
  threes: "Tpm",
  field_goal_pct: "Fgp",
  three_point_pct: "Tpp",
  field_goals_attempted: "Fga",
  three_pointers_attempted: "Tpa",
};

const PERCENTAGE = (stat: BoardStat) => PERCENTAGE_BOARDS.includes(stat);

/** Leaders after the named ones, falling from `below`, to ten in all. */
function fill(
  stat: BoardStat,
  season: string,
  named: BoardLeaderOut[],
  below: number,
): BoardLeaderOut[] {
  const seasonDigit = Number(season.slice(2, 4));
  const out = [...named];
  for (let rank = named.length + 1; out.length < LIMIT; rank += 1) {
    const step = rank - named.length;
    const id =
      800_000 + seasonDigit * 1000 + BOARD_ORDER.indexOf(stat) * 20 + rank;
    if (PERCENTAGE(stat)) {
      const attempted = 1000 + step * 10;
      const value = Number((below - step * 0.007).toFixed(3));
      const made = Math.round(value * attempted);
      out.push(
        leader(
          id,
          "Bench",
          `${SHORT[stat]}${rank}`,
          ["CHA"],
          66 + step,
          value,
          made,
          attempted,
        ),
      );
    } else {
      const value = Number((below - step * 0.3).toFixed(1));
      out.push(
        leader(id, "Bench", `${SHORT[stat]}${rank}`, ["CHA"], 66 + step, value),
      );
    }
  }
  return out;
}

export const LUKA = leader(1629029, "Luka", "Doncic", ["DAL"], 70, 33.9);
export const GIANNIS = leader(
  203507,
  "Giannis",
  "Antetokounmpo",
  ["MIL"],
  73,
  30.4,
);
export const SGA = leader(
  1628983,
  "Shai",
  "Gilgeous-Alexander",
  ["OKC"],
  75,
  30.1,
);

/** The assists board's tie at the top: both lead with 10.9. */
export const HALIBURTON = leader(
  1630169,
  "Tyrese",
  "Haliburton",
  ["IND"],
  69,
  10.9,
);
export const SIMMONS = leader(
  1627732,
  "Ben",
  "Simmons",
  ["BKN", "PHX"],
  66,
  10.9,
);
export const YOUNG = leader(1629027, "Trae", "Young", ["ATL"], 70, 10.8);

/** The rebounds board: one leader, then two tied below him (regular). */
export const SABONIS = leader(
  1627734,
  "Domantas",
  "Sabonis",
  ["SAC"],
  82,
  13.7,
);
export const JOKIC = leader(203999, "Nikola", "Jokic", ["DEN"], 79, 12.4);
export const GOBERT = leader(203497, "Rudy", "Gobert", ["MIN"], 76, 12.4);

/** The field goal % board (a percentage board: 0-1, made and attempted). */
export const GAFFORD = leader(
  1629655,
  "Daniel",
  "Gafford",
  ["WAS", "DAL"],
  74,
  0.725,
  343,
  473,
);
export const ALLEN = leader(
  1628386,
  "Jarrett",
  "Allen",
  ["CLE"],
  77,
  0.634,
  489,
  771,
);
export const ZUBAC = leader(
  1627826,
  "Ivica",
  "Zubac",
  ["LAC"],
  68,
  0.649,
  340,
  524,
);

function namedFor(stat: BoardStat, season: string): BoardLeaderOut[] {
  if (season !== COMPLETE_SEASON) return [];
  switch (stat) {
    case "points":
      return [LUKA, GIANNIS, SGA];
    case "assists":
      return [HALIBURTON, SIMMONS, YOUNG];
    case "rebounds":
      return [SABONIS, JOKIC, GOBERT];
    case "field_goal_pct":
      // Ranked by the exact fraction: Gafford, then Zubac, then Allen.
      return [GAFFORD, ZUBAC, ALLEN];
    default:
      return [];
  }
}

const TOP: Record<BoardStat, number> = {
  points: 33.9,
  assists: 10.9,
  rebounds: 13.7,
  blocks: 3.6,
  steals: 2.1,
  field_goals_made: 11.5,
  threes: 4.8,
  field_goal_pct: 0.725,
  three_point_pct: 0.459,
  field_goals_attempted: 22.6,
  three_pointers_attempted: 11.8,
};

function boardRule(stat: BoardStat, rule: string): string {
  if (stat === "field_goal_pct") return `${rule}; 300 field goals made`;
  if (stat === "three_point_pct") return `${rule}; 82 threes made`;
  return rule;
}

/** One board of `season`: ten leaders, or none (2024-25's three-point %). */
export function testBoard(
  season: string,
  stat: BoardStat,
  rule: string,
): LeaderBoardOut {
  const empty = season === IN_PROGRESS_SEASON && stat === "three_point_pct";
  const named = namedFor(stat, season);
  const below = named.length > 0 ? named[named.length - 1].value : TOP[stat];
  const leaders = empty
    ? []
    : named.length > 0
      ? fill(stat, season, named, below)
      : fill(stat, season, [], TOP[stat] + (PERCENTAGE(stat) ? 0.007 : 0.3));
  return {
    stat,
    rule: boardRule(stat, rule),
    minimum_made:
      stat === "field_goal_pct" ? 300 : stat === "three_point_pct" ? 82 : null,
    leaders,
  };
}

/** `season`'s answer: in progress for 2024-25, complete otherwise. */
export function testLeaderBoards(season: string): LeaderBoardsOut {
  const inProgress = season === IN_PROGRESS_SEASON;
  const rule = inProgress
    ? ON_PACE_RULE
    : season === OLDER_SEASON
      ? RULE_70
      : RULE_65;
  return {
    season,
    complete: !inProgress,
    rule,
    minimum_games: inProgress ? 42 : rule === RULE_70 ? 58 : 65,
    boards: BOARD_ORDER.map((stat) => testBoard(season, stat, rule)),
  };
}

/** A board of an answer. */
export function boardOf(
  answer: LeaderBoardsOut,
  stat: BoardStat,
): LeaderBoardOut {
  const board = answer.boards.find((b) => b.stat === stat);
  if (board === undefined) throw new Error(`no ${stat} board`);
  return board;
}

/** `first last`, as the cards print a player. */
export function leaderName(entry: BoardLeaderOut): string {
  return `${entry.first_name ?? ""} ${entry.last_name ?? ""}`.trim();
}

/**
 * A count board's value as shown, matched: the average to one place, at the
 * start ("33.9", or "33.9 PPG" with a unit after it).
 */
export function averagePattern(value: number): RegExp {
  const text = value.toFixed(1).replace(".", "\\.");
  return new RegExp(`^${text}(?![\\d.])`);
}

/**
 * A percentage board's value as shown, matched: the 0-1 fraction as a
 * percentage to one place, at the start: "72.5 %" (the spec's "0.0 %"; a
 * space before the sign or none).
 */
export function percentPattern(value: number): RegExp {
  const text = (value * 100).toFixed(1).replace(".", "\\.");
  return new RegExp(`^${text}\\s?%`);
}

/**
 * `GET /events/seasons/{season}/leader-boards` → `answer(season)` (by
 * default `testLeaderBoards`), or a 404 for `null`. Every request is
 * recorded, with its `limit`.
 */
export function leaderBoardsStub(
  answer: (season: string) => LeaderBoardsOut | null = testLeaderBoards,
): Stub {
  return stub("*/events/seasons/:season/leader-boards", ({ path }) =>
    answer(path.season),
  );
}
