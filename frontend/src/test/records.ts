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

const SINGLE_GAME =
  "Regular-season and playoff games only (not the play-in or the NBA Cup final)";
const SEASONS =
  "Regular-season games only, in seasons with a champion (a season in progress never holds it)";
const FINALS =
  "Champion: the team that wins four of a season's playoff games labelled NBA Finals," +
  " as GET /events/seasons/{season}/champion decides";

export type RecordDefinition = RecordCatalogRecord;

type BaseDefinition = Omit<
  RecordDefinition,
  "category" | "keywords" | "featured_rank"
>;

/** The catalog fields of the twelve (`EVENTS-012`), by id. */
const CATALOG: Record<
  string,
  Pick<RecordDefinition, "category" | "keywords" | "featured_rank">
> = {
  "team-championships": {
    category: "team-franchise",
    keywords: ["championships", "titles", "rings"],
    featured_rank: 3,
  },
  "team-best-season": {
    category: "team-season",
    keywords: ["best season", "record", "wins"],
    featured_rank: 1,
  },
  "team-worst-season": {
    category: "team-season",
    keywords: ["worst season", "record", "losses"],
    featured_rank: 8,
  },
  "team-most-points-game": {
    category: "team-game",
    keywords: ["points", "scoring", "game"],
    featured_rank: 15,
  },
  "team-largest-win": {
    category: "team-game",
    keywords: ["margin", "blowout", "largest win"],
    featured_rank: 16,
  },
  "player-championships": {
    category: "player-playoffs",
    keywords: ["championships", "titles", "rings"],
    featured_rank: 14,
  },
  "player-points-game": {
    category: "player-game",
    keywords: ["points", "scoring", "game"],
    featured_rank: 2,
  },
  "player-rebounds-game": {
    category: "player-game",
    keywords: ["rebounds", "boards", "game"],
    featured_rank: 9,
  },
  "player-assists-game": {
    category: "player-game",
    keywords: ["assists", "dimes", "game"],
    featured_rank: 10,
  },
  "player-threes-game": {
    category: "player-game",
    keywords: ["threes", "3pt", "3-pointers", "three-pointers"],
    featured_rank: 11,
  },
  "player-career-points": {
    category: "player-career",
    keywords: ["points", "scoring", "career"],
    featured_rank: 4,
  },
  "player-career-triple-doubles": {
    category: "player-career",
    keywords: ["triple-doubles", "career"],
    featured_rank: 13,
  },
};

const BASE_DEFINITIONS: BaseDefinition[] = [
  {
    id: "team-championships",
    group: "team",
    title: "Most championships",
    unit: "titles",
    value_kind: "count",
    rule: `NBA titles won. ${FINALS}.`,
  },
  {
    id: "team-best-season",
    group: "team",
    title: "Best regular season",
    unit: "record",
    value_kind: "win_loss",
    rule: `Highest win percentage in one season, then most wins. ${SEASONS}.`,
  },
  {
    id: "team-worst-season",
    group: "team",
    title: "Worst regular season",
    unit: "record",
    value_kind: "win_loss",
    rule: `Lowest win percentage in one season, then fewest wins. ${SEASONS}.`,
  },
  {
    id: "team-most-points-game",
    group: "team",
    title: "Most points in a game",
    unit: "points",
    value_kind: "count",
    rule: `Points scored by one team in one game. ${SINGLE_GAME}.`,
  },
  {
    id: "team-largest-win",
    group: "team",
    title: "Largest win",
    unit: "points",
    value_kind: "count",
    rule: `Margin of victory in one game. ${SINGLE_GAME}.`,
  },
  {
    id: "player-championships",
    group: "player",
    title: "Most championships",
    unit: "titles",
    value_kind: "count",
    rule:
      "Titles won: seasons with a played line (minutes on the court) for the champion" +
      ` in that season's NBA Finals. ${FINALS}.`,
  },
  {
    id: "player-points-game",
    group: "player",
    title: "Most points in a game",
    unit: "points",
    value_kind: "count",
    rule: `Points by one player in one game. ${SINGLE_GAME}.`,
  },
  {
    id: "player-rebounds-game",
    group: "player",
    title: "Most rebounds in a game",
    unit: "rebounds",
    value_kind: "count",
    rule: `Rebounds by one player in one game. ${SINGLE_GAME}.`,
  },
  {
    id: "player-assists-game",
    group: "player",
    title: "Most assists in a game",
    unit: "assists",
    value_kind: "count",
    rule: `Assists by one player in one game. ${SINGLE_GAME}.`,
  },
  {
    id: "player-threes-game",
    group: "player",
    title: "Most threes in a game",
    unit: "threes",
    value_kind: "made_total",
    rule: `Three-pointers made by one player in one game. ${SINGLE_GAME}.`,
  },
  {
    id: "player-career-points",
    group: "player",
    title: "Most career points",
    unit: "points",
    value_kind: "count",
    rule: "Regular-season points, summed over every played game.",
  },
  {
    id: "player-career-triple-doubles",
    group: "player",
    title: "Most career triple-doubles",
    unit: "triple-doubles",
    value_kind: "count",
    rule:
      "Regular-season games with 10 or more in at least three of points, rebounds," +
      " assists, steals and blocks.",
  },
];

/** `RECORDS`, in the API's order. */
export const RECORD_DEFINITIONS: readonly RecordDefinition[] =
  BASE_DEFINITIONS.map((base) => ({ ...base, ...CATALOG[base.id] }));

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
