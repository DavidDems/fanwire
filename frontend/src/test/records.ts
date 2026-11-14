import { HttpResponse, http, type RequestHandler } from "msw";

import type { components } from "../api/schema";
import {
  CELTICS,
  NETS,
  NUGGETS,
  RAPTORS,
  SUNS,
  ref,
  stub,
  type RecordedRequest,
  type Stub,
  type TeamRefOut,
} from "./stats";

/**
 * The records kit (`FRONTEND-019`): fixtures and msw stubs for
 * `GET /events/records` and `GET /events/records/{record_id}` (`EVENTS-010`,
 * [[0x02d-events-records]] "Records"), in `test/stats.ts`'s style: every stub records
 * the path parameters and query string of every request it answered.
 *
 * The records are `app/events/records.py`'s whole library (`EVENTS-012`, 104
 * records, `FRONTEND-030` widened the kit from the twelve), in its order, team
 * records first, with its ids, categories, titles, units, rule texts and
 * keywords word for word. Each record's list is built here, and the summary's
 * holder is that list's first entry plus `tied_count`, how many entries share
 * its value, so a card and its list always agree. A library record not named
 * below has an empty list, so its holder is null.
 *
 * What the lists hold, for the tests that read them:
 *
 * - `team-championships`: ranks 1, 1, 3 (a two-way tie at the top, so its
 *   card says "and 1 other"); a team and a value, no season or game.
 * - `team-best-season`: four seasons, ranks 1, 2, 3, 4 as the API gives them,
 *   the 2nd and 3rd both `.841` (the API ranks the exact fraction: 69-13
 *   above 53-10). The holder is the Warriors' 73-9 (`.890`).
 * - `team-worst-season`: three seasons, the worst alone (the Bobcats' 7-59).
 * - `player-threes-game`: Thompson's 14 of 24 (`58.3%`), then Curry's 12 of
 *   21 (`57.1%`).
 * - `team-most-points-game` and the player single-game records: a team, a
 *   season and a game (date and opponent) on every entry.
 * - `team-largest-win`: empty, so its holder is null (nothing qualifies).
 * - `player-points-game`: the full 100 (`total` 100), Adebayo's 83 first.
 * - `player-assists-game`: a three-way tie at the top ("and 2 others").
 * - `player-championships` and the two career records: a player and a value
 *   only (no team, season or game).
 * - `player-threes-season` (`made_total`): Curry's 402 of 886 (`45.4%`).
 * - `player-three-pct-season` (`shot_pct`): Curry's 402 of 886, `value` and
 *   `pct` 0.454, so `45.4%` with `(402/886)`.
 * - `player-ppg-season` (`average`): Harden's 31 (`31.0`), then 30.4.
 * - `team-longest-win-streak`: the Heat's 27 in 2012-13.
 *
 * `EVENTS-011`: every record has a `value_kind`. The two season records are
 * `win_loss`, unit "record", and their entries carry `wins`, `losses` and
 * `pct`; `player-threes-game` is `made_total`, its entries carrying `made`,
 * `attempted` and `pct`; every other record is a `count`, with all five null.
 * `value` keeps its meaning (a season's win percentage).
 *
 * `EVENTS-012`: the API splits the old summary in two. `GET /events/records`
 * is the catalog (each record's `category`, `keywords` and `featured_rank`,
 * no holder) and `GET /events/records/holders?ids=a,b` the holders of up to
 * 24 records. The kit keeps one picture of the screen's data,
 * `testRecordsSummary()` (every record with its holder, as before), and both
 * stubs answer from it, so a test that shapes the summary shapes both reads.
 * The holders stub answers a 422 for no ids, more than 24, a duplicate or an
 * id the summary does not hold, as the API does.
 */

export type RecordHolderOut = components["schemas"]["RecordHolderOut"];
export type RecordListOut = components["schemas"]["RecordListOut"];
export type RecordEntryOut = components["schemas"]["RecordEntryOut"];
export type RecordGameOut = components["schemas"]["RecordGameOut"];
export type RecordPlayerOut = components["schemas"]["RecordPlayerOut"];
export type RecordGroup = RecordListOut["group"];
export type RecordValueKind = RecordListOut["value_kind"];

/** The seven categories of `EVENTS-012`. */
export type RecordCategory =
  | "team-franchise"
  | "team-season"
  | "team-game"
  | "player-game"
  | "player-season"
  | "player-career"
  | "player-playoffs";

/** One record of the catalog, `GET /events/records` (`EVENTS-012`). */
export interface RecordCatalogRecord {
  id: string;
  group: RecordGroup;
  category: RecordCategory;
  title: string;
  unit: string;
  rule: string;
  value_kind: RecordValueKind;
  keywords: string[];
  featured_rank: number | null;
}

/** `GET /events/records`: the catalog and the data window, no holder. */
export interface RecordCatalogOut {
  since_season: string | null;
  through_season: string | null;
  records: RecordCatalogRecord[];
}

/** `GET /events/records/holders?ids=`: one holder (or null) per asked id. */
export interface RecordHoldersOut {
  holders: Record<string, RecordHolderOut | null>;
}

/** The screen's picture of one record: its catalog entry and its holder. */
export type RecordSummaryOut = RecordCatalogRecord & {
  holder: RecordHolderOut | null;
};

/** The screen's data: both reads in one, as the kit's tests shape them. */
export interface RecordsSummaryOut {
  since_season: string | null;
  through_season: string | null;
  records: RecordSummaryOut[];
}

/** The most ids one holders read may ask for. */
export const HOLDERS_CAP = 24;

/** `RecordDefinition.value_kind`'s five kinds (`EVENTS-011`). */
export const VALUE_KINDS: readonly RecordValueKind[] = [
  "count",
  "win_loss",
  "made_total",
  "shot_pct",
  "average",
];

/** The stored data's window, as `GET /events/records` names it. */
export const SINCE_SEASON = "2003-04";
export const THROUGH_SEASON = "2026-27";

// ------------------------------------------------------------ the registry

export type RecordDefinition = RecordCatalogRecord;

/** A library row as written below: its group is its id's prefix. */
type LibraryRow = Omit<RecordDefinition, "group" | "featured_rank"> & {
  featured_rank?: number;
};

/**
 * `app/events/records.py`'s `CATALOG` (`EVENTS-012`, `FRONTEND-030`): all
 * 104 records, in its order (team-franchise, team-season, team-game, then
 * player-game, player-season, player-career, player-playoffs), each id,
 * category, title, unit, value kind, rule and keyword list word for word as
 * `GET /events/records` sends them. Dumped from the registry on 2026-11-03.
 */
