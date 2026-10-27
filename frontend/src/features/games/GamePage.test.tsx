/**
 * FRONTEND-008 — the game page at `/games/:gameId`: acceptance criteria 1–8
 * and 12 (the half jsdom can show).
 *
 * Every test renders the **whole app through the real route table**
 * (`renderAppAt`), so "a public route under AppLayout" is proven by the route
 * resolving for an anonymous visitor with the primary navigation around it,
 * and nothing here imports the page component: its props are the
 * implementation's to choose. The detail comes from msw
 * (`src/test/games.ts`), never a mocked client.
 *
 * What is pinned is behaviour, through roles, accessible names and table
 * semantics (`<table>`, `<caption>`, `th scope="col"`, `th scope="row"`), not
 * class names or nesting:
 *
 * - **Heading**: one `h1` naming the away team, then "at" (or "@"), then the
 *   home team, by full name, with both final scores in it.
 * - **Date as stored**: the naive US-Eastern timestamp is shown on its own
 *   calendar date. Two fixtures, 22:30 and 00:30, so a conversion in either
 *   direction moves one of them to the 16th or the 14th whatever zone the
 *   test process runs in. Any common date spelling passes (`15 Jan 2024`,
 *   `January 15, 2024`, `2024-01-15`…).
 * - **Winner**: some element whose text (or an icon's accessible name) says
 *   win/winner/won names the winning team and not the losing one — and no
 *   such element names the loser. Checked with the home side winning and with
 *   the away side winning, so marking a fixed side fails.
 * - **Line score**: the table whose column headers start at `Q1`; from `Q1`
 *   on the headers are the periods then one total header (T, Tot, Total,
 *   Final or PTS), last. Each team's row is its first cell (naming the team by
 *   name or abbreviation), its figures, then its final score.
 * - **Box score**: the tables with a `Player` column header, one per team,
 *   each `<caption>` naming its team. The header row is exactly the eighteen
 *   columns of the criterion, every one `th scope="col"`; every player's first
 *   cell is a `th scope="row"` holding their name; rows in API order; the
 *   last row is the totals (first cell "Total" or "Totals"). Made-attempted
 *   cells accept a hyphen or an en dash between the figures.
 * - **DNP**: each did-not-play player is listed outside every table, after
 *   their own team's table, with their reason or "Did not play".
 * - **Scroll container**: each box-score table sits in a named
 *   `role="region"` (a labelled `<section>` is one) with `tabIndex` 0 that
 *   holds no other box-score table, and Tab reaches it. Its `overflow-x` is
 *   the static test's (`games-css.test.ts`); the 360 px layout is the
 *   browser checklist's.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderAppAt, type Visitor } from "../../test/app-route";
import {
  AWAY_DID_NOT_PLAY,
  AWAY_PLAYERS,
  HOME_DID_NOT_PLAY,
  HOME_PLAYERS,
  TEST_AWAY_TEAM,
  TEST_HOME_TEAM,
  emptyBoxScore,
  gameDetailFails,
  gameDetailStub,
  testGameDetail,
  type GameDetailOut,
  type TeamRefOut,
} from "../../test/games";
import { server } from "../../test/server";

const EN_DASH = String.fromCodePoint(0x2013);

const BOX_SCORE_COLUMNS = [
  "Player",
  "MIN",
  "FG",
  "3P",
  "FT",
  "FG%",
  "3P%",
  "FT%",
  "OREB",
  "DREB",
  "REB",
  "AST",
  "STL",
  "BLK",
  "TO",
  "PF",
  "+/-",
  "PTS",
] as const;

type Column = (typeof BOX_SCORE_COLUMNS)[number];

const TOTAL_HEADER = /^(t|tot|total|final|pts)$/i;

function norm(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * An element's text with a space between text nodes: `textContent` would glue
 * "117" in one element to "Winner" or "15 Jan" in the next.
 */
function spacedText(element: Element): string {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    parts.push(node.textContent ?? "");
  }
  return norm(parts.join(" "));
}

