import type { RequestHandler } from "msw";

import type { components } from "../api/schema";
import {
  CELTICS,
  NETS,
  NUGGETS,
  RAPTORS,
  SUNS,
  ref,
  stub,
  type Stub,
  type TeamRefOut,
} from "./stats";

/**
 * The records kit (`FRONTEND-019`): fixtures and msw stubs for
 * `GET /events/records` and `GET /events/records/{record_id}` (`EVENTS-010`,
 * [[0x02-events]] "Records"), in `test/stats.ts`'s style: every stub records
 * the path parameters and query string of every request it answered.
 *
 * The twelve records are `app/events/records.py`'s `RECORDS`, in its order
 * (team records, then player records), with its ids, titles, units and rule
 * texts word for word. Each record's list is built here, and the summary's
 * holder is that list's first entry plus `tied_count`, how many entries share
 * its value, so a card and its list always agree.
 *
 * What the lists hold, for the tests that read them:
 *
 * - `team-championships`: ranks 1, 1, 3 (a two-way tie at the top, so its
 *   card says "and 1 other"); a team and a value, no season or game.
 * - `team-best-season`: four seasons, ranks 1, 2, 3, 4 as the API gives them,
 *   the 2nd and 3rd both `.841` (the API ranks the exact fraction).
 * - `team-worst-season`: three seasons, the worst alone.
 * - `team-most-points-game` and the player single-game records: a team, a
 *   season and a game (date and opponent) on every entry.
 * - `team-largest-win`: empty, so its holder is null (nothing qualifies).
 * - `player-points-game`: the full 100 (`total` 100), Adebayo's 83 first.
 * - `player-assists-game`: a three-way tie at the top ("and 2 others").
 * - `player-championships` and the two career records: a player and a value
 *   only (no team, season or game).
 */

export type RecordsSummaryOut = components["schemas"]["RecordsSummaryOut"];
export type RecordSummaryOut = components["schemas"]["RecordSummaryOut"];
export type RecordHolderOut = components["schemas"]["RecordHolderOut"];
export type RecordListOut = components["schemas"]["RecordListOut"];
export type RecordEntryOut = components["schemas"]["RecordEntryOut"];
export type RecordGameOut = components["schemas"]["RecordGameOut"];
export type RecordPlayerOut = components["schemas"]["RecordPlayerOut"];
export type RecordGroup = RecordSummaryOut["group"];

/** The stored data's window, as `GET /events/records` names it. */
export const SINCE_SEASON = "2003-04";
export const THROUGH_SEASON = "2026-27";

// ------------------------------------------------------------ the registry

const SINGLE_GAME =
  "Regular-season and playoff games only (not the play-in or the NBA Cup final)";
const SEASONS =
  "Regular-season games only, in seasons with a champion (a season in progress never holds it)";
const FINALS =
  "Champion: the team that wins four of a season's playoff games labelled NBA Finals," +
  " as GET /events/seasons/{season}/champion decides";

export interface RecordDefinition {
  id: string;
  group: RecordGroup;
  title: string;
  unit: string;
  rule: string;
}

/** `RECORDS`, in the API's order. */
export const RECORD_DEFINITIONS: readonly RecordDefinition[] = [
  {
    id: "team-championships",
    group: "team",
    title: "Most championships",
    unit: "titles",
    rule: `NBA titles won. ${FINALS}.`,
  },
  {
    id: "team-best-season",
    group: "team",
    title: "Best regular season",
    unit: "win %",
    rule: `Highest win percentage in one season, then most wins. ${SEASONS}.`,
  },
  {
    id: "team-worst-season",
    group: "team",
    title: "Worst regular season",
    unit: "win %",
    rule: `Lowest win percentage in one season, then fewest wins. ${SEASONS}.`,
  },
  {
    id: "team-most-points-game",
    group: "team",
    title: "Most points in a game",
    unit: "points",
    rule: `Points scored by one team in one game. ${SINGLE_GAME}.`,
  },
  {
    id: "team-largest-win",
    group: "team",
    title: "Largest win",
    unit: "points",
    rule: `Margin of victory in one game. ${SINGLE_GAME}.`,
  },
  {
    id: "player-championships",
    group: "player",
    title: "Most championships",
    unit: "titles",
    rule:
      "Titles won: seasons with a played line (minutes on the court) for the champion" +
      ` in that season's NBA Finals. ${FINALS}.`,
  },
  {
    id: "player-points-game",
    group: "player",
    title: "Most points in a game",
    unit: "points",
    rule: `Points by one player in one game. ${SINGLE_GAME}.`,
  },
  {
    id: "player-rebounds-game",
    group: "player",
    title: "Most rebounds in a game",
    unit: "rebounds",
    rule: `Rebounds by one player in one game. ${SINGLE_GAME}.`,
  },
  {
    id: "player-assists-game",
    group: "player",
    title: "Most assists in a game",
    unit: "assists",
    rule: `Assists by one player in one game. ${SINGLE_GAME}.`,
  },
  {
    id: "player-threes-game",
    group: "player",
    title: "Most threes in a game",
    unit: "threes",
    rule: `Three-pointers made by one player in one game. ${SINGLE_GAME}.`,
  },
  {
    id: "player-career-points",
    group: "player",
    title: "Most career points",
    unit: "points",
    rule: "Regular-season points, summed over every played game.",
  },
  {
    id: "player-career-triple-doubles",
    group: "player",
    title: "Most career triple-doubles",
    unit: "triple-doubles",
    rule:
      "Regular-season games with 10 or more in at least three of points, rebounds," +
      " assists, steals and blocks.",
  },
];

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

function entry(fields: Partial<EntryFields> & { value: number }): EntryFields {
  return { team: null, player: null, season: null, game: null, ...fields };
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
          ...entry({ value: 0.89, team: WARRIORS, season: "2015-16" }),
        },
        {
          rank: 2,
          ...entry({ value: 0.841, team: ref(CELTICS), season: "2023-24" }),
        },
        {
          rank: 3,
          ...entry({ value: 0.841, team: ref(NUGGETS), season: "2008-09" }),
        },
        {
          rank: 4,
          ...entry({ value: 0.817, team: ref(SUNS), season: "2006-07" }),
        },
      ];
    case "team-worst-season":
      return ranked([
        entry({ value: 0.106, team: BOBCATS, season: "2011-12" }),
        entry({ value: 0.146, team: ref(NETS), season: "2009-10" }),
        entry({ value: 0.183, team: ref(RAPTORS), season: "2010-11" }),
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
        entry({
          value: 14,
          player: THOMPSON,
          team: WARRIORS,
          season: "2018-19",
          game: game(9701, "2018-10-29T22:30:00", "CHI"),
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
    default:
      throw new Error(`no record ${id}`);
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

/** A record's holder: its list's first entry and how many share its value. */
export function holderOf(id: string): RecordHolderOut | null {
  const entries = entriesOf(id);
  if (entries.length === 0) return null;
  const [first] = entries;
  return {
    ...first,
    tied_count: entries.filter((e) => e.value === first.value).length,
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

// ---------------------------------------------------------------- stubs

/** `GET /events/records` → `summary`. */
export function recordsSummaryStub(
  summary: RecordsSummaryOut = testRecordsSummary(),
): Stub {
  return stub("*/events/records", () => summary);
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

/** Both records reads answered quietly, for the shell's sweeps (`arrangeVisitor`). */
export function recordsDefaults(): RequestHandler[] {
  return [recordsSummaryStub().handler, recordListStub().handler];
}