const LIBRARY: LibraryRow[] = [
  {
    id: "team-championships",
    category: "team-franchise",
    title: "Most championships",
    unit: "titles",
    value_kind: "count",
    rule: "NBA titles won. Champion: the team that wins four of a season's playoff games labelled NBA Finals, as GET /events/seasons/{season}/champion decides.",
    keywords: ["championships", "titles", "rings", "franchise"],
    featured_rank: 3,
  },
  {
    id: "team-finals-appearances",
    category: "team-franchise",
    title: "Most NBA Finals appearances",
    unit: "Finals",
    value_kind: "count",
    rule: "Seasons with at least one playoff game labelled NBA Finals.",
    keywords: ["finals", "appearances", "playoffs", "postseason", "franchise"],
  },
  {
    id: "team-playoff-appearances",
    category: "team-franchise",
    title: "Most playoff appearances",
    unit: "seasons",
    value_kind: "count",
    rule: "Seasons with at least one playoff game (not the play-in).",
    keywords: ["playoffs", "postseason", "appearances", "franchise"],
  },
  {
    id: "team-most-wins-all-time",
    category: "team-franchise",
    title: "Most wins, all time",
    unit: "wins",
    value_kind: "count",
    rule: "Regular-season wins. Regular-season games only, over every stored season.",
    keywords: ["wins", "all-time", "franchise"],
  },
  {
    id: "team-best-win-pct-all-time",
    category: "team-franchise",
    title: "Best win percentage, all time",
    unit: "record",
    value_kind: "win_loss",
    rule: "Highest win percentage, then most wins. Regular-season games only, over every stored season.",
    keywords: ["win percentage", "record", "all-time", "franchise"],
  },
  {
    id: "team-best-season",
    category: "team-season",
    title: "Best regular season",
    unit: "record",
    value_kind: "win_loss",
    rule: "Highest win percentage in one season, then most wins. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: ["best season", "record", "wins", "season"],
    featured_rank: 1,
  },
  {
    id: "team-worst-season",
    category: "team-season",
    title: "Worst regular season",
    unit: "record",
    value_kind: "win_loss",
    rule: "Lowest win percentage in one season, then fewest wins. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: ["worst season", "record", "losses", "season"],
    featured_rank: 8,
  },
  {
    id: "team-most-wins-season",
    category: "team-season",
    title: "Most wins in a season",
    unit: "wins",
    value_kind: "count",
    rule: "Wins in one season. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: ["wins", "season"],
  },
  {
    id: "team-most-losses-season",
    category: "team-season",
    title: "Most losses in a season",
    unit: "losses",
    value_kind: "count",
    rule: "Losses in one season. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: ["losses", "season"],
  },
  {
    id: "team-longest-win-streak",
    category: "team-season",
    title: "Longest winning streak",
    unit: "wins",
    value_kind: "count",
    rule: "Wins in a row within one season, by date. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: ["streak", "winning streak", "wins", "season"],
    featured_rank: 12,
  },
  {
    id: "team-longest-losing-streak",
    category: "team-season",
    title: "Longest losing streak",
    unit: "losses",
    value_kind: "count",
    rule: "Losses in a row within one season, by date. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: ["streak", "losing streak", "losses", "season"],
  },
  {
    id: "team-highest-ppg-season",
    category: "team-season",
    title: "Most points per game in a season",
    unit: "points per game",
    value_kind: "average",
    rule: "Points scored per game over one season. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: [
      "points",
      "scoring",
      "pts",
      "ppg",
      "offense",
      "per game",
      "average",
      "season",
    ],
  },
  {
    id: "team-lowest-opp-ppg-season",
    category: "team-season",
    title: "Fewest points allowed per game in a season",
    unit: "points allowed per game",
    value_kind: "average",
    rule: "Opponents' points per game over one season, lowest first. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: [
      "points allowed",
      "opponent ppg",
      "defense",
      "per game",
      "average",
      "season",
    ],
  },
  {
    id: "team-best-point-diff-season",
    category: "team-season",
    title: "Best point differential in a season",
    unit: "points per game",
    value_kind: "average",
    rule: "Points scored minus points allowed, per game over one season. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: [
      "point differential",
      "margin",
      "net rating",
      "per game",
      "average",
      "season",
    ],
  },
  {
    id: "team-most-threes-season",
    category: "team-season",
    title: "Most threes in a season",
    unit: "threes",
    value_kind: "made_total",
    rule: "Three-pointers made by one team over one season. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: [
      "threes",
      "3pt",
      "3-pointers",
      "three-pointers",
      "3pm",
      "season",
    ],
  },
  {
    id: "team-three-pct-season",
    category: "team-season",
    title: "Best three-point percentage in a season",
    unit: "3P%",
    value_kind: "shot_pct",
    rule: "Three-pointers made over attempted, one team over one season. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: [
      "threes",
      "3pt",
      "3-pointers",
      "three-pointers",
      "3pm",
      "percentage",
      "pct",
      "%",
      "efficiency",
      "season",
    ],
  },
  {
    id: "team-field-goal-pct-season",
    category: "team-season",
    title: "Best field-goal percentage in a season",
    unit: "FG%",
    value_kind: "shot_pct",
    rule: "Field goals made over attempted, one team over one season. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: [
      "field goals",
      "fg",
      "shooting",
      "buckets",
      "percentage",
      "pct",
      "%",
      "efficiency",
      "season",
    ],
  },
  {
    id: "team-free-throw-pct-season",
    category: "team-season",
    title: "Best free-throw percentage in a season",
    unit: "FT%",
    value_kind: "shot_pct",
    rule: "Free throws made over attempted, one team over one season. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: [
      "free throws",
      "ft",
      "foul shots",
      "percentage",
      "pct",
      "%",
      "efficiency",
      "season",
    ],
  },
  {
    id: "team-apg-season",
    category: "team-season",
    title: "Most assists per game in a season",
    unit: "assists per game",
    value_kind: "average",
    rule: "Assists per game over one season, games with a box score. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: [
      "assists",
      "dimes",
      "ast",
      "apg",
      "per game",
      "average",
      "season",
    ],
  },
  {
    id: "team-rpg-season",
    category: "team-season",
    title: "Most rebounds per game in a season",
    unit: "rebounds per game",
    value_kind: "average",
    rule: "Rebounds per game over one season, games with a box score. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: [
      "rebounds",
      "boards",
      "reb",
      "rpg",
      "per game",
      "average",
      "season",
    ],
  },
  {
    id: "team-spg-season",
    category: "team-season",
    title: "Most steals per game in a season",
    unit: "steals per game",
    value_kind: "average",
    rule: "Steals per game over one season, games with a box score. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: [
      "steals",
      "stl",
      "defense",
      "spg",
      "per game",
      "average",
      "season",
    ],
  },
  {
    id: "team-bpg-season",
    category: "team-season",
    title: "Most blocks per game in a season",
    unit: "blocks per game",
    value_kind: "average",
    rule: "Blocks per game over one season, games with a box score. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: [
      "blocks",
      "blk",
      "rejections",
      "defense",
      "bpg",
      "per game",
      "average",
      "season",
    ],
  },
  {
    id: "team-fewest-turnovers-season",
    category: "team-season",
    title: "Fewest turnovers per game in a season",
    unit: "turnovers per game",
    value_kind: "average",
    rule: "Turnovers per game over one season, lowest first, games with a box score. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: [
      "turnovers",
      "tov",
      "ball security",
      "per game",
      "average",
      "season",
    ],
  },
  {
    id: "team-most-points-game",
    category: "team-game",
    title: "Most points in a game",
    unit: "points",
    value_kind: "count",
    rule: "Points scored by one team in one game. Regular-season and playoff games only (not the play-in or the NBA Cup final).",
    keywords: ["points", "scoring", "pts", "game", "single game"],
    featured_rank: 15,
  },
  {
    id: "team-fewest-points-game",
    category: "team-game",
    title: "Fewest points in a game",
    unit: "points",
    value_kind: "count",
    rule: "Points scored by one team in one completed game, lowest first. Regular-season and playoff games only (not the play-in or the NBA Cup final).",
    keywords: ["points", "scoring", "pts", "fewest", "game", "single game"],
  },
  {
    id: "team-largest-win",
    category: "team-game",
    title: "Largest win",
    unit: "points",
    value_kind: "count",
    rule: "Margin of victory in one game. Regular-season and playoff games only (not the play-in or the NBA Cup final).",
    keywords: ["margin", "blowout", "largest win", "game", "single game"],
    featured_rank: 16,
  },
  {
    id: "team-most-threes-game",
    category: "team-game",
    title: "Most threes in a game",
    unit: "threes",
    value_kind: "made_total",
    rule: "Three-pointers made by one team in one game. Regular-season and playoff games only (not the play-in or the NBA Cup final).",
    keywords: [
      "threes",
      "3pt",
      "3-pointers",
      "three-pointers",
      "3pm",
      "game",
      "single game",
    ],
  },
  {
    id: "team-most-assists-game",
    category: "team-game",
    title: "Most assists in a game",
    unit: "assists",
    value_kind: "count",
    rule: "Assists by one team in one game. Regular-season and playoff games only (not the play-in or the NBA Cup final).",
    keywords: ["assists", "dimes", "ast", "game", "single game"],
  },
  {
    id: "team-most-rebounds-game",
    category: "team-game",
    title: "Most rebounds in a game",
    unit: "rebounds",
    value_kind: "count",
    rule: "Rebounds by one team in one game. Regular-season and playoff games only (not the play-in or the NBA Cup final).",
    keywords: ["rebounds", "boards", "reb", "game", "single game"],
  },
  {
    id: "team-most-steals-game",
    category: "team-game",
    title: "Most steals in a game",
    unit: "steals",
    value_kind: "count",
    rule: "Steals by one team in one game. Regular-season and playoff games only (not the play-in or the NBA Cup final).",
    keywords: ["steals", "stl", "defense", "game", "single game"],
  },
  {
    id: "team-most-blocks-game",
    category: "team-game",
    title: "Most blocks in a game",
    unit: "blocks",
    value_kind: "count",
    rule: "Blocks by one team in one game. Regular-season and playoff games only (not the play-in or the NBA Cup final).",
    keywords: ["blocks", "blk", "rejections", "defense", "game", "single game"],
  },
  {
    id: "team-highest-combined-points-game",
    category: "team-game",
    title: "Most combined points in a game",
    unit: "points",
    value_kind: "count",
    rule: "Both teams' points in one game, listed under the winner. Regular-season and playoff games only (not the play-in or the NBA Cup final).",
    keywords: [
      "points",
      "scoring",
      "pts",
      "combined",
      "shootout",
      "game",
      "single game",
    ],
  },
  {
    id: "team-playoff-most-points-game",
    category: "team-game",
    title: "Most points in a playoff game",
    unit: "points",
    value_kind: "count",
    rule: "Points scored by one team in one game. Playoff games only.",
    keywords: [
      "points",
      "scoring",
      "pts",
      "playoffs",
      "postseason",
      "game",
      "single game",
    ],
  },
  {
    id: "team-playoff-largest-win",
    category: "team-game",
    title: "Largest playoff win",
    unit: "points",
    value_kind: "count",
    rule: "Margin of victory in one game. Playoff games only.",
    keywords: [
      "margin",
      "blowout",
      "largest win",
      "playoffs",
      "postseason",
      "game",
      "single game",
    ],
  },
  {
    id: "player-points-game",
    category: "player-game",
    title: "Most points in a game",
    unit: "points",
    value_kind: "count",
    rule: "Points by one player in one game. Regular-season and playoff games only (not the play-in or the NBA Cup final).",
    keywords: ["points", "scoring", "pts", "game", "single game"],
    featured_rank: 2,
  },
  {
    id: "player-rebounds-game",
    category: "player-game",
    title: "Most rebounds in a game",
    unit: "rebounds",
    value_kind: "count",
    rule: "Rebounds by one player in one game. Regular-season and playoff games only (not the play-in or the NBA Cup final).",
    keywords: ["rebounds", "boards", "reb", "game", "single game"],
    featured_rank: 9,
  },
  {
    id: "player-offensive-rebounds-game",
    category: "player-game",
    title: "Most offensive rebounds in a game",
    unit: "offensive rebounds",
    value_kind: "count",
    rule: "Offensive rebounds by one player in one game. Regular-season and playoff games only (not the play-in or the NBA Cup final).",
    keywords: [
      "offensive rebounds",
      "oreb",
      "rebounds",
      "boards",
      "reb",
      "game",
      "single game",
    ],
  },
  {
    id: "player-defensive-rebounds-game",
    category: "player-game",
    title: "Most defensive rebounds in a game",
    unit: "defensive rebounds",
    value_kind: "count",
    rule: "Defensive rebounds by one player in one game. Regular-season and playoff games only (not the play-in or the NBA Cup final).",
    keywords: [
      "defensive rebounds",
      "dreb",
      "rebounds",
      "boards",
      "reb",
      "game",
      "single game",
    ],
  },
  {
    id: "player-assists-game",
    category: "player-game",
    title: "Most assists in a game",
    unit: "assists",
    value_kind: "count",
    rule: "Assists by one player in one game. Regular-season and playoff games only (not the play-in or the NBA Cup final).",
    keywords: ["assists", "dimes", "ast", "game", "single game"],
    featured_rank: 10,
  },
  {
    id: "player-steals-game",
    category: "player-game",
    title: "Most steals in a game",
    unit: "steals",
    value_kind: "count",
    rule: "Steals by one player in one game. Regular-season and playoff games only (not the play-in or the NBA Cup final).",
    keywords: ["steals", "stl", "defense", "game", "single game"],
  },
  {
    id: "player-blocks-game",
    category: "player-game",
    title: "Most blocks in a game",
    unit: "blocks",
    value_kind: "count",
    rule: "Blocks by one player in one game. Regular-season and playoff games only (not the play-in or the NBA Cup final).",
    keywords: ["blocks", "blk", "rejections", "defense", "game", "single game"],
  },
  {
    id: "player-threes-game",
    category: "player-game",
    title: "Most threes in a game",
    unit: "threes",
    value_kind: "made_total",
    rule: "Three-pointers made by one player in one game. Regular-season and playoff games only (not the play-in or the NBA Cup final).",
    keywords: [
      "threes",
      "3pt",
      "3-pointers",
      "three-pointers",
      "3pm",
      "game",
      "single game",
    ],
    featured_rank: 11,
  },
  {
    id: "player-three-pct-game",
    category: "player-game",
    title: "Best three-point shooting in a game",
    unit: "3P%",
    value_kind: "shot_pct",
    rule: "Three-pointers made over attempted by one player in one game. At least 8 attempts. Regular-season and playoff games only (not the play-in or the NBA Cup final).",
    keywords: [
      "threes",
      "3pt",
      "3-pointers",
      "three-pointers",
      "3pm",
      "percentage",
      "pct",
      "%",
      "efficiency",
      "game",
      "single game",
    ],
  },
  {
    id: "player-field-goals-game",
    category: "player-game",
    title: "Most field goals in a game",
    unit: "field goals",
    value_kind: "made_total",
    rule: "Field goals made by one player in one game. Regular-season and playoff games only (not the play-in or the NBA Cup final).",
    keywords: [
      "field goals",
      "fg",
      "shooting",
      "buckets",
      "game",
      "single game",
    ],
  },
  {
    id: "player-field-goal-pct-game",
    category: "player-game",
    title: "Best field-goal shooting in a game",
    unit: "FG%",
    value_kind: "shot_pct",
    rule: "Field goals made over attempted by one player in one game. At least 15 attempts. Regular-season and playoff games only (not the play-in or the NBA Cup final).",
    keywords: [
      "field goals",
      "fg",
      "shooting",
      "buckets",
      "percentage",
      "pct",
      "%",
      "efficiency",
      "game",
      "single game",
    ],
  },
  {
    id: "player-free-throws-game",
    category: "player-game",
    title: "Most free throws in a game",
    unit: "free throws",
    value_kind: "made_total",
    rule: "Free throws made by one player in one game. Regular-season and playoff games only (not the play-in or the NBA Cup final).",
    keywords: ["free throws", "ft", "foul shots", "game", "single game"],
  },
  {
    id: "player-free-throw-pct-game",
    category: "player-game",
    title: "Best free-throw shooting in a game",
    unit: "FT%",
    value_kind: "shot_pct",
    rule: "Free throws made over attempted by one player in one game. At least 10 attempts. Regular-season and playoff games only (not the play-in or the NBA Cup final).",
    keywords: [
      "free throws",
      "ft",
      "foul shots",
      "percentage",
      "pct",
      "%",
      "efficiency",
      "game",
      "single game",
    ],
  },
  {
    id: "player-minutes-game",
    category: "player-game",
    title: "Most minutes in a game",
    unit: "minutes",
    value_kind: "count",
    rule: "Whole minutes played by one player in one game. Regular-season and playoff games only (not the play-in or the NBA Cup final).",
    keywords: ["minutes", "min", "playing time", "game", "single game"],
  },
  {
    id: "player-plus-minus-game",
    category: "player-game",
    title: "Best plus-minus in a game",
    unit: "plus-minus",
    value_kind: "count",
    rule: "The team's points minus its opponent's while one player was on the court, in one game. Regular-season and playoff games only (not the play-in or the NBA Cup final).",
    keywords: ["plus-minus", "+/-", "plus minus", "game", "single game"],
  },
  {
    id: "player-points-season",
    category: "player-season",
    title: "Most points in a season",
    unit: "points",
    value_kind: "count",
    rule: "Points by one player over one season, summed across teams. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: ["points", "scoring", "pts", "season"],
  },
  {
    id: "player-rebounds-season",
    category: "player-season",
    title: "Most rebounds in a season",
    unit: "rebounds",
    value_kind: "count",
    rule: "Rebounds by one player over one season, summed across teams. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: ["rebounds", "boards", "reb", "season"],
  },
  {
    id: "player-offensive-rebounds-season",
    category: "player-season",
    title: "Most offensive rebounds in a season",
    unit: "offensive rebounds",
    value_kind: "count",
    rule: "Offensive rebounds by one player over one season, summed across teams. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: [
      "offensive rebounds",
      "oreb",
      "rebounds",
      "boards",
      "reb",
      "season",
    ],
  },
  {
    id: "player-assists-season",
    category: "player-season",
    title: "Most assists in a season",
    unit: "assists",
    value_kind: "count",
    rule: "Assists by one player over one season, summed across teams. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: ["assists", "dimes", "ast", "season"],
  },
  {
    id: "player-steals-season",
    category: "player-season",
    title: "Most steals in a season",
    unit: "steals",
    value_kind: "count",
    rule: "Steals by one player over one season, summed across teams. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: ["steals", "stl", "defense", "season"],
  },
  {
    id: "player-blocks-season",
    category: "player-season",
    title: "Most blocks in a season",
    unit: "blocks",
    value_kind: "count",
    rule: "Blocks by one player over one season, summed across teams. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: ["blocks", "blk", "rejections", "defense", "season"],
  },
  {
    id: "player-minutes-season",
    category: "player-season",
    title: "Most minutes in a season",
    unit: "minutes",
    value_kind: "count",
    rule: "Whole minutes played by one player over one season. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: ["minutes", "min", "playing time", "season"],
  },
  {
    id: "player-triple-doubles-season",
    category: "player-season",
    title: "Most triple-doubles in a season",
    unit: "triple-doubles",
    value_kind: "count",
    rule: "Games with 10 or more in at least three of points, rebounds, assists, steals and blocks, over one season. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: ["triple-doubles", "triple doubles", "season"],
  },
  {
    id: "player-double-doubles-season",
    category: "player-season",
    title: "Most double-doubles in a season",
    unit: "double-doubles",
    value_kind: "count",
    rule: "Games with 10 or more in at least two of points, rebounds, assists, steals and blocks, over one season. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: ["double-doubles", "double doubles", "season"],
  },
  {
    id: "player-threes-season",
    category: "player-season",
    title: "Most threes in a season",
    unit: "threes",
    value_kind: "made_total",
    rule: "Three-pointers made by one player over one season. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: [
      "threes",
      "3pt",
      "3-pointers",
      "three-pointers",
      "3pm",
      "season",
    ],
    featured_rank: 5,
  },
  {
    id: "player-three-pct-season",
    category: "player-season",
    title: "Best three-point percentage in a season",
    unit: "3P%",
    value_kind: "shot_pct",
    rule: "Three-pointers made over attempted by one player over one season. At least 200 attempts. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: [
      "threes",
      "3pt",
      "3-pointers",
      "three-pointers",
      "3pm",
      "percentage",
      "pct",
      "%",
      "efficiency",
      "season",
    ],
    featured_rank: 6,
  },
  {
    id: "player-field-goals-season",
    category: "player-season",
    title: "Most field goals in a season",
    unit: "field goals",
    value_kind: "made_total",
    rule: "Field goals made by one player over one season. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: ["field goals", "fg", "shooting", "buckets", "season"],
  },
  {
    id: "player-field-goal-pct-season",
    category: "player-season",
    title: "Best field-goal percentage in a season",
    unit: "FG%",
    value_kind: "shot_pct",
    rule: "Field goals made over attempted by one player over one season. At least 500 attempts. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: [
      "field goals",
      "fg",
      "shooting",
      "buckets",
      "percentage",
      "pct",
      "%",
      "efficiency",
      "season",
    ],
  },
  {
    id: "player-free-throws-season",
    category: "player-season",
    title: "Most free throws in a season",
    unit: "free throws",
    value_kind: "made_total",
    rule: "Free throws made by one player over one season. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: ["free throws", "ft", "foul shots", "season"],
  },
  {
    id: "player-free-throw-pct-season",
    category: "player-season",
    title: "Best free-throw percentage in a season",
    unit: "FT%",
    value_kind: "shot_pct",
    rule: "Free throws made over attempted by one player over one season. At least 150 attempts. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: [
      "free throws",
      "ft",
      "foul shots",
      "percentage",
      "pct",
      "%",
      "efficiency",
      "season",
    ],
  },
  {
    id: "player-ppg-season",
    category: "player-season",
    title: "Most points per game in a season",
    unit: "points per game",
    value_kind: "average",
    rule: "Points per played game over one season. At least 58 games played. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: [
      "points",
      "scoring",
      "pts",
      "ppg",
      "per game",
      "average",
      "season",
    ],
    featured_rank: 7,
  },
  {
    id: "player-rpg-season",
    category: "player-season",
    title: "Most rebounds per game in a season",
    unit: "rebounds per game",
    value_kind: "average",
    rule: "Rebounds per played game over one season. At least 58 games played. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: [
      "rebounds",
      "boards",
      "reb",
      "rpg",
      "per game",
      "average",
      "season",
    ],
  },
  {
    id: "player-apg-season",
    category: "player-season",
    title: "Most assists per game in a season",
    unit: "assists per game",
    value_kind: "average",
    rule: "Assists per played game over one season. At least 58 games played. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: [
      "assists",
      "dimes",
      "ast",
      "apg",
      "per game",
      "average",
      "season",
    ],
  },
  {
    id: "player-spg-season",
    category: "player-season",
    title: "Most steals per game in a season",
    unit: "steals per game",
    value_kind: "average",
    rule: "Steals per played game over one season. At least 58 games played. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: [
      "steals",
      "stl",
      "defense",
      "spg",
      "per game",
      "average",
      "season",
    ],
  },
  {
    id: "player-bpg-season",
    category: "player-season",
    title: "Most blocks per game in a season",
    unit: "blocks per game",
    value_kind: "average",
    rule: "Blocks per played game over one season. At least 58 games played. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: [
      "blocks",
      "blk",
      "rejections",
      "defense",
      "bpg",
      "per game",
      "average",
      "season",
    ],
  },
  {
    id: "player-mpg-season",
    category: "player-season",
    title: "Most minutes per game in a season",
    unit: "minutes per game",
    value_kind: "average",
    rule: "Minutes per played game over one season. At least 58 games played. Regular-season games only, in seasons with a champion (a season in progress never holds it).",
    keywords: [
      "minutes",
      "min",
      "playing time",
      "mpg",
      "per game",
      "average",
      "season",
    ],
  },
  {
    id: "player-career-points",
    category: "player-career",
    title: "Most career points",
    unit: "points",
    value_kind: "count",
    rule: "Regular-season points, summed over every played game.",
    keywords: ["points", "scoring", "pts", "career", "all-time"],
    featured_rank: 4,
  },
  {
    id: "player-career-rebounds",
    category: "player-career",
    title: "Most career rebounds",
    unit: "rebounds",
    value_kind: "count",
    rule: "Rebounds. Regular-season games only, over every played game.",
    keywords: ["rebounds", "boards", "reb", "career", "all-time"],
  },
  {
    id: "player-career-assists",
    category: "player-career",
    title: "Most career assists",
    unit: "assists",
    value_kind: "count",
    rule: "Assists. Regular-season games only, over every played game.",
    keywords: ["assists", "dimes", "ast", "career", "all-time"],
  },
  {
    id: "player-career-steals",
    category: "player-career",
    title: "Most career steals",
    unit: "steals",
    value_kind: "count",
    rule: "Steals. Regular-season games only, over every played game.",
    keywords: ["steals", "stl", "defense", "career", "all-time"],
  },
  {
    id: "player-career-blocks",
    category: "player-career",
    title: "Most career blocks",
    unit: "blocks",
    value_kind: "count",
    rule: "Blocks. Regular-season games only, over every played game.",
    keywords: ["blocks", "blk", "rejections", "defense", "career", "all-time"],
  },
  {
    id: "player-career-minutes",
    category: "player-career",
    title: "Most career minutes",
    unit: "minutes",
    value_kind: "count",
    rule: "Whole minutes played. Regular-season games only, over every played game.",
    keywords: ["minutes", "min", "playing time", "career", "all-time"],
  },
  {
    id: "player-career-games",
    category: "player-career",
    title: "Most career games",
    unit: "games",
    value_kind: "count",
    rule: "Games played (minutes on the court). Regular-season games only, over every played game.",
    keywords: ["games played", "longevity", "career", "all-time"],
  },
  {
    id: "player-career-triple-doubles",
    category: "player-career",
    title: "Most career triple-doubles",
    unit: "triple-doubles",
    value_kind: "count",
    rule: "Regular-season games with 10 or more in at least three of points, rebounds, assists, steals and blocks.",
    keywords: ["triple-doubles", "triple doubles", "career", "all-time"],
    featured_rank: 13,
  },
  {
    id: "player-career-double-doubles",
    category: "player-career",
    title: "Most career double-doubles",
    unit: "double-doubles",
    value_kind: "count",
    rule: "Games with 10 or more in at least two of points, rebounds, assists, steals and blocks. Regular-season games only, over every played game.",
    keywords: ["double-doubles", "double doubles", "career", "all-time"],
  },
  {
    id: "player-career-threes",
    category: "player-career",
    title: "Most career threes",
    unit: "threes",
    value_kind: "made_total",
    rule: "Three-pointers made. Regular-season games only, over every played game.",
    keywords: [
      "threes",
      "3pt",
      "3-pointers",
      "three-pointers",
      "3pm",
      "career",
      "all-time",
    ],
  },
  {
    id: "player-career-three-pct",
    category: "player-career",
    title: "Best career three-point percentage",
    unit: "3P%",
    value_kind: "shot_pct",
    rule: "Three-pointers made over attempted. At least 1,000 attempts. Regular-season games only, over every played game.",
    keywords: [
      "threes",
      "3pt",
      "3-pointers",
      "three-pointers",
      "3pm",
      "percentage",
      "pct",
      "%",
      "efficiency",
      "career",
      "all-time",
    ],
  },
  {
    id: "player-career-field-goals",
    category: "player-career",
    title: "Most career field goals",
    unit: "field goals",
    value_kind: "made_total",
    rule: "Field goals made. Regular-season games only, over every played game.",
    keywords: [
      "field goals",
      "fg",
      "shooting",
      "buckets",
      "career",
      "all-time",
    ],
  },
  {
    id: "player-career-field-goal-pct",
    category: "player-career",
    title: "Best career field-goal percentage",
    unit: "FG%",
    value_kind: "shot_pct",
    rule: "Field goals made over attempted. At least 3,000 attempts. Regular-season games only, over every played game.",
    keywords: [
      "field goals",
      "fg",
      "shooting",
      "buckets",
      "percentage",
      "pct",
      "%",
      "efficiency",
      "career",
      "all-time",
    ],
  },
  {
    id: "player-career-free-throws",
    category: "player-career",
    title: "Most career free throws",
    unit: "free throws",
    value_kind: "made_total",
    rule: "Free throws made. Regular-season games only, over every played game.",
    keywords: ["free throws", "ft", "foul shots", "career", "all-time"],
  },
  {
    id: "player-career-free-throw-pct",
    category: "player-career",
    title: "Best career free-throw percentage",
    unit: "FT%",
    value_kind: "shot_pct",
    rule: "Free throws made over attempted. At least 1,000 attempts. Regular-season games only, over every played game.",
    keywords: [
      "free throws",
      "ft",
      "foul shots",
      "percentage",
      "pct",
      "%",
      "efficiency",
      "career",
      "all-time",
    ],
  },
  {
    id: "player-career-ppg",
    category: "player-career",
    title: "Most career points per game",
    unit: "points per game",
    value_kind: "average",
    rule: "Points per played game. At least 400 games played. Regular-season games only, over every played game.",
    keywords: [
      "points",
      "scoring",
      "pts",
      "ppg",
      "per game",
      "average",
      "career",
      "all-time",
    ],
  },
  {
    id: "player-career-rpg",
    category: "player-career",
    title: "Most career rebounds per game",
    unit: "rebounds per game",
    value_kind: "average",
    rule: "Rebounds per played game. At least 400 games played. Regular-season games only, over every played game.",
    keywords: [
      "rebounds",
      "boards",
      "reb",
      "rpg",
      "per game",
      "average",
      "career",
      "all-time",
    ],
  },
  {
    id: "player-career-apg",
    category: "player-career",
    title: "Most career assists per game",
    unit: "assists per game",
    value_kind: "average",
    rule: "Assists per played game. At least 400 games played. Regular-season games only, over every played game.",
    keywords: [
      "assists",
      "dimes",
      "ast",
      "apg",
      "per game",
      "average",
      "career",
      "all-time",
    ],
  },
  {
    id: "player-career-spg",
    category: "player-career",
    title: "Most career steals per game",
    unit: "steals per game",
    value_kind: "average",
    rule: "Steals per played game. At least 400 games played. Regular-season games only, over every played game.",
    keywords: [
      "steals",
      "stl",
      "defense",
      "spg",
      "per game",
      "average",
      "career",
      "all-time",
    ],
  },
  {
    id: "player-career-bpg",
    category: "player-career",
    title: "Most career blocks per game",
    unit: "blocks per game",
    value_kind: "average",
    rule: "Blocks per played game. At least 400 games played. Regular-season games only, over every played game.",
    keywords: [
      "blocks",
      "blk",
      "rejections",
      "defense",
      "bpg",
      "per game",
      "average",
      "career",
      "all-time",
    ],
  },
  {
    id: "player-championships",
    category: "player-playoffs",
    title: "Most championships",
    unit: "titles",
    value_kind: "count",
    rule: "Titles won: seasons with a played line (minutes on the court) for the champion in that season's NBA Finals. Champion: the team that wins four of a season's playoff games labelled NBA Finals, as GET /events/seasons/{season}/champion decides.",
    keywords: ["championships", "titles", "rings", "playoffs", "postseason"],
    featured_rank: 14,
  },
  {
    id: "player-playoff-points-game",
    category: "player-playoffs",
    title: "Most points in a playoff game",
    unit: "points",
    value_kind: "count",
    rule: "Points by one player in one game. Playoff games only.",
    keywords: [
      "points",
      "scoring",
      "pts",
      "playoffs",
      "postseason",
      "game",
      "single game",
    ],
  },
  {
    id: "player-playoff-rebounds-game",
    category: "player-playoffs",
    title: "Most rebounds in a playoff game",
    unit: "rebounds",
    value_kind: "count",
    rule: "Rebounds by one player in one game. Playoff games only.",
    keywords: [
      "rebounds",
      "boards",
      "reb",
      "playoffs",
      "postseason",
      "game",
      "single game",
    ],
  },
  {
    id: "player-playoff-assists-game",
    category: "player-playoffs",
    title: "Most assists in a playoff game",
    unit: "assists",
    value_kind: "count",
    rule: "Assists by one player in one game. Playoff games only.",
    keywords: [
      "assists",
      "dimes",
      "ast",
      "playoffs",
      "postseason",
      "game",
      "single game",
    ],
  },
  {
    id: "player-playoff-threes-game",
    category: "player-playoffs",
    title: "Most threes in a playoff game",
    unit: "threes",
    value_kind: "made_total",
    rule: "Three-pointers made by one player in one game. Playoff games only.",
    keywords: [
      "threes",
      "3pt",
      "3-pointers",
      "three-pointers",
      "3pm",
      "playoffs",
      "postseason",
      "game",
      "single game",
    ],
  },
  {
    id: "player-playoff-steals-game",
    category: "player-playoffs",
    title: "Most steals in a playoff game",
    unit: "steals",
    value_kind: "count",
    rule: "Steals by one player in one game. Playoff games only.",
    keywords: [
      "steals",
      "stl",
      "defense",
      "playoffs",
      "postseason",
      "game",
      "single game",
    ],
  },
  {
    id: "player-playoff-blocks-game",
    category: "player-playoffs",
    title: "Most blocks in a playoff game",
    unit: "blocks",
    value_kind: "count",
    rule: "Blocks by one player in one game. Playoff games only.",
    keywords: [
      "blocks",
      "blk",
      "rejections",
      "defense",
      "playoffs",
      "postseason",
      "game",
      "single game",
    ],
  },
  {
    id: "player-playoff-career-points",
    category: "player-playoffs",
    title: "Most career playoff points",
    unit: "points",
    value_kind: "count",
    rule: "Points. Playoff games only, over every played game.",
    keywords: [
      "points",
      "scoring",
      "pts",
      "playoffs",
      "postseason",
      "career",
      "all-time",
    ],
  },
  {
    id: "player-playoff-career-rebounds",
    category: "player-playoffs",
    title: "Most career playoff rebounds",
    unit: "rebounds",
    value_kind: "count",
    rule: "Rebounds. Playoff games only, over every played game.",
    keywords: [
      "rebounds",
      "boards",
      "reb",
      "playoffs",
      "postseason",
      "career",
      "all-time",
    ],
  },
  {
    id: "player-playoff-career-assists",
    category: "player-playoffs",
    title: "Most career playoff assists",
    unit: "assists",
    value_kind: "count",
    rule: "Assists. Playoff games only, over every played game.",
    keywords: [
      "assists",
      "dimes",
      "ast",
      "playoffs",
      "postseason",
      "career",
      "all-time",
    ],
  },
  {
    id: "player-playoff-career-threes",
    category: "player-playoffs",
    title: "Most career playoff threes",
    unit: "threes",
    value_kind: "made_total",
    rule: "Three-pointers made. Playoff games only, over every played game.",
    keywords: [
      "threes",
      "3pt",
      "3-pointers",
      "three-pointers",
      "3pm",
      "playoffs",
      "postseason",
      "career",
      "all-time",
    ],
  },
  {
    id: "player-playoff-career-steals",
    category: "player-playoffs",
    title: "Most career playoff steals",
    unit: "steals",
    value_kind: "count",
    rule: "Steals. Playoff games only, over every played game.",
    keywords: [
      "steals",
      "stl",
      "defense",
      "playoffs",
      "postseason",
      "career",
      "all-time",
    ],
  },
  {
    id: "player-playoff-career-blocks",
    category: "player-playoffs",
    title: "Most career playoff blocks",
    unit: "blocks",
    value_kind: "count",
    rule: "Blocks. Playoff games only, over every played game.",
    keywords: [
      "blocks",
      "blk",
      "rejections",
      "defense",
      "playoffs",
      "postseason",
      "career",
      "all-time",
    ],
  },
  {
    id: "player-playoff-career-games",
    category: "player-playoffs",
    title: "Most career playoff games",
    unit: "games",
    value_kind: "count",
    rule: "Games played (minutes on the court). Playoff games only, over every played game.",
    keywords: ["games played", "playoffs", "postseason", "career", "all-time"],
  },
];