/** `n` as a whole number, not part of a longer one. */
function figure(n: number): RegExp {
  return new RegExp(`(?<!\\d)${n}(?!\\d)`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fullName(player: {
  first_name: string | null;
  last_name: string | null;
}): string {
  return [player.first_name, player.last_name]
    .filter((part): part is string => part !== null)
    .join(" ");
}

function main(): HTMLElement {
  return screen.getByRole("main");
}

/** Render the app at the game's page and wait for its heading. */
async function openGame(
  game: GameDetailOut = testGameDetail(),
  as: Visitor = "anonymous",
) {
  const stub = gameDetailStub([game]);
  server.use(stub.handler);
  renderAppAt(`/games/${game.id}`, as);
  const heading = await screen.findByRole("heading", {
    level: 1,
    name: new RegExp(escapeRegExp(game.home_team.name)),
  });
  return { stub, heading };
}

/** Text plus the accessible names of icons (aria-label, alt, title). */
function accessibleText(element: Element): string {
  const parts: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? "");
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.getAttribute("aria-hidden") === "true") return;
    for (const attribute of ["aria-label", "alt", "title"]) {
      const value = node.getAttribute(attribute);
      if (value) parts.push(` ${value} `);
    }
    node.childNodes.forEach(walk);
  };
  walk(element);
  return norm(parts.join(" "));
}

function names(team: TeamRefOut, text: string): boolean {
  return (
    text.includes(team.name) ||
    new RegExp(`\\b${escapeRegExp(team.abbreviation)}\\b`).test(text)
  );
}

const WIN = /\bwin(ner|s)?\b|\bwon\b|\bvictor(y|ious)?\b/i;

/** Elements whose accessible text marks a win and names `team` but not `other`. */
function winMarksFor(team: TeamRefOut, other: TeamRefOut): Element[] {
  return Array.from(main().querySelectorAll("*")).filter((element) => {
    const text = accessibleText(element);
    return WIN.test(text) && names(team, text) && !names(other, text);
  });
}

function tables(): HTMLTableElement[] {
  return within(main()).queryAllByRole("table") as HTMLTableElement[];
}

function headerTexts(table: HTMLTableElement): string[] {
  return within(table)
    .queryAllByRole("columnheader")
    .map((header) => norm(header.textContent));
}

function lineScoreTable(): HTMLTableElement | undefined {
  return tables().find((table) => headerTexts(table).includes("Q1"));
}

function cellTexts(row: HTMLTableRowElement): string[] {
  return Array.from(row.cells).map((cell) => norm(cell.textContent));
}

/** The line-score row whose first cell names `team`. */
function lineScoreRow(table: HTMLTableElement, team: TeamRefOut): string[] {
  const rows = Array.from(table.rows)
    .map(cellTexts)
    .filter((cells) => !cells.includes("Q1"))
    .filter((cells) => names(team, cells[0] ?? ""));
  expect(rows, `one line-score row for ${team.name}`).toHaveLength(1);
  return rows[0];
}

function boxScoreTables(): HTMLTableElement[] {
  return tables().filter((table) => headerTexts(table).includes("Player"));
}

function boxScoreFor(team: TeamRefOut): HTMLTableElement {
  const found = boxScoreTables().filter((table) =>
    norm(table.caption?.textContent).includes(team.name),
  );
  expect(found, `one box-score table captioned ${team.name}`).toHaveLength(1);
  return found[0];
}

function playerRow(table: HTMLTableElement, name: string): HTMLTableRowElement {
  const rows = Array.from(table.rows).filter((row) =>
    norm(row.cells[0]?.textContent).includes(name),
  );
  expect(rows, `one row for ${name}`).toHaveLength(1);
  return rows[0];
}

