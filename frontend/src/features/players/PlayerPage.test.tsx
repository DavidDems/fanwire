/**
 * FRONTEND-009 criterion 8 and the player half of 13: the player page at
 * `/players/:playerId`, through the real route table.
 *
 * The interface this file pins:
 *
 * - Public. `GET /events/players/{id}` and `GET /events/players/{id}/games`
 *   for the id in the path, never a fixed one.
 * - **The level-one heading is the player's name** ("LeBron James").
 * - **The attributes**: position, jersey, height in feet and inches from
 *   `height_inches` (81 → `6'9"`, ASCII apostrophe and quote), weight,
 *   birth date, country, school and draft. A null attribute is left out (or
 *   shown as a dash), never printed as "null".
 * - **The career lines**: one table captioned /career/i, a row headed
 *   /regular/i and one headed /playoffs/i, from `career_regular` and
 *   `career_playoffs` (per-game averages to one place).
 * - **The per-season table(s)**: captioned /season/i (and not /career/i or
 *   /game log/i), with columns Season, Team(s), GP, GS, MIN, PTS, REB, AST,
 *   STL, BLK, FG%, 3P% and FT% (the box score's abbreviations; extra columns
 *   such as the game type are allowed). One row per season line, teams in
 *   the API's order, averages to one place and percentages in the game page's
 *   `.540` form.
 * - **The game log**: a region named "Game log" (its `h2`), from
 *   `GET /events/players/{id}/games` from offset 0 in pages of 50 (`limit` 50
 *   or absent), newest first as the API sends it, each game a link to
 *   `/games/<id>`. A full page offers "Load more games"; a did-not-play row
 *   shows its reason (or "Did not play") instead of figures.
 * - **An unknown player** (a 404, or an id that is not a number) renders a
 *   level-one "Player not found" heading.
 * - Every table has a caption, scoped headers and its own scroll region.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderAppAt, type Visitor } from "../../test/app-route";
import {
  dnpGame,
  limitOf,
  offsetOf,
  playerDetailStub,
  playerGame,
  playerGames,
  playerGamesStub,
  sparsePlayerDetail,
  testPlayerDetail,
  type PlayerDetailOut,
  type PlayerGameOut,
} from "../../test/stats";
import {
  bodyRows,
  columnHeaders,
  figure,
  rowText,
  tableCaptioned,
  tableProblems,
  tablesCaptioned,
} from "../../test/tables";

const LEBRON = testPlayerDetail();
const SPARSE = sparsePlayerDetail();

function openPlayer(
  id: number | string = LEBRON.id,
  log: Record<number, PlayerGameOut[]> = {
    [LEBRON.id]: playerGames(3),
    [SPARSE.id]: [],
  },
  players: PlayerDetailOut[] = [LEBRON, SPARSE],
  as: Visitor = "anonymous",
) {
  const detail = playerDetailStub(players);
  const games = playerGamesStub(log);
  const rendered = renderAppAt(`/players/${id}`, as, [
    detail.handler,
    games.handler,
  ]);
  return { detail, games, router: rendered.router };
}

async function heading(name: string): Promise<HTMLElement> {
  return screen.findByRole("heading", { level: 1, name });
}

function main(): HTMLElement {
  return screen.getByRole("main");
}

function seasonTables(): HTMLTableElement[] {
  return tablesCaptioned(main(), /season/i).filter(
    (table) =>
      !/career|game log/i.test(table.querySelector("caption")?.textContent ?? ""),
  );
}

function gameLog(): HTMLElement {
  return screen.getByRole("region", { name: "Game log" });
}

function gameHrefs(root: HTMLElement): string[] {
  return [
    ...new Set(
      within(root)
        .queryAllByRole("link")
        .map((link) => link.getAttribute("href") ?? "")
        .filter((href) => /^\/games\/\d+$/.test(href)),
    ),
  ];
}

describe("the route", () => {
  it.each<Visitor>(["anonymous", "member"])(
    "is public: a %s visitor sees the player's name as the level-one heading",
    async (as) => {
      openPlayer(LEBRON.id, undefined, undefined, as);

      expect(await heading("LeBron James")).toBeVisible();
      expect(
        screen.queryByRole("heading", { name: /^sign\s*-?\s*in$/i }),
      ).toBeNull();
    },
  );

  it("reads the id in the path, not a fixed one", async () => {
    const { detail, games } = openPlayer(SPARSE.id);

    expect(await heading("Test Rookie")).toBeVisible();
    await waitFor(() => expect(games.requests.length).toBeGreaterThan(0));
    expect(detail.requests.map((r) => r.path.player_id)).toEqual([
      String(SPARSE.id),
    ]);
    expect(games.requests.map((r) => r.path.player_id)).toContain(
      String(SPARSE.id),
    );
  });
});

describe("the attributes", () => {
  it("shows the height in feet and inches", async () => {
    openPlayer();
    await heading("LeBron James");

    expect(within(main()).getByText(`6'9"`)).toBeVisible();
  });

  it("shows 72 inches as 6'0\"", async () => {
    openPlayer(SPARSE.id);
    await heading("Test Rookie");

    expect(within(main()).getByText(`6'0"`)).toBeVisible();
  });

  it("shows position, jersey, weight, birth date, country, school and draft", async () => {
    openPlayer();
    await heading("LeBron James");
    const text = rowText(main());

    expect(text).toMatch(/\bF\b/);
    expect(text).toMatch(figure(23));
    expect(text).toMatch(figure(250));
    expect(text).toMatch(/1984/);
    expect(text).toContain("USA");
    expect(text).toContain("St. Vincent-St. Mary HS");
    expect(text).toMatch(figure(2003));
    for (const label of [
      /position/i,
      /jersey/i,
      /height/i,
      /weight/i,
      /born|birth/i,
      /country/i,
      /school|college/i,
      /draft/i,
    ]) {
      expect(text, `no ${label} label`).toMatch(label);
    }
  });

  it("never prints null, undefined or NaN for a player with no attributes", async () => {
    openPlayer(SPARSE.id);
    await heading("Test Rookie");

    expect(main().textContent).not.toMatch(/\bnull\b|\bundefined\b|\bNaN\b/);
  });
});

describe("the career lines", () => {
  it("is one table, a regular-season row and a playoffs row, with their averages", async () => {
    openPlayer();
    await heading("LeBron James");

    const table = tableCaptioned(main(), /career/i);
    const rows = bodyRows(table);
    const regular = rows.find((row) => /regular/i.test(row.cells[0]?.textContent ?? ""));
    const playoffs = rows.find((row) => /playoffs/i.test(row.cells[0]?.textContent ?? ""));
    if (regular === undefined || playoffs === undefined)
      throw new Error("no regular-season or playoffs row");

    expect(regular.cells[0].tagName).toBe("TH");
    expect(regular.cells[0]).toHaveAttribute("scope", "row");
    expect(rowText(regular)).toMatch(/1,?492/);
    expect(rowText(regular)).toMatch(figure("27.1"));
    expect(rowText(regular)).toMatch(figure(".506"));
    expect(rowText(playoffs)).toMatch(figure(287));
    expect(rowText(playoffs)).toMatch(figure("28.4"));
    expect(rowText(playoffs)).toMatch(figure("9.0"));
  });
});

describe("the per-season table", () => {
  const COLUMNS = [
    /^season$/i,
    /^teams?$/i,
    /^GP$/,
    /^GS$/,
    /^MIN$/,
    /^PTS$/,
    /^REB$/,
    /^AST$/,
    /^STL$/,
    /^BLK$/,
    /^FG%$/,
    /^3P%$/,
    /^FT%$/,
  ];

  it("has the season, teams, games, starts, minutes, counting and shooting columns", async () => {
    openPlayer();
    await heading("LeBron James");

    const tables = seasonTables();
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      const headers = columnHeaders(table);
      for (const column of COLUMNS) {
        expect(
          headers.some((header) => column.test(header)),
          `no ${column} column in ${JSON.stringify(headers)}`,
        ).toBe(true);
      }
    }
  });

  it("has one row per season line, regular and playoffs told apart", async () => {
    openPlayer();
    await heading("LeBron James");

    const rows = seasonTables().flatMap(bodyRows);
    expect(rows).toHaveLength(LEBRON.seasons.length);
    const of2023 = rows.filter((row) => rowText(row).includes("2023-24"));
    expect(of2023).toHaveLength(2);
    expect(of2023.some((row) => figure("25.7").test(rowText(row)))).toBe(true);
    expect(of2023.some((row) => figure("27.8").test(rowText(row)))).toBe(true);
  });

  it("shows a season's figures in the game page's formats, teams in the API's order", async () => {
    openPlayer();
    await heading("LeBron James");

    const row = seasonTables()
      .flatMap(bodyRows)
      .find((candidate) => rowText(candidate).includes("2003-04"));
    if (row === undefined) throw new Error("no 2003-04 row");
    const text = rowText(row);

    expect(text.indexOf("MIA")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("CLE")).toBeGreaterThan(text.indexOf("MIA"));
    expect(text).toMatch(figure(79));
    expect(text).toMatch(figure("39.5"));
    expect(text).toMatch(figure("20.9"));
    expect(text).toMatch(figure("5.5"));
    expect(text).toMatch(figure("5.9"));
    expect(text).toMatch(figure("1.6"));
    expect(text).toMatch(figure("0.7"));
    expect(text).toMatch(figure(".417"));
    expect(text).toMatch(figure(".290"));
    expect(text).toMatch(figure(".754"));
    expect(text).not.toMatch(/0\.417/);
  });

  it("renders a player with no seasons without a broken table", async () => {
    openPlayer(SPARSE.id);
    await heading("Test Rookie");

    expect(seasonTables().flatMap(bodyRows)).toHaveLength(0);
    expect(tableProblems(main())).toEqual([]);
  });
});

describe("the game log", () => {
  it("asks for the player's games from offset 0, 50 at a time", async () => {
    const { games } = openPlayer();
    await heading("LeBron James");

    await waitFor(() => expect(games.requests).toHaveLength(1));
    expect(games.requests[0].path.player_id).toBe(String(LEBRON.id));
    expect(offsetOf(games.requests[0].query)).toBe(0);
    expect(limitOf(games.requests[0].query, 50)).toBe(50);
  });

  it("links every game to its page, newest first as the API sends them", async () => {
    const log = playerGames(3);
    openPlayer(LEBRON.id, { [LEBRON.id]: log });
    await heading("LeBron James");

    await waitFor(() => expect(gameHrefs(gameLog())).toHaveLength(3));
    expect(gameHrefs(gameLog())).toEqual(log.map((g) => `/games/${g.game_id}`));
  });

  it("shows a did-not-play row's reason, not figures", async () => {
    const log = [playerGame(0), dnpGame(1, "Rest"), dnpGame(2, null)];
    openPlayer(LEBRON.id, { [LEBRON.id]: log });
    await heading("LeBron James");
    await waitFor(() => expect(gameHrefs(gameLog())).toHaveLength(3));

    const rowFor = (gameId: number) => {
      const link = within(gameLog())
        .getAllByRole("link")
        .find((l) => l.getAttribute("href") === `/games/${gameId}`);
      const row = link?.closest<HTMLElement>("tr, li");
      if (row == null) throw new Error(`game ${gameId} is in no row`);
      return rowText(row);
    };
    expect(rowFor(log[1].game_id)).toContain("Rest");
    expect(rowFor(log[2].game_id)).toMatch(/did not play|dnp/i);
    expect(gameLog().textContent).not.toMatch(/\bnull\b|\bundefined\b|\bNaN\b/);
  });

  it("offers Load more games after a full page, which asks for the next 50", async () => {
    const log = playerGames(52);
    const { games } = openPlayer(LEBRON.id, { [LEBRON.id]: log });
    const user = userEvent.setup();
    await heading("LeBron James");

    const more = await within(await screen.findByRole("region", { name: "Game log" })).findByRole(
      "button",
      { name: "Load more games" },
    );
    expect(gameHrefs(gameLog())).toHaveLength(50);

    await user.click(more);

    await waitFor(() => expect(gameHrefs(gameLog())).toHaveLength(52));
    expect(games.requests.map((r) => offsetOf(r.query))).toEqual([0, 50]);
    expect(
      within(gameLog()).queryByRole("button", { name: "Load more games" }),
    ).toBeNull();
  });

  it("offers no Load more after a short page", async () => {
    openPlayer();
    await heading("LeBron James");
    await waitFor(() => expect(gameHrefs(gameLog())).toHaveLength(3));

    expect(within(gameLog()).queryByRole("button", { name: /load more/i })).toBeNull();
  });

  it("plots the ten most recent played games oldest to newest with exact values and ticks", async () => {
    const log = Array.from({ length: 12 }, (_, index) =>
      playerGame(index, { points: 10 + index }),
    );
    log[2] = dnpGame(2, "Rest");
    openPlayer(LEBRON.id, { [LEBRON.id]: log });
    await heading("LeBron James");

    const chart = await screen.findByRole("img", {
      name: /points.*lebron james/i,
    });
    const table = tableCaptioned(gameLog(), /points/i);
    const headers = columnHeaders(table);
    const pointsIndex = headers.findIndex((header) => /points/i.test(header));
    if (pointsIndex < 0) throw new Error("chart table has no Points column");
    const rows = bodyRows(table);

    expect(rows).toHaveLength(10);
    expect(rows.map((row) => Number(row.cells[pointsIndex].textContent))).toEqual([
      20, 19, 18, 17, 16, 15, 14, 13, 11, 10,
    ]);
    const dates = rows.map((row) => Date.parse(row.cells[0].textContent ?? ""));
    expect(dates.every(Number.isFinite)).toBe(true);
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
    expect(table.querySelector("caption")?.textContent).toMatch(/lebron james/i);
    expect(table.querySelector("caption")?.textContent).toMatch(/last 10/i);
    expect(chart.textContent).toMatch(/(^|\D)0(\D|$)/);
    for (const tick of [5, 10, 15, 20, 25])
      expect(chart.textContent).toContain(String(tick));

    // The chart is an overview; every source row, including the DNP, stays in
    // the existing complete game log.
    expect(bodyRows(tableCaptioned(gameLog(), /games played, newest first/i))).toHaveLength(
      12,
    );
  });

  it("keeps a one-game data table and explains why no line is drawn", async () => {
    openPlayer(LEBRON.id, { [LEBRON.id]: [playerGame(0, { points: 24 })] });
    await heading("LeBron James");

    const table = (await screen.findByRole("table", {
      name: /points/i,
    })) as HTMLTableElement;
    expect(bodyRows(table)).toHaveLength(1);
    expect(rowText(bodyRows(table)[0])).toContain("24");
    expect(gameLog().textContent).toMatch(/not enough|fewer than two|at least two/i);
    expect(screen.queryByRole("img", { name: /points.*lebron james/i })).toBeNull();
  });

  it("keeps the game-log request error as an alert instead of drawing an empty chart", async () => {
    const detail = playerDetailStub([LEBRON]);
    const games = playerGamesStub({ [LEBRON.id]: [] });
    games.fail();
    renderAppAt(`/players/${LEBRON.id}`, "anonymous", [detail.handler, games.handler]);

    const region = await screen.findByRole("region", { name: "Game log" });
    expect(await within(region).findByRole("alert")).toBeVisible();
    expect(within(region).queryByRole("img", { name: /points/i })).toBeNull();
  });

  it("uses the duration token that the global reduced-motion rule zeros", () => {
    const files = [
      "src/features/players/Players.module.css",
      "src/components/stats-nav/StatsNav.module.css",
    ];
    for (const file of files) {
      const css = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(css, file).toMatch(/var\(--duration-fast\)/);
    }
  });
});

describe("the page's tables (criterion 13)", () => {
  it("each has a caption, scoped headers and its own scroll region", async () => {
    openPlayer();
    await heading("LeBron James");
    await waitFor(() => expect(gameHrefs(gameLog())).toHaveLength(3));

    expect(main().querySelectorAll("table").length).toBeGreaterThanOrEqual(2);
    expect(tableProblems(main())).toEqual([]);
  });
});

describe("an unknown player", () => {
  it("renders a not-found message on a 404", async () => {
    openPlayer(999);

    expect(
      await screen.findByRole("heading", { level: 1, name: /player not found/i }),
    ).toBeVisible();
    expect(screen.queryByText(/unexpected application error/i)).toBeNull();
  });

  it("renders the not-found message for an id that is not a number, asking nothing", async () => {
    const { detail } = openPlayer("not-a-number");

    expect(
      await screen.findByRole("heading", { level: 1, name: /player not found/i }),
    ).toBeVisible();
    expect(detail.requests).toHaveLength(0);
  });

  it("renders an alert, not a crash, when the request fails", async () => {
    const detail = playerDetailStub([LEBRON]);
    detail.fail();
    renderAppAt(`/players/${LEBRON.id}`, "anonymous", [
      detail.handler,
      playerGamesStub().handler,
    ]);

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByText(/unexpected application error/i)).toBeNull();
  });
});