/** `RECORDS`, the whole library, in the API's order. */
export const RECORD_DEFINITIONS: readonly RecordDefinition[] = LIBRARY.map(
  (row): RecordDefinition => ({
    ...row,
    group: row.id.startsWith("team-") ? "team" : "player",
    featured_rank: row.featured_rank ?? null,
  }),
);

export function recordDefinition(id: string): RecordDefinition {
  const found = RECORD_DEFINITIONS.find((record) => record.id === id);
  if (found === undefined) throw new Error(`no record ${id}`);
  return found;
}

/** The records of one group, in the API's order. */
export function recordsOf(group: RecordGroup): RecordDefinition[] {
  return RECORD_DEFINITIONS.filter((record) => record.group === group);
}

/** The season records: their lists carry the tie note. */
export const SEASON_RECORD_IDS = ["team-best-season", "team-worst-season"];

/**
 * The featured sixteen in `featured_rank` order, as `.ai/tasks/EVENTS-012/
 * brief.md` lists them: written out, not derived, so a screen that sorts
 * wrongly cannot agree with it by sharing its code.
 */
export const FEATURED_IDS: readonly string[] = [
  "team-best-season",
  "player-points-game",
  "team-championships",
  "player-career-points",
  "player-threes-season",
  "player-three-pct-season",
  "player-ppg-season",
  "team-worst-season",
  "player-rebounds-game",
  "player-assists-game",
  "player-threes-game",
  "team-longest-win-streak",
  "player-career-triple-doubles",
  "player-championships",
  "team-most-points-game",
  "team-largest-win",
];