/** A player row's cells, keyed by the criterion's column names. */
function cellsByColumn(row: HTMLTableRowElement): Record<Column, string> {
  const texts = cellTexts(row);
  expect(texts).toHaveLength(BOX_SCORE_COLUMNS.length);
  return Object.fromEntries(
    BOX_SCORE_COLUMNS.map((column, index) => [column, texts[index]]),
  ) as Record<Column, string>;
}

function madeAttempted(made: number, attempted: number): RegExp {
  return new RegExp(`^${made}\\s*[-${EN_DASH}]\\s*${attempted}$`);
}

/** The deepest element whose text contains every part. */
function smallestContaining(root: Element, parts: string[]): Element {
  const candidates = Array.from(root.querySelectorAll("*")).filter((element) =>
    parts.every((part) => (element.textContent ?? "").includes(part)),
  );
  if (candidates.length === 0)
    throw new Error(`nothing contains ${JSON.stringify(parts)}`);
  return candidates.reduce((deepest, candidate) =>
    deepest.contains(candidate) ? candidate : deepest,
  );
}

/** The last box-score table before `element` in document order. */
function precedingBoxScore(element: Element): HTMLTableElement | undefined {
  return boxScoreTables()
    .filter(
      (table) =>
        !table.contains(element) &&
        Boolean(
          table.compareDocumentPosition(element) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
    )
    .pop();
}

/** The innermost named region that holds `table`. */
function scrollRegionFor(table: HTMLTableElement): HTMLElement | undefined {
  return within(main())
    .queryAllByRole("region", { name: /\S/ })
    .filter((region) => region.contains(table))
    .reduce<HTMLElement | undefined>(
      (inner, region) =>
        inner === undefined || inner.contains(region) ? region : inner,
      undefined,
    );
}

const STORED_DATE =
  /\b15 Jan(uary)?,? 2024\b|\bJan(uary)? 15,? 2024\b|\b2024-01-15\b|\b15\/01\/2024\b|\b01\/15\/2024\b/;
const SHIFTED_DATE =
  /\b1[46] Jan(uary)?,? 2024\b|\bJan(uary)? 1[46],? 2024\b|\b2024-01-1[46]\b/;

describe("/games/:gameId is a public route under AppLayout", () => {
  it.each(["anonymous", "member"] as const)(
    "renders the game for an %s visitor, inside the app shell",
    async (as) => {
      const { stub } = await openGame(testGameDetail(), as);

      expect(
        screen.getByRole("navigation", { name: "Primary" }),
      ).toBeInTheDocument();
      expect(stub.requests).toEqual([501]);
      expect(
        screen.queryByRole("heading", { name: /^sign\s*-?\s*in$/i }),
      ).toBeNull();
    },
  );

  it("fetches the id in the path, not a fixed one", async () => {
    const other = testGameDetail({
      id: 777,
      home_team: { id: 3, name: "Miami Heat", abbreviation: "MIA" },
      away_team: { id: 4, name: "Boston Celtics", abbreviation: "BOS" },
      home_score: 98,
      away_score: 104,
      home_line_score: [20, 25, 28, 25],
      away_line_score: [26, 24, 30, 24],
    });
    const stub = gameDetailStub([testGameDetail(), other]);
    server.use(stub.handler);
    renderAppAt("/games/777", "anonymous");

    expect(
      await screen.findByRole("heading", { level: 1, name: /Miami Heat/ }),
    ).toBeInTheDocument();
    expect(stub.requests).toEqual([777]);
    expect(screen.queryByText(/Toronto Raptors/)).toBeNull();
  });
});

describe("the heading, date, label and venue", () => {
  it("is one level-one heading: away at home, by name, with the final score", async () => {
    const { heading } = await openGame();
    const name = spacedText(heading);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(name).toContain(TEST_AWAY_TEAM.name);
    expect(name).toContain(TEST_HOME_TEAM.name);
    expect(name.indexOf(TEST_AWAY_TEAM.name)).toBeLessThan(
      name.indexOf(TEST_HOME_TEAM.name),
    );
    const between = name.slice(
      name.indexOf(TEST_AWAY_TEAM.name) + TEST_AWAY_TEAM.name.length,
      name.indexOf(TEST_HOME_TEAM.name),
    );
    expect(between).toMatch(/\bat\b|@/);
    expect(name).toMatch(figure(109));
    expect(name).toMatch(figure(117));
  });

  it.each(["2024-01-15T22:30:00", "2024-01-15T00:30:00"])(
    "shows %s on its stored date, without converting the time zone",
    async (date) => {
      await openGame(testGameDetail({ date }));
      const text = spacedText(main());

      expect(text).toMatch(STORED_DATE);
      expect(text).not.toMatch(SHIFTED_DATE);
    },
  );

  it("shows the label, the sub-label and the venue when present", async () => {
    await openGame(
      testGameDetail({
        game_type: "playoffs",
        label: "NBA Finals",
        sub_label: "Game 5",
        series_game_number: 5,
        venue: "Scotiabank Arena",
      }),
    );
    const text = spacedText(main());

    expect(text).toContain("NBA Finals");
    expect(text).toContain("Game 5");
    expect(text).toContain("Scotiabank Arena");
  });

  it("shows no label, sub-label or venue, and no null or undefined, when they are null", async () => {
    await openGame();
    const text = spacedText(main());

    expect(text).not.toMatch(/\bnull\b|\bundefined\b|\bNaN\b/);
    expect(text).not.toContain("NBA Finals");
    expect(text).not.toContain("Arena");
  });
});

describe("the winner is marked in words or a named icon, not colour alone", () => {
  it("marks the home team when it won", async () => {
    await openGame();

    expect(winMarksFor(TEST_HOME_TEAM, TEST_AWAY_TEAM)).not.toEqual([]);
    expect(winMarksFor(TEST_AWAY_TEAM, TEST_HOME_TEAM)).toEqual([]);
  });

  it("marks the away team when it won", async () => {
    await openGame(
      testGameDetail({
        home_score: 101,
        away_score: 112,
        home_line_score: [25, 25, 26, 25],
        away_line_score: [28, 30, 27, 27],
      }),
    );

    expect(winMarksFor(TEST_AWAY_TEAM, TEST_HOME_TEAM)).not.toEqual([]);
    expect(winMarksFor(TEST_HOME_TEAM, TEST_AWAY_TEAM)).toEqual([]);
  });
});

describe("the line score", () => {
  it("is a captioned table: Q1-Q4 then the total, a row per team", async () => {
    await openGame();
    const table = lineScoreTable();

    expect(table, "no table headed Q1").toBeDefined();
    if (table === undefined) return;
    expect(norm(table.caption?.textContent)).not.toBe("");
    const headers = headerTexts(table);
    const periods = headers.slice(headers.indexOf("Q1"));
    expect(periods.slice(0, -1)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(periods[periods.length - 1]).toMatch(TOTAL_HEADER);

    expect(lineScoreRow(table, TEST_HOME_TEAM).slice(1)).toEqual([
      "30",
      "28",
      "31",
      "28",
      "117",
    ]);
    expect(lineScoreRow(table, TEST_AWAY_TEAM).slice(1)).toEqual([
      "25",
      "27",
      "30",
      "27",
      "109",
    ]);
  });

  it("heads a fifth figure OT", async () => {
    await openGame(
      testGameDetail({
        home_score: 119,
        away_score: 116,
        home_line_score: [30, 28, 25, 27, 9],
        away_line_score: [25, 27, 30, 28, 6],
      }),
    );
    const table = lineScoreTable();
    if (table === undefined) throw new Error("no line score table");
    const headers = headerTexts(table);

    expect(headers.slice(headers.indexOf("Q1"), -1)).toEqual([
      "Q1",
      "Q2",
      "Q3",
      "Q4",
      "OT",
    ]);
    expect(lineScoreRow(table, TEST_HOME_TEAM).slice(1)).toEqual([
      "30",
      "28",
      "25",
      "27",
      "9",
      "119",
    ]);
  });

  it("heads a triple-overtime game's figures OT, 2OT and 3OT+, unsplit and unpadded", async () => {
    await openGame(
      testGameDetail({
        home_score: 138,
        away_score: 135,
        home_line_score: [28, 30, 25, 22, 10, 8, 15],
        away_line_score: [30, 25, 27, 23, 10, 8, 12],
      }),
    );
    const table = lineScoreTable();
    if (table === undefined) throw new Error("no line score table");
    const headers = headerTexts(table);
    const periods = headers.slice(headers.indexOf("Q1"));

    expect(periods.slice(0, -1)).toEqual([
      "Q1",
      "Q2",
      "Q3",
      "Q4",
      "OT",
      "2OT",
      "3OT+",
    ]);
    expect(periods[periods.length - 1]).toMatch(TOTAL_HEADER);
    expect(lineScoreRow(table, TEST_AWAY_TEAM).slice(1)).toEqual([
      "30",
      "25",
      "27",
      "23",
      "10",
      "8",
      "12",
      "135",
    ]);
    expect(lineScoreRow(table, TEST_HOME_TEAM).slice(1)).toEqual([
      "28",
      "30",
      "25",
      "22",
      "10",
      "8",
      "15",
      "138",
    ]);
  });

  it.each([
    ["home", { home_line_score: null }],
    ["away", { away_line_score: null }],
    ["both", { home_line_score: null, away_line_score: null }],
  ] as const)(
    "is absent when the %s line score is null, and nothing else changes",
    async (_side, overrides) => {
      await openGame(testGameDetail(overrides));

      expect(lineScoreTable()).toBeUndefined();
      expect(within(main()).queryByText("Q1")).toBeNull();
      expect(boxScoreTables()).toHaveLength(2);
      boxScoreFor(TEST_HOME_TEAM);
      boxScoreFor(TEST_AWAY_TEAM);
    },
  );
});

describe("each team's box score", () => {
  it.each([
    [TEST_HOME_TEAM.name, TEST_HOME_TEAM],
    [TEST_AWAY_TEAM.name, TEST_AWAY_TEAM],
  ] as const)(
    "%s: a table captioned with the team, every column th scope=col, in order",
    async (_name, team) => {
      await openGame();
      const table = boxScoreFor(team);

      const headers = within(table).getAllByRole("columnheader");
      expect(headers.map((header) => norm(header.textContent))).toEqual([
        ...BOX_SCORE_COLUMNS,
      ]);
      for (const header of headers) {
        expect(header.tagName).toBe("TH");
        expect(header.getAttribute("scope")).toBe("col");
      }
    },
  );

  it("is one table per team", async () => {
    await openGame();

    expect(boxScoreTables()).toHaveLength(2);
  });

  it.each([
    [TEST_HOME_TEAM.name, TEST_HOME_TEAM, HOME_PLAYERS],
    [TEST_AWAY_TEAM.name, TEST_AWAY_TEAM, AWAY_PLAYERS],
  ] as const)(
    "%s: names each player in a th scope=row, starters then bench, in API order",
    async (_name, team, players) => {
      await openGame();
      const table = boxScoreFor(team);
      const expected = players.map(fullName);

      const shown = Array.from(table.rows)
        .map((row) => row.cells[0])
        .filter((cell): cell is HTMLTableCellElement => cell !== undefined)
        .map((cell) => norm(cell.textContent))
        .map((text) => expected.find((name) => text.includes(name)))
        .filter((name): name is string => name !== undefined);
      expect(shown).toEqual(expected);

      for (const name of expected) {
        const cell = playerRow(table, name).cells[0];
        expect(cell.tagName).toBe("TH");
        expect(cell.getAttribute("scope")).toBe("row");
      }
    },
  );

  it("shows a player's line in nba.com formats", async () => {
    await openGame();
    const cells = cellsByColumn(
      playerRow(boxScoreFor(TEST_HOME_TEAM), "Scottie Barnes"),
    );

    expect(cells.MIN).toBe("27:04");
    expect(cells.FG).toMatch(madeAttempted(8, 13));
    expect(cells["3P"]).toMatch(madeAttempted(2, 5));
    expect(cells.FT).toMatch(madeAttempted(4, 4));
    expect(cells["FG%"]).toBe(".615");
    expect(cells["3P%"]).toBe(".400");
    expect(cells["FT%"]).toBe("1.000");
    expect(cells.OREB).toBe("1");
    expect(cells.DREB).toBe("6");
    expect(cells.REB).toBe("7");
    expect(cells.AST).toBe("5");
    expect(cells.STL).toBe("1");
    expect(cells.BLK).toBe("0");
    expect(cells.TO).toBe("2");
    expect(cells.PF).toBe("3");
    expect(cells["+/-"]).toBe("+12");
    expect(cells.PTS).toBe("22");
  });

  it("shows a null percentage as an en dash, and a negative plus-minus signed", async () => {
    await openGame();
    const cells = cellsByColumn(
      playerRow(boxScoreFor(TEST_HOME_TEAM), "Gradey Dick"),
    );

    expect(cells.MIN).toBe("4:05");
    expect(cells.FG).toMatch(madeAttempted(0, 0));
    expect(cells["FG%"]).toBe(EN_DASH);
    expect(cells["3P%"]).toBe(EN_DASH);
    expect(cells["FT%"]).toBe(EN_DASH);
    expect(cells["+/-"]).toMatch(/^[-−]3$/);
    expect(cells.PTS).toBe("0");
  });

  it("shows a zero plus-minus as 0 and under a minute as 0:ss", async () => {
    await openGame();
    const cells = cellsByColumn(
      playerRow(boxScoreFor(TEST_HOME_TEAM), "Chris Boucher"),
    );

    expect(cells.MIN).toBe("0:59");
    expect(cells["FG%"]).toBe("1.000");
    expect(cells["+/-"]).toBe("0");
  });

  it("formats the away side the same way", async () => {
    await openGame();
    const cells = cellsByColumn(
      playerRow(boxScoreFor(TEST_AWAY_TEAM), "Devin Booker"),
    );

    expect(cells.MIN).toBe("40:00");
    expect(cells["3P%"]).toBe(".333");
    expect(cells["FT%"]).toBe(".833");
    expect(cells["+/-"]).toMatch(/^[-−]6$/);
  });

  it("ends with a totals row from the API's totals", async () => {
    await openGame();
    const table = boxScoreFor(TEST_HOME_TEAM);
    const rows = Array.from(table.rows);
    const totals = cellTexts(rows[rows.length - 1]);

    expect(totals[0]).toMatch(/^totals?$/i);
    // 49: summed from the played rows, deliberately not the final score (117).
    expect(totals[totals.length - 1]).toBe("49");
    expect(totals[BOX_SCORE_COLUMNS.indexOf("FG%")]).toBe(".563");
  });
});

describe("players who did not play", () => {
  it.each([
    [TEST_HOME_TEAM.name, TEST_HOME_TEAM, HOME_DID_NOT_PLAY],
    [TEST_AWAY_TEAM.name, TEST_AWAY_TEAM, AWAY_DID_NOT_PLAY],
  ] as const)(
    "%s: listed under its own table, with the reason or 'Did not play'",
    async (_name, team, didNotPlay) => {
      await openGame();
      const [withReason, withoutReason] = didNotPlay;
      const reason = withReason.dnp_reason ?? "";

      const reasoned = smallestContaining(main(), [
        fullName(withReason),
        reason,
      ]);
      const unreasoned = smallestContaining(main(), [
        fullName(withoutReason),
        "Did not play",
      ]);

      for (const entry of [reasoned, unreasoned]) {
        expect(entry.closest("table"), "a DNP is not a box-score row").toBe(
          null,
        );
        expect(precedingBoxScore(entry)).toBe(boxScoreFor(team));
      }
      // The null reason's own line says "Did not play", not a heading above
      // the list that also holds the player with a reason.
      expect(unreasoned.textContent).not.toContain(fullName(withReason));
    },
  );
});

describe("a game with no box score", () => {
  it("renders the heading and line score, and says so in place of each table", async () => {
    await openGame(
      testGameDetail({
        home_box_score: emptyBoxScore(),
        away_box_score: emptyBoxScore(),
      }),
    );

    expect(lineScoreTable()).toBeDefined();
    expect(boxScoreTables()).toEqual([]);
    expect(within(main()).getAllByText(/no box score/i)).toHaveLength(2);
  });

  it("says so only for the side that has none", async () => {
    await openGame(testGameDetail({ home_box_score: emptyBoxScore() }));

    expect(boxScoreTables()).toHaveLength(1);
    boxScoreFor(TEST_AWAY_TEAM);
    expect(within(main()).getAllByText(/no box score/i)).toHaveLength(1);
  });
});

describe("an unknown game and a failed request", () => {
  it("renders a not-found message with a link back to the feed on a 404", async () => {
    const stub = gameDetailStub([]);
    server.use(stub.handler);
    renderAppAt("/games/999", "anonymous");

    const feedLink = await within(main()).findByRole("link", {
      name: /feed/i,
    });
    expect(feedLink).toHaveAttribute("href", "/");
    expect(stub.requests).toEqual([999]);
    const text = spacedText(main());
    expect(text).toMatch(/game/i);
    expect(text).toMatch(
      /not\s+(be\s+)?found|could\s*n[o']t\s+find|cannot\s+find|can't\s+find|no\s+(such\s+)?game|does\s*n[o']t\s+exist|does not exist/i,
    );
    expect(within(main()).queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/unexpected application error/i)).toBeNull();
  });

  it("renders an InlineAlert on any other failure, without throwing", async () => {
    server.use(gameDetailFails());
    renderAppAt("/games/501", "anonymous");

    expect(await within(main()).findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/unexpected application error/i)).toBeNull();
    expect(boxScoreTables()).toEqual([]);
  });
});

describe("the box-score scroll containers", () => {
  it("wraps each table in its own named, focusable region", async () => {
    await openGame();

    for (const team of [TEST_HOME_TEAM, TEST_AWAY_TEAM]) {
      const table = boxScoreFor(team);
      const region = scrollRegionFor(table);

      expect(
        region,
        `no named region around ${team.name}'s table`,
      ).toBeDefined();
      if (region === undefined) continue;
      expect(region.tabIndex).toBe(0);
      expect(
        boxScoreTables().filter((other) => region.contains(other)),
      ).toEqual([table]);
    }
  });

  it("is reachable with Tab, as is every link on the page", async () => {
    await openGame();
    const user = userEvent.setup();
    const targets: HTMLElement[] = [
      ...within(main()).queryAllByRole("link"),
      ...[TEST_HOME_TEAM, TEST_AWAY_TEAM]
        .map((team) => scrollRegionFor(boxScoreFor(team)))
        .filter((region): region is HTMLElement => region !== undefined),
    ];
    expect(targets.length).toBeGreaterThanOrEqual(2);

    const reached = new Set<Element>();
    const pending = (): boolean =>
      targets.some((target) => !reached.has(target));
    for (let step = 0; step < 40 && pending(); step += 1) {
      await user.tab();
      if (document.activeElement !== null) reached.add(document.activeElement);
    }

    for (const target of targets) {
      expect(
        reached.has(target),
        `Tab never reached ${target.outerHTML.slice(0, 80)}`,
      ).toBe(true);
    }
  });

  it("shows a visible instruction for the horizontally scrollable columns", async () => {
    await openGame();

    expect(
      within(main()).getAllByText(/scroll horizontally to see all columns/i),
    ).toHaveLength(2);
  });
});
