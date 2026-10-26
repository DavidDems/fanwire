/**
 * FRONTEND-019 criteria 4 and 7: a record's ranked list, as a level of the
 * stats navigator on the Records tab, through the real route table.
 *
 * The interface this file pins:
 *
 * - **Opening.** A card's "View all" link, plainly clicked, pushes the record
 *   level onto the Records stack at `/stats/records?record=<id>` (never with
 *   `group`). A cold load of that address shows it too (a reload, a shared
 *   link), and the browser's Back from it returns to the cards.
 * - **The breadcrumb** (the navigator's "Stats path") reads "Team records ›
 *   <title>" or "Player records › <title>" by the list's group, the title
 *   item `aria-current="location"`; until the list lands, its first item
 *   reads "Records". The first item is a link to its group's tab
 *   (`/stats/records`, or `/stats/records?group=player`).
 * - **Back** and the breadcrumb's first item return to Historical on the
 *   list's group's tab, Player selected for a player record, even from a cold
 *   `?record=`.
 * - **Headings.** The record level's `h2` is the record's title: from the
 *   cached summary when a card opened it (so it is never empty while the list
 *   loads), and from the list on a cold load.
 * - **The level** shows the record's rule, "Since <since_season>", and its
 *   whole list (`total` entries, up to 100) in one table that keeps the table
 *   contract (`test/tables.ts`), with a row header in every row:
 *   - the rank first, as the API gives it;
 *   - a player linked to `/players/<id>`; a team linked to the Seasons tab
 *     filtered to it, for that season when the entry has one (`teamHref`);
 *   - a player's team, for a single-game record;
 *   - the season, or the game: its date linked to `/games/<id>`, and the
 *     opponent;
 *   - the value (a win percentage as `.890`);
 *   - and no column the record has no value for: no column of blanks.
 *   A season record's list says in one line under the table that its ranks
 *   come from the exact fraction (equal three-place figures can rank apart).
 * - **The Team / Player bar** belongs to the records level and is not shown
 *   on a record level; the Historical / Seasonal bar stays above the
 *   navigator, and switching the view drops `record`.
 * - **Not found.** An unknown id shows the API's not-found in place, with
 *   Back to the cards.
 * - **Focus** moves to the new level's heading when a control in the
 *   navigator opens or pops a level (View all, Back, the breadcrumb), never
 *   on a cold load.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http } from "msw";
import { beforeAll, describe, expect, it } from "vitest";

import { formatGameDate } from "../games/format";
import {
  ADEBAYO,
  ADEBAYO_GAME,
  NUGGETS_GAME,
  SINCE_SEASON,
  WARRIORS,
  playerName,
  recordDefinition,
  testRecordList,
} from "../../test/records";
import {
  MISSING,
  backButton,
  controlIn,
  crumbTexts,
  crumbs,
  findCard,
  findCards,
  focusedHeading,
  groupBar,
  isCurrent,
  norm,
  openRecords,
  panelOf,
  params,
  queryTablistHolding,
  selectedTab,
  tab,
  viewAll,
  viewBar,
} from "../../test/records-screen";
import { CELTICS, NUGGETS } from "../../test/stats";
import {
  bodyRows,
  columnHeaders,
  rowText,
  tableProblems,
} from "../../test/tables";

// The Director's correction (FRONTEND-019): the Records tab is a lazy route,
// and the first test of a file to open it waited on the cold transform of its
// chunk (RecordsTab and the shared navigator), which overran findBy's 1 s
// under the full suite's load. Importing it once here does that work outside
// any test; no assertion changes.
beforeAll(async () => {
  await import("./RecordsTab");
}, 30_000);

type User = ReturnType<typeof userEvent.setup>;

const BLANK = /^[\s–—-]*$/;

async function openFromCard(
  user: User,
  group: "team" | "player",
  id: string,
): Promise<void> {
  const card = await findCard(group, recordDefinition(id).title);
  await user.click(viewAll(card));
}

async function recordLevelShown(id: string): Promise<HTMLTableElement> {
  const { title } = recordDefinition(id);
  await screen.findByRole("heading", { level: 2, name: title });
  const main = screen.getByRole("main");
  await waitFor(() => expect(main.querySelectorAll("table")).toHaveLength(1));
  return main.querySelector("table") as HTMLTableElement;
}

function headingText(level: number): string[] {
  return screen
    .getAllByRole("heading", { level })
    .map((heading) => norm(heading.textContent));
}

/** Every text node under `root`. */
function textNodes(root: HTMLElement): Node[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const found: Node[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    found.push(node);
  return found;
}

/** The text of each body row's cell at `column`. */
function columnCells(table: HTMLTableElement, column: number): string[] {
  return bodyRows(table).map((row) => norm(row.cells[column]?.textContent));
}

describe("opening a record from its card", () => {
  it("pushes ?record=<id>, without group, and shows the Player records › <title> breadcrumb", async () => {
    const { router } = openRecords("/stats/records?group=player");
    const user = userEvent.setup();

    await openFromCard(user, "player", "player-points-game");

    await waitFor(() =>
      expect(params(router).get("record")).toBe("player-points-game"),
    );
    expect(router.state.historyAction).toBe("PUSH");
    expect(params(router).has("group")).toBe(false);
    await recordLevelShown("player-points-game");
    await waitFor(() =>
      expect(crumbTexts()).toEqual(["Player records", "Most points in a game"]),
    );
    const items = crumbs();
    expect(isCurrent(items[1])).toBe(true);
    expect(isCurrent(items[0])).toBe(false);
    expect(backButton()).not.toBeNull();
  });

  it("reads Team records › <title> for a team record", async () => {
    openRecords();
    const user = userEvent.setup();

    await openFromCard(user, "team", "team-best-season");

    await recordLevelShown("team-best-season");
    await waitFor(() =>
      expect(crumbTexts()).toEqual(["Team records", "Best regular season"]),
    );
  });

  it("moves focus to the record's heading", async () => {
    openRecords();
    const user = userEvent.setup();

    await openFromCard(user, "team", "team-championships");

    await waitFor(() => {
      const heading = focusedHeading();
      expect(heading, "focus is on no heading").not.toBeNull();
      expect(norm(heading?.textContent)).toBe("Most championships");
      expect(heading?.tagName).toBe("H2");
      expect(heading).toHaveAttribute("tabindex", "-1");
    });
  });

  it("names the record in its heading from the cached summary while the list loads", async () => {
    openRecords("/stats/records?group=player", {
      handlers: [
        http.get("*/events/records/:record_id", async () => {
          await delay("infinite");
        }),
      ],
    });
    const user = userEvent.setup();

    await openFromCard(user, "player", "player-career-points");

    await waitFor(() => {
      const heading = focusedHeading();
      expect(heading, "focus is on no heading").not.toBeNull();
      expect(norm(heading?.textContent)).toBe("Most career points");
    });
    expect(
      screen.getByRole("heading", { level: 2, name: "Most career points" }),
    ).toBeVisible();
    expect(screen.getByRole("main").textContent).not.toMatch(MISSING);
  });

  it("hides the Team / Player bar, and keeps the Historical / Seasonal bar above the navigator", async () => {
    openRecords();
    const user = userEvent.setup();

    await openFromCard(user, "team", "team-best-season");
    await recordLevelShown("team-best-season");

    expect(queryTablistHolding("Player")).toBeNull();
    expect(selectedTab(viewBar())).toBe("Historical");
    const path = screen.getByRole("navigation", { name: "Stats path" });
    expect(panelOf(viewBar()).contains(path)).toBe(true);
    expect(
      viewBar().compareDocumentPosition(path) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("the h2 is the title alone: the records level's h2 is gone", async () => {
    openRecords();
    const user = userEvent.setup();

    await openFromCard(user, "team", "team-best-season");
    await recordLevelShown("team-best-season");

    expect(headingText(2)).toContain("Best regular season");
    expect(headingText(2)).not.toContain("Team records");
  });
});

describe("Back, the breadcrumb and the browser's Back", () => {
  it("Back returns to Historical on the Player tab, focus on its heading", async () => {
    const { router } = openRecords("/stats/records?group=player");
    const user = userEvent.setup();
    await openFromCard(user, "player", "player-points-game");
    await recordLevelShown("player-points-game");

    await user.click(backButton() as HTMLElement);

    await waitFor(() => expect(params(router).has("record")).toBe(false));
    expect(params(router).get("group")).toBe("player");
    await findCards("player");
    expect(selectedTab(viewBar())).toBe("Historical");
    expect(selectedTab(groupBar())).toBe("Player");
    expect(backButton()).toBeNull();
    await waitFor(() => {
      const heading = focusedHeading();
      expect(heading, "focus is on no heading").not.toBeNull();
      expect(norm(heading?.textContent)).toBe("Player records");
      expect(heading).toHaveAttribute("tabindex", "-1");
    });
  });

  it("Back from a team record returns to /stats/records, Team selected", async () => {
    const { router } = openRecords();
    const user = userEvent.setup();
    await openFromCard(user, "team", "team-most-points-game");
    await recordLevelShown("team-most-points-game");

    await user.click(backButton() as HTMLElement);

    await waitFor(() => expect(router.state.location.search).toBe(""));
    expect(router.state.location.pathname).toBe("/stats/records");
    await findCards("team");
  });

  it("the breadcrumb's first item links to its group's tab and returns there", async () => {
    const { router } = openRecords("/stats/records?group=player");
    const user = userEvent.setup();
    await openFromCard(user, "player", "player-assists-game");
    await recordLevelShown("player-assists-game");
    await waitFor(() => expect(crumbTexts()[0]).toBe("Player records"));

    const control = controlIn(crumbs()[0]);
    expect(control).toHaveAttribute("href", "/stats/records?group=player");
    await user.click(control);

    await waitFor(() => expect(params(router).has("record")).toBe(false));
    expect(params(router).get("group")).toBe("player");
    await findCards("player");
    await waitFor(() =>
      expect(norm(focusedHeading()?.textContent)).toBe("Player records"),
    );
  });

  it("the breadcrumb's first item of a team record links to /stats/records", async () => {
    openRecords();
    const user = userEvent.setup();
    await openFromCard(user, "team", "team-championships");
    await recordLevelShown("team-championships");
    await waitFor(() => expect(crumbTexts()[0]).toBe("Team records"));

    expect(controlIn(crumbs()[0])).toHaveAttribute("href", "/stats/records");
  });

  it("the browser's Back returns to the cards on the same group tab", async () => {
    const { router } = openRecords("/stats/records?group=player");
    const user = userEvent.setup();
    await openFromCard(user, "player", "player-points-game");
    await recordLevelShown("player-points-game");

    await router.navigate(-1);

    await findCards("player");
    expect(params(router).get("group")).toBe("player");
    expect(params(router).has("record")).toBe(false);
  });
});

describe("a cold ?record= (a reload or a shared link)", () => {
  it("opens straight on the record, moving no focus", async () => {
    openRecords("/stats/records?record=team-best-season");

    await recordLevelShown("team-best-season");
    await waitFor(() =>
      expect(crumbTexts()).toEqual(["Team records", "Best regular season"]),
    );
    expect(document.activeElement).toBe(document.body);
  });

  it("uses a cold record id prefix immediately, so Back before its list lands keeps Player selected", async () => {
    const { router } = openRecords("/stats/records?record=player-points-game", {
      handlers: [
        http.get("*/events/records/:record_id", async () => {
          await delay("infinite");
        }),
      ],
    });

    await waitFor(() => expect(crumbTexts()[0]).toBe("Player records"));
    await userEvent.setup().click(backButton() as HTMLElement);
    await waitFor(() => expect(params(router).get("group")).toBe("player"));
    expect(selectedTab(groupBar())).toBe("Player");
    expect(screen.getByRole("main").textContent).not.toMatch(MISSING);
  });

  it("Back from a cold player record lands on ?group=player with Player selected", async () => {
    const { router } = openRecords("/stats/records?record=player-points-game");
    const user = userEvent.setup();
    await recordLevelShown("player-points-game");
    await waitFor(() => expect(crumbTexts()[0]).toBe("Player records"));

    await user.click(backButton() as HTMLElement);

    await waitFor(() => expect(params(router).has("record")).toBe(false));
    expect(params(router).get("group")).toBe("player");
    await findCards("player");
    expect(selectedTab(groupBar())).toBe("Player");
  });

  it("an unknown id shows the API's not-found in place, with Back to the cards", async () => {
    const { router } = openRecords("/stats/records?record=no-such-record");
    const user = userEvent.setup();

    await waitFor(() =>
      expect(norm(screen.getByRole("main").textContent)).toMatch(
        /not found|no such record|no record|unknown record|does ?n[o’']t exist/i,
      ),
    );
    expect(screen.getByRole("main").textContent).not.toMatch(MISSING);
    expect(screen.getByRole("main").querySelectorAll("table")).toHaveLength(0);
    expect(backButton()).not.toBeNull();

    await user.click(backButton() as HTMLElement);

    await waitFor(() => expect(params(router).has("record")).toBe(false));
    await findCards("team");
  });

  it("switching the view drops record", async () => {
    const { router } = openRecords("/stats/records?record=team-best-season");
    const user = userEvent.setup();
    await recordLevelShown("team-best-season");

    await user.click(tab(viewBar(), "Seasonal"));

    await waitFor(() => expect(params(router).get("view")).toBe("seasonal"));
    expect(params(router).has("record")).toBe(false);
    expect(router.state.historyAction).toBe("REPLACE");
  });
});

describe("the list", () => {
  it("shows the rule and Since <since_season>", async () => {
    openRecords("/stats/records?record=player-points-game");

    await recordLevelShown("player-points-game");
    const text = norm(screen.getByRole("main").textContent);
    expect(text).toContain(recordDefinition("player-points-game").rule);
    expect(text).toContain(`Since ${SINCE_SEASON}`);
  });

  it("shows the whole list, total rows, in one table with the table contract", async () => {
    openRecords("/stats/records?record=player-points-game");

    const table = await recordLevelShown("player-points-game");
    await waitFor(() =>
      expect(bodyRows(table)).toHaveLength(
        testRecordList("player-points-game").total,
      ),
    );
    expect(bodyRows(table)).toHaveLength(100);
    expect(tableProblems(screen.getByRole("main"))).toEqual([]);
    for (const row of bodyRows(table))
      expect(row.querySelector('th[scope="row"]')).not.toBeNull();
    expect(screen.getByRole("main").textContent).not.toMatch(MISSING);
  });

  it("links a player to /players/<id> and a game's date to /games/<id>, with the opponent and his team", async () => {
    openRecords("/stats/records?record=player-points-game");

    const table = await recordLevelShown("player-points-game");
    const [first] = bodyRows(table);
    expect(
      within(first).getByRole("link", {
        name: new RegExp(playerName(ADEBAYO)),
      }),
    ).toHaveAttribute("href", `/players/${ADEBAYO.id}`);
    expect(
      within(first).getByRole("link", {
        name: formatGameDate(ADEBAYO_GAME.date),
      }),
    ).toHaveAttribute("href", `/games/${ADEBAYO_GAME.id}`);
    const text = rowText(first);
    expect(text).toContain("WAS");
    expect(text.includes("Miami Heat") || /\bMIA\b/.test(text)).toBe(true);
    expect(text).toMatch(/(?<![\d.])83(?!\d)/);
  });

  it("links a team to the Seasons tab filtered to it for that season", async () => {
    openRecords("/stats/records?record=team-best-season");

    const table = await recordLevelShown("team-best-season");
    const [first] = bodyRows(table);
    const link = within(first).getByRole("link", {
      name: new RegExp(WARRIORS.name),
    });
    const href = new URL(link.getAttribute("href") ?? "", "http://x.test");
    expect(href.pathname).toBe("/stats/seasons");
    expect(href.searchParams.get("team")).toBe(String(WARRIORS.id));
    expect(href.searchParams.get("season")).toBe("2015-16");
  });

  it("links a team with no season to the Seasons tab filtered to it, no season written", async () => {
    openRecords("/stats/records?record=team-championships");

    const table = await recordLevelShown("team-championships");
    const [first] = bodyRows(table);
    expect(
      within(first).getByRole("link", { name: new RegExp(CELTICS.name) }),
    ).toHaveAttribute("href", `/stats/seasons?team=${CELTICS.id}`);
  });

  it("following a team's link shows that team's season on the Seasons tab", async () => {
    const { router, stubs } = openRecords(
      "/stats/records?record=team-best-season",
    );
    const user = userEvent.setup();
    const table = await recordLevelShown("team-best-season");

    await user.click(
      within(bodyRows(table)[1]).getByRole("link", {
        name: new RegExp(CELTICS.name),
      }),
    );

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/stats/seasons"),
    );
    expect(params(router).get("team")).toBe(String(CELTICS.id));
    await waitFor(() =>
      expect(stubs.teamSeason.requests.map((r) => r.path)).toContainEqual({
        team_id: String(CELTICS.id),
        season: "2023-24",
      }),
    );
  });

  it("a team's single-game list links its game's date and names the opponent", async () => {
    openRecords("/stats/records?record=team-most-points-game");

    const table = await recordLevelShown("team-most-points-game");
    const [first] = bodyRows(table);
    expect(
      within(first).getByRole("link", {
        name: formatGameDate(NUGGETS_GAME.date),
      }),
    ).toHaveAttribute("href", `/games/${NUGGETS_GAME.id}`);
    expect(rowText(first)).toContain("PHX");
    expect(rowText(first)).toContain(NUGGETS.name);
    expect(rowText(first)).toMatch(/(?<![\d.])168(?!\d)/);
  });

  it.each([
    "team-championships",
    "team-best-season",
    "team-most-points-game",
    "player-championships",
    "player-points-game",
    "player-career-points",
    "player-career-triple-doubles",
  ])("%s has no column of blanks", async (id) => {
    openRecords(`/stats/records?record=${id}`);

    const table = await recordLevelShown(id);
    const width = columnHeaders(table).length;
    expect(width).toBeGreaterThan(1);
    for (let column = 0; column < width; column += 1) {
      const cells = columnCells(table, column);
      expect(
        cells.some((cell) => !BLANK.test(cell)),
        `column ${column + 1} (${columnHeaders(table)[column]}) of ${id} is blank`,
      ).toBe(true);
    }
    for (const row of bodyRows(table)) expect(row.cells).toHaveLength(width);
  });

  it.each(["player-career-points", "player-championships"])(
    "%s shows no team, season or game: rank, player and value only",
    async (id) => {
      openRecords(`/stats/records?record=${id}`);

      const table = await recordLevelShown(id);
      expect(columnHeaders(table)).toHaveLength(3);
      expect(table.querySelectorAll('a[href^="/games/"]')).toHaveLength(0);
      expect(table.querySelectorAll('a[href^="/stats/seasons"]')).toHaveLength(
        0,
      );
    },
  );

  it("team-championships shows rank, team and value only", async () => {
    openRecords("/stats/records?record=team-championships");

    const table = await recordLevelShown("team-championships");
    expect(columnHeaders(table)).toHaveLength(3);
  });

  it("shows the API's ranks as given, ties included, rank first", async () => {
    openRecords("/stats/records?record=team-championships");

    const table = await recordLevelShown("team-championships");
    expect(columnCells(table, 0)).toEqual(["1", "1", "3"]);
  });

  it("a season record shows equal three-place percentages at the API's different ranks, and says why under the table", async () => {
    openRecords("/stats/records?record=team-best-season");

    const table = await recordLevelShown("team-best-season");
    expect(columnCells(table, 0)).toEqual(["1", "2", "3", "4"]);
    const rows = bodyRows(table);
    expect(rowText(rows[0])).toMatch(/(?<![\d.])\.890(?!\d)/);
    expect(rowText(rows[1])).toMatch(/(?<![\d.])\.841(?!\d)/);
    expect(rowText(rows[2])).toMatch(/(?<![\d.])\.841(?!\d)/);
    expect(rowText(table)).not.toMatch(/0\.8/);

    const notes = textNodes(screen.getByRole("main")).filter((node) =>
      /\b(exact|unrounded|rounded)\b/i.test(node.textContent ?? ""),
    );
    expect(
      notes.length,
      "no line says the ranks come from the exact figure",
    ).toBeGreaterThan(0);
    for (const note of notes) {
      expect(table.contains(note)).toBe(false);
      expect(
        table.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("a record that is not a season record has no tie note", async () => {
    openRecords("/stats/records?record=team-most-points-game");

    await recordLevelShown("team-most-points-game");
    expect(norm(screen.getByRole("main").textContent)).not.toMatch(
      /\b(exact|unrounded|rounded)\b/i,
    );
  });
});