/** How many cards a page of results shows, and Load more adds (`FRONTEND-030`). */
export const PAGE_SIZE = 24;

/**
 * The search's reference (`FRONTEND-030`): `query` split on whitespace, and
 * every term must be found, case-insensitive, as a substring of one of the
 * record's title, category, group, unit or keywords. An empty query matches
 * everything.
 */
export function matchesQuery(record: RecordDefinition, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const fields = [
    record.title,
    record.category,
    record.group,
    record.unit,
    ...record.keywords,
  ].map((field) => field.toLowerCase());
  return terms.every((term) => fields.some((field) => field.includes(term)));
}

/**
 * The ids a query finds, in the API's order: over the whole library, or
 * over one group's.
 */
export function searchIds(
  query: string,
  group: RecordGroup | null = null,
  records: readonly RecordDefinition[] = RECORD_DEFINITIONS,
): string[] {
  return records
    .filter((record) => group === null || record.group === group)
    .filter((record) => matchesQuery(record, query))
    .map((record) => record.id);
}

// ----------------------------------------------------- teams and players

/** Teams the stats kit does not hold; the rest are `test/stats.ts`'s. */
export const WARRIORS: TeamRefOut = {
  id: 7,
  name: "Golden State Warriors",
  abbreviation: "GSW",
};
export const BOBCATS: TeamRefOut = {
  id: 8,
  name: "Charlotte Bobcats",
  abbreviation: "CHA",
};
export const HEAT: TeamRefOut = {
  id: 16,
  name: "Miami Heat",
  abbreviation: "MIA",
};

function player(
  id: number,
  first_name: string | null,
  last_name: string | null,
): RecordPlayerOut {
  return { id, first_name, last_name };
}

export const ADEBAYO = player(1628389, "Bam", "Adebayo");
export const LEBRON = player(2544, "LeBron", "James");
export const JOKIC = player(203999, "Nikola", "Jokic");
export const WESTBROOK = player(201566, "Russell", "Westbrook");
export const THOMPSON = player(202691, "Klay", "Thompson");
export const RONDO = player(200765, "Rajon", "Rondo");
export const HALIBURTON = player(1630169, "Tyrese", "Haliburton");
export const HARDEN = player(201935, "James", "Harden");
export const CURRY = player(201939, "Stephen", "Curry");

/** A player's name as a card or a row shows it. */
export function playerName(p: RecordPlayerOut): string {
  return [p.first_name, p.last_name].filter(Boolean).join(" ");
}

function game(
  id: number,
  date: string,
  opponent_abbreviation: string,
  game_type = "regular",
): RecordGameOut {
  return { id, date, game_type, opponent_abbreviation };
}

/** Adebayo's 83, the points-in-a-game holder (EVENTS-010). */
export const ADEBAYO_GAME = game(9300, "2026-03-10T19:30:00", "WAS");
export const NUGGETS_GAME = game(9201, "2023-12-12T21:00:00", "PHX");

// ----------------------------------------------------------- the entries

type EntryFields = Omit<RecordEntryOut, "rank">;

/** A count's entry: every EVENTS-011 figure null unless given. */
function entry(fields: Partial<EntryFields> & { value: number }): EntryFields {
  return {
    team: null,
    player: null,
    season: null,
    game: null,
    wins: null,
    losses: null,
    made: null,
    attempted: null,
    pct: null,
    ...fields,
  };
}

/** Three places, as `service._pct` rounds. */
function pct(made: number, attempted: number): number | null {
  return attempted === 0 ? null : Math.round((made / attempted) * 1000) / 1000;
}

/** A `win_loss` entry: `value` stays the win percentage. */
export function seasonEntry(
  wins: number,
  losses: number,
  fields: Partial<EntryFields> = {},
): EntryFields {
  const share = pct(wins, wins + losses) ?? 0;
  return entry({ value: share, wins, losses, pct: share, ...fields });
}

/** A `made_total` entry: `value` is the made count. */
export function madeEntry(
  made: number,
  attempted: number,
  fields: Partial<EntryFields> = {},
): EntryFields {
  return entry({
    value: made,
    made,
    attempted,
    pct: pct(made, attempted),
    ...fields,
  });
}

/**
 * A `shot_pct` entry (`EVENTS-012`): `value` and `pct` are the fraction,
 * three places, beside the made and attempted counts.
 */
export function shotEntry(
  made: number,
  attempted: number,
  fields: Partial<EntryFields> = {},
): EntryFields {
  const share = pct(made, attempted) ?? 0;
  return entry({ value: share, made, attempted, pct: share, ...fields });
}

/** An `average` entry: `value` is the mean, one place, with no figure beside it. */
export function averageEntry(
  value: number,
  fields: Partial<EntryFields> = {},
): EntryFields {
  return entry({ value, ...fields });
}

/** Competition ranks (1, 1, 3) for entries already in the list's order. */
function ranked(entries: EntryFields[]): RecordEntryOut[] {
  return entries.map((fields) => {
    const first = entries.findIndex((other) => other.value === fields.value);
    return { rank: first + 1, ...fields };
  });
}

/** The 100 entries of `player-points-game`: 83, then 81 down in pairs. */
function pointsGameEntries(): EntryFields[] {
  const teams = [ref(CELTICS), ref(NUGGETS), ref(SUNS), ref(NETS), HEAT];
  const rest = Array.from({ length: 99 }, (_, index) => {
    const date = new Date(Date.UTC(2025, 0, 30) - index * 7 * 86_400_000);
    return entry({
      value: 81 - Math.floor(index / 2),
      player: player(5000 + index, "Test", `Scorer ${index + 1}`),
      team: teams[index % teams.length],
      season: "2024-25",
      game: game(9400 + index, date.toISOString().slice(0, 19), "TOR"),
    });
  });
  return [
    entry({
      value: 83,
      player: ADEBAYO,
      team: HEAT,
      season: "2025-26",
      game: ADEBAYO_GAME,
    }),
    ...rest,
  ];
}

/**
 * Every list's entries, in the list's order. `team-best-season`'s 2nd and
 * 3rd show the same three places but rank apart, as the API ranks them.
 */
function entriesOf(id: string): RecordEntryOut[] {
  switch (id) {
    case "team-championships":
      return ranked([
        entry({ value: 4, team: ref(CELTICS) }),
        entry({ value: 4, team: WARRIORS }),
        entry({ value: 1, team: ref(NUGGETS) }),
      ]);
    case "team-best-season":
      return [
        {
          rank: 1,
          ...seasonEntry(73, 9, { team: WARRIORS, season: "2015-16" }),
        },
        {
          rank: 2,
          ...seasonEntry(69, 13, { team: ref(CELTICS), season: "2023-24" }),
        },
        {
          rank: 3,
          ...seasonEntry(53, 10, { team: ref(NUGGETS), season: "2008-09" }),
        },
        {
          rank: 4,
          ...seasonEntry(67, 15, { team: ref(SUNS), season: "2006-07" }),
        },
      ];
    case "team-worst-season":
      return ranked([
        seasonEntry(7, 59, { team: BOBCATS, season: "2011-12" }),
        seasonEntry(12, 70, { team: ref(NETS), season: "2009-10" }),
        seasonEntry(15, 67, { team: ref(RAPTORS), season: "2010-11" }),
      ]);
    case "team-most-points-game":
      return ranked([
        entry({
          value: 168,
          team: ref(NUGGETS),
          season: "2023-24",
          game: NUGGETS_GAME,
        }),
        entry({
          value: 157,
          team: ref(SUNS),
          season: "2023-24",
          game: game(9202, "2024-01-20T22:00:00", "DEN"),
        }),
      ]);
    case "team-largest-win":
      return [];
    case "player-championships":
      return ranked([
        entry({ value: 4, player: LEBRON }),
        entry({ value: 3, player: RONDO }),
      ]);
    case "player-points-game":
      return ranked(pointsGameEntries());
    case "player-rebounds-game":
      return ranked([
        entry({
          value: 31,
          player: JOKIC,
          team: ref(NUGGETS),
          season: "2023-24",
          game: game(9501, "2024-03-01T21:00:00", "BKN"),
        }),
      ]);
    case "player-assists-game":
      return ranked([
        entry({
          value: 25,
          player: RONDO,
          team: ref(CELTICS),
          season: "2009-10",
          game: game(9601, "2009-10-29T19:30:00", "NYK"),
        }),
        entry({
          value: 25,
          player: HALIBURTON,
          team: ref(RAPTORS),
          season: "2023-24",
          game: game(9602, "2023-12-05T19:00:00", "BOS"),
        }),
        entry({
          value: 25,
          player: HARDEN,
          team: ref(SUNS),
          season: "2024-25",
          game: game(9603, "2025-02-10T21:00:00", "DAL"),
        }),
      ]);
    case "player-threes-game":
      return ranked([
        madeEntry(14, 24, {
          player: THOMPSON,
          team: WARRIORS,
          season: "2018-19",
          game: game(9701, "2018-10-29T22:30:00", "CHI"),
        }),
        madeEntry(12, 21, {
          player: CURRY,
          team: WARRIORS,
          season: "2015-16",
          game: game(9702, "2016-02-27T20:30:00", "OKC"),
        }),
      ]);
    case "player-career-points":
      return ranked([
        entry({ value: 42_184, player: LEBRON }),
        entry({ value: 31_419, player: HARDEN }),
      ]);
    case "player-career-triple-doubles":
      return ranked([
        entry({ value: 203, player: WESTBROOK }),
        entry({ value: 164, player: JOKIC }),
      ]);
    // FRONTEND-030: the library records the screens' tests read.
    case "player-threes-season":
      return ranked([
        madeEntry(402, 886, {
          player: CURRY,
          team: WARRIORS,
          season: "2015-16",
        }),
        madeEntry(337, 762, {
          player: HARDEN,
          team: ref(SUNS),
          season: "2018-19",
        }),
      ]);
    case "player-three-pct-season":
      return ranked([
        shotEntry(402, 886, {
          player: CURRY,
          team: WARRIORS,
          season: "2015-16",
        }),
        shotEntry(250, 563, {
          player: THOMPSON,
          team: WARRIORS,
          season: "2015-16",
        }),
      ]);
    case "player-ppg-season":
      return ranked([
        averageEntry(31, {
          player: HARDEN,
          team: ref(SUNS),
          season: "2018-19",
        }),
        averageEntry(30.4, {
          player: LEBRON,
          team: HEAT,
          season: "2008-09",
        }),
      ]);
    case "team-longest-win-streak":
      return ranked([
        entry({ value: 27, team: HEAT, season: "2012-13" }),
        entry({ value: 24, team: WARRIORS, season: "2015-16" }),
      ]);
    default:
      // Every other library record: an empty list, so nothing qualifies.
      recordDefinition(id);
      return [];
  }
}

// ---------------------------------------------------- the two answers

/** `GET /events/records/{record_id}` for a known id. */
export function testRecordList(
  id: string,
  overrides: Partial<RecordListOut> = {},
): RecordListOut {
  const definition = recordDefinition(id);
  const entries = entriesOf(id);
  return {
    ...definition,
    since_season: SINCE_SEASON,
    through_season: THROUGH_SEASON,
    total: entries.length,
    entries,
    ...overrides,
  };
}

/**
 * A record's holder: its list's first entry, how many share its value, and
 * `top`, the list's first three entries (EVENTS-016).
 */
export function holderOf(id: string): RecordHolderOut | null {
  const entries = entriesOf(id);
  if (entries.length === 0) return null;
  const [first] = entries;
  return {
    ...first,
    tied_count: entries.filter((e) => e.value === first.value).length,
    top: entries.slice(0, 3),
  };
}

/** `GET /events/records`: every record with its holder, and the window. */
export function testRecordsSummary(
  overrides: Partial<RecordsSummaryOut> = {},
): RecordsSummaryOut {
  return {
    since_season: SINCE_SEASON,
    through_season: THROUGH_SEASON,
    records: RECORD_DEFINITIONS.map((definition) => ({
      ...definition,
      holder: holderOf(definition.id),
    })),
    ...overrides,
  };
}

/** An empty database: no window, and every holder null. */
export function emptyRecordsSummary(): RecordsSummaryOut {
  return testRecordsSummary({
    since_season: null,
    through_season: null,
    records: RECORD_DEFINITIONS.map((definition) => ({
      ...definition,
      holder: null,
    })),
  });
}

// ------------------------------------------------- the two reads (EVENTS-012)

/** `GET /events/records` for the screen's data: every record, no holder. */
export function testRecordCatalog(
  summary: RecordsSummaryOut = testRecordsSummary(),
): RecordCatalogOut {
  return {
    since_season: summary.since_season,
    through_season: summary.through_season,
    records: summary.records.map((record) => {
      const { holder, ...catalog } = record;
      void holder;
      return catalog;
    }),
  };
}

/** `GET /events/records/holders` for `ids`, from the screen's data. */
export function testRecordHolders(
  ids: readonly string[],
  summary: RecordsSummaryOut = testRecordsSummary(),
): RecordHoldersOut {
  return {
    holders: Object.fromEntries(
      ids.map((id) => [
        id,
        summary.records.find((record) => record.id === id)?.holder ?? null,
      ]),
    ),
  };
}

/** The ids a holders request asked for, in the order it sent them. */
export function idsOf(query: URLSearchParams): string[] {
  const raw = query.get("ids");
  return raw === null || raw === "" ? [] : raw.split(",");
}

// ---------------------------------------------------------------- stubs

/** `GET /events/records` → the catalog of `summary`. */
export function recordsSummaryStub(
  summary: RecordsSummaryOut = testRecordsSummary(),
): Stub {
  return stub("*/events/records", () => testRecordCatalog(summary));
}

/**
 * `GET /events/records/holders?ids=` → the holders of `summary`, or a 422
 * for no ids, more than 24, a duplicate or an id `summary` does not hold.
 * Install it before `recordListStub`, whose `:record_id` also matches
 * `holders` (msw answers with the first handler that matches).
 */
export function recordHoldersStub(
  summary: RecordsSummaryOut = testRecordsSummary(),
): Stub {
  const requests: RecordedRequest[] = [];
  let failing = false;
  return {
    handler: http.get("*/events/records/holders", ({ request }) => {
      const query = new URL(request.url).searchParams;
      requests.push({ path: {}, query });
      if (failing)
        return HttpResponse.json(
          { detail: "Internal Server Error" },
          { status: 500 },
        );
      const ids = idsOf(query);
      const known = new Set(summary.records.map((record) => record.id));
      if (
        ids.length === 0 ||
        ids.length > HOLDERS_CAP ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !known.has(id))
      )
        return HttpResponse.json(
          { detail: "ids must be 1 to 24 distinct known record ids" },
          { status: 422 },
        );
      return HttpResponse.json(testRecordHolders(ids, summary));
    }),
    requests,
    fail(): void {
      failing = true;
    },
  };
}

/**
 * `GET /events/records/{record_id}` → `answer(id)`; `null` is the API's 404
 * for an unknown id. By default every registry id answers `testRecordList`,
 * whatever `limit` asks (no list holds more than 100).
 */
export function recordListStub(
  answer: (id: string) => RecordListOut | null = (id) =>
    RECORD_DEFINITIONS.some((record) => record.id === id)
      ? testRecordList(id)
      : null,
): Stub {
  return stub("*/events/records/:record_id", ({ path }) =>
    answer(path.record_id),
  );
}

/** The records reads answered quietly, for the shell's sweeps (`arrangeVisitor`). */
export function recordsDefaults(): RequestHandler[] {
  return [
    recordsSummaryStub().handler,
    recordHoldersStub().handler,
    recordListStub().handler,
  ];
}
