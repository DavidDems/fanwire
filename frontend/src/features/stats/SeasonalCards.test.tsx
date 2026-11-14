/**
 * FRONTEND-043: Records > Seasonal shows the season's eleven leader boards
 * as cards in the Historical cards' style (FRONTEND-042), each with its top
 * three and a View all that opens the top ten in a dialog. Through the real
 * route table, as a guest; the data is `test/leader-boards.ts`'s.
 *
 * The interface this file pins:
 *
 * - **Eleven cards, in EVENTS-017's board order**: points, assists,
 *   rebounds, blocks, steals, field goals made, threes made, field goal %,
 *   three-point %, field goals attempted, threes attempted. A card's `h3`
 *   names its board (the wording is the implementer's: `BOARD_TITLE`). The
 *   three leader tables are gone: no table on the page until a dialog opens.
 * - **The Historical card, not a copy**: the cards are the same grid and
 *   card (`StatsNav.module.css`'s `.cards` on the `ul`, `.card` on each `li`),
 *   the top three the same list (`ol.top`), and an entry's line 1 the same
 *   `.entryLine` holding `.entryName` and `.entryValue`.
 * - **An entry**: line 1, the player's name, a link to `/players/<id>`, and
 *   the value (an average to one place: `33.9`; a percentage board's 0-1
 *   fraction as a percentage to one place: `72.5 %`, a space before the sign
 *   or none); line 2, after it and outside it, at `--font-size-sm` in
 *   `--color-text-muted`: the team abbreviations and the games played, and
 *   on a percentage board the made and attempted (`343-473`).
 * - **Weight**: the leader's name and value, and those of anyone tied with
 *   them, resolve to `--font-weight-semibold`; everyone else's to regular.
 * - **No leader**: the card says "No player qualifies yet." and lists none.
 * - **View all** is a `button` (not a link: the dialog is not a route)
 *   named "View all <board title> leaders" (the title as the card shows it,
 *   any case). It opens a `Dialog` (one open `<dialog>`) whose title holds
 *   the board's title and the season, with one table of the top ten: rank,
 *   player, team, GP and value, and on a percentage board the made and
 *   attempted. The address does not change. Escape and Close close it, and
 *   focus returns to the button.
 * - **The qualifier**: above the cards, one muted line holds the answer's
 *   `rule`; a season in progress reads "Season in progress: <rule>".
 * - **Requests**: one `GET .../leader-boards?limit=10` per season, cached
 *   (a season picked again asks nothing); opening a dialog asks nothing; and
 *   `GET .../leaders` is never asked.
 *
 * jsdom computes no CSS: weights, sizes and colours are resolved from the
 * stylesheets by `test/record-cards.ts` (`verification.md` §2a).
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import nav from "../../components/stats-nav/StatsNav.module.css";
import {
  BOARD_ORDER,
  BOARD_TITLE,
  COMPLETE_SEASON,
  GAFFORD,
  GIANNIS,
  GOBERT,
  HALIBURTON,
  IN_PROGRESS_SEASON,
  JOKIC,
  LIMIT,
  LUKA,
  OLDER_SEASON,
  ON_PACE_RULE,
  SABONIS,
  SGA,
  SIMMONS,
  YOUNG,
  boardOf,
  averagePattern,
  leaderName,
  percentPattern,
  testLeaderBoards,
  type BoardLeaderOut,
  type BoardStat,
} from "../../test/leader-boards";
import { REGULAR, SEMIBOLD, holding, styleOf } from "../../test/record-cards";
import {
  norm,
  openRecords,
  panelOf,
  params,
  viewBar,
} from "../../test/records-screen";
import { server } from "../../test/server";
import { RULE_65, RULE_70 } from "../../test/stats";
import {
  bodyRows,
  columnHeaders,
  rowText,
  tableProblems,
} from "../../test/tables";
import { openDialog } from "../../test/thread";

// As the other records files: warm the lazy Records chunk outside any test.
beforeAll(async () => {
  await import("./RecordsTab");
}, 30_000);

/** Every request msw saw, as `METHOD path?query`, in order. */
let sent: string[] = [];

function record({ request }: { request: Request }): void {
  const url = new URL(request.url);
  sent.push(`${request.method} ${url.pathname}${url.search}`);
}

beforeEach(() => {
  sent = [];
  server.events.on("request:start", record);
});

afterEach(() => {
  server.events.removeListener("request:start", record);
});

/** The requests sent from `mark` on, once the screen has gone quiet. */
async function quietAfter(mark: number): Promise<string[]> {
  let last = -1;
  while (last !== sent.length) {
    last = sent.length;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return sent.slice(mark);
}

const seasonalAt = (season: string) =>
  `/stats/records?view=seasonal&season=${season}`;

// ------------------------------------------------------------ the readers

/** The Seasonal panel's one grid of cards: `ul.cards`, or null. */
function cardList(): HTMLElement | null {
  const panel = panelOf(viewBar());
  const lists = [
    ...panel.querySelectorAll<HTMLElement>(`.${nav.cards}`),
  ].filter((element) => element.closest("dialog") === null);
  if (lists.length > 1)
    throw new Error(`expected one grid of cards, found ${lists.length}`);
  return lists[0] ?? null;
}

function cardsIn(list: HTMLElement): HTMLElement[] {
  return [...list.children].filter(
    (child): child is HTMLElement => child.tagName === "LI",
  );
}

/** A card has landed: its top three, or its "no player" line. */
function landed(card: HTMLElement): boolean {
  return (
    card.querySelector("ol") !== null ||
    /no player qualifies yet/i.test(norm(card.textContent))
  );
}

/** The eleven cards, once every one has landed. */
async function findCards(): Promise<HTMLElement[]> {
  let cards: HTMLElement[] = [];
  await waitFor(
    () => {
      const list = cardList();
      expect(
        list,
        `no grid of cards (.${nav.cards}) on Seasonal: ${norm(
          panelOf(viewBar()).textContent,
        ).slice(0, 300)}`,
      ).not.toBeNull();
      cards = cardsIn(list as HTMLElement);
      expect(cards).toHaveLength(BOARD_ORDER.length);
      for (const card of cards) expect(landed(card)).toBe(true);
    },
    { timeout: 3000 },
  );
  return cards;
}

function titleOf(card: HTMLElement): string {
  const heading = within(card).queryByRole("heading", { level: 3 });
  expect(
    heading,
    `a card with no h3: ${norm(card.textContent)}`,
  ).not.toBeNull();
  return norm(heading?.textContent);
}

/** The card of `stat`: the card at its place in the board order. */
async function findCard(stat: BoardStat): Promise<HTMLElement> {
  const cards = await findCards();
  const card = cards[BOARD_ORDER.indexOf(stat)];
  expect(
    BOARD_TITLE[stat](titleOf(card)),
    `the ${stat} card is titled "${titleOf(card)}"`,
  ).toBe(true);
  return card;
}

/** A card's entries: the list items of its `ol`. */
function entriesOf(card: HTMLElement): HTMLElement[] {
  const lists = card.querySelectorAll("ol");
  expect(lists, "a card holds one list of its top entries").toHaveLength(1);
  return [...lists[0].children].filter(
    (child): child is HTMLElement => child.tagName === "LI",
  );
}

interface Lines {
  link: HTMLAnchorElement;
  line1: HTMLElement;
  value: HTMLElement;
  line2: HTMLElement;
}

/** An entry's parts: its name link, line 1, the value in it, and line 2. */
function linesOf(entry: HTMLElement, who: BoardLeaderOut): Lines {
  const link = within(entry).getByRole("link", {
    name: new RegExp(leaderName(who)),
  }) as HTMLAnchorElement;
  const line1 = link.closest<HTMLElement>(`.${nav.entryLine}`);
  expect(
    line1,
    `${leaderName(who)}'s name is not in an .entryLine (the Historical card's line 1)`,
  ).not.toBeNull();
  const value = (line1 as HTMLElement).querySelector<HTMLElement>(
    `.${nav.entryValue}`,
  );
  expect(value, "line 1 holds no .entryValue").not.toBeNull();
  // Line 2: the outermost element with text outside line 1 (and not
  // around it), in document order.
  const line2 = [...entry.querySelectorAll<HTMLElement>("*")].find(
    (element) =>
      !(line1 as HTMLElement).contains(element) &&
      !element.contains(line1 as HTMLElement) &&
      norm(element.textContent) !== "",
  );
  expect(line2, `${leaderName(who)}'s entry has no line 2`).toBeDefined();
  return {
    link,
    line1: line1 as HTMLElement,
    value: value as HTMLElement,
    line2: line2 as HTMLElement,
  };
}

function expectWeight(
  element: Element,
  what: string,
  weight: "semibold" | "regular",
): void {
  const resolved = styleOf(element, "font-weight");
  expect(
    weight === "semibold" ? SEMIBOLD : REGULAR,
    `${what} resolves to font-weight ${resolved}, not ${weight}`,
  ).toContain(resolved ?? "normal");
}

/** The name's and the value's weights, read from the elements holding them. */
function expectEntryWeight(
  entry: HTMLElement,
  who: BoardLeaderOut,
  valueText: string,
  weight: "semibold" | "regular",
): void {
  const { line1 } = linesOf(entry, who);
  expectWeight(
    holding(line1, leaderName(who)),
    `${leaderName(who)}'s name`,
    weight,
  );
  expectWeight(
    holding(line1, valueText),
    `${leaderName(who)}'s ${valueText}`,
    weight,
  );
}

/** A card's View all button. */
function viewAllOf(card: HTMLElement): HTMLElement {
  return within(card).getByRole("button", { name: /^view all\b/i });
}

/** The open dialog, once one is. */
async function dialogOpens(): Promise<HTMLDialogElement> {
  await waitFor(() => expect(openDialog(), "no dialog opened").not.toBeNull());
  return openDialog() as HTMLDialogElement;
}

async function dialogCloses(): Promise<void> {
  await waitFor(() => expect(openDialog()).toBeNull());
}

function dialogTitle(dialog: HTMLDialogElement): string {
  const id = dialog.getAttribute("aria-labelledby");
  return norm(id === null ? "" : document.getElementById(id)?.textContent);
}

function onlyTable(dialog: HTMLElement): HTMLTableElement {
  const tables = dialog.querySelectorAll("table");
  expect(tables, "the dialog holds one table").toHaveLength(1);
  return tables[0];
}

/** The main region's tables, outside any dialog. */
function pageTables(): HTMLTableElement[] {
  return [...screen.getByRole("main").querySelectorAll("table")].filter(
    (table) => table.closest("dialog") === null,
  );
}

// --------------------------------------------------- criterion 1: the cards

describe("Records > Seasonal's cards", () => {
  it("shows eleven cards in EVENTS-017's board order, and no leader table", async () => {
    openRecords(seasonalAt(COMPLETE_SEASON));

    const cards = await findCards();
    const titles = cards.map(titleOf);
    BOARD_ORDER.forEach((stat, index) => {
      expect(
        BOARD_TITLE[stat](titles[index]),
        `card ${index + 1} should be the ${stat} board, not "${titles[index]}" (titles: ${titles.join(" | ")})`,
      ).toBe(true);
    });
    expect(pageTables(), "the three leader tables are gone").toEqual([]);
  });

  it("uses the Historical cards' grid, card, entry list and entry line, not a copy", async () => {
    openRecords(seasonalAt(COMPLETE_SEASON));

    const cards = await findCards();
    const list = cardList() as HTMLElement;
    expect(list.tagName).toBe("UL");
    for (const card of cards) expect(card).toHaveClass(nav.card);

    const points = cards[BOARD_ORDER.indexOf("points")];
    const top = points.querySelector("ol");
    expect(top).toHaveClass(nav.top);
    const [first] = entriesOf(points);
    const { link, line1, value } = linesOf(first, LUKA);
    expect(line1).toHaveClass(nav.entryLine);
    expect(
      link.closest(`.${nav.entryName}`) ??
        link.querySelector(`.${nav.entryName}`),
      "the name is the card's .entryName",
    ).not.toBeNull();
    expect(norm(value.textContent)).toMatch(averagePattern(LUKA.value));
  });

  it("shows the same eleven boards for a season in progress", async () => {
    openRecords("/stats/records?view=seasonal");

    const cards = await findCards();
    BOARD_ORDER.forEach((stat, index) =>
      expect(
        BOARD_TITLE[stat](titleOf(cards[index])),
        titleOf(cards[index]),
      ).toBe(true),
    );
  });
});

// ------------------------------------------------ criterion 2: the top three

describe("a card's top three", () => {
  it("points: three entries, each the player's link and the average, then teams and games played", async () => {
    openRecords(seasonalAt(COMPLETE_SEASON));

    const card = await findCard("points");
    const entries = entriesOf(card);
    expect(entries).toHaveLength(3);
    [LUKA, GIANNIS, SGA].forEach((who, index) => {
      const { link, line1, value, line2 } = linesOf(entries[index], who);
      expect(link).toHaveAttribute("href", `/players/${who.player_id}`);
      expect(norm(value.textContent)).toMatch(averagePattern(who.value));
      expect(line1.contains(line2), "line 2 is not inside line 1").toBe(false);
      expect(
        line1.compareDocumentPosition(line2) & Node.DOCUMENT_POSITION_FOLLOWING,
        "line 2 follows line 1",
      ).toBeTruthy();
      const second = norm(line2.textContent);
      for (const team of who.teams) expect(second).toContain(team);
      expect(second).toMatch(
        new RegExp(`(?<![\\d.])${who.games_played}(?![\\d])`),
      );
      expect(norm(line1.textContent)).not.toContain(String(who.games_played));
      expect(styleOf(line2, "font-size")).toBe("var(--font-size-sm)");
      expect(styleOf(line2, "color")).toBe("var(--color-text-muted)");
    });
  });

  it("names every team a player played for on line 2", async () => {
    openRecords(seasonalAt(COMPLETE_SEASON));

    const card = await findCard("assists");
    const { line2 } = linesOf(entriesOf(card)[1], SIMMONS);
    expect(norm(line2.textContent)).toContain("BKN");
    expect(norm(line2.textContent)).toContain("PHX");
  });

  it("a percentage board: the value as a percentage to one place, made-attempted on line 2", async () => {
    openRecords(seasonalAt(COMPLETE_SEASON));

    const card = await findCard("field_goal_pct");
    const top = boardOf(
      testLeaderBoards(COMPLETE_SEASON),
      "field_goal_pct",
    ).leaders.slice(0, 3);
    const entries = entriesOf(card);
    expect(entries).toHaveLength(3);
    top.forEach((who, index) => {
      const { value, line2 } = linesOf(entries[index], who);
      expect(norm(value.textContent)).toMatch(percentPattern(who.value));
      const second = norm(line2.textContent);
      expect(second).toMatch(
        new RegExp(`(?<!\\d)${who.made}\\s?[-–/]\\s?${who.attempted}(?!\\d)`),
      );
      expect(second).toMatch(
        new RegExp(`(?<![\\d.])${who.games_played}(?![\\d])`),
      );
    });
    expect(norm(card.textContent)).not.toContain(".725");
  });

  it("sets the leader in semibold and the rest regular, two tied below him included", async () => {
    openRecords(seasonalAt(COMPLETE_SEASON));

    const points = entriesOf(await findCard("points"));
    expectEntryWeight(points[0], LUKA, "33.9", "semibold");
    expectEntryWeight(points[1], GIANNIS, "30.4", "regular");
    expectEntryWeight(points[2], SGA, "30.1", "regular");

    const rebounds = entriesOf(await findCard("rebounds"));
    expectEntryWeight(rebounds[0], SABONIS, "13.7", "semibold");
    expectEntryWeight(rebounds[1], JOKIC, "12.4", "regular");
    expectEntryWeight(rebounds[2], GOBERT, "12.4", "regular");
  });

  it("sets everyone tied with the leader in semibold too", async () => {
    openRecords(seasonalAt(COMPLETE_SEASON));

    const assists = entriesOf(await findCard("assists"));
    expectEntryWeight(assists[0], HALIBURTON, "10.9", "semibold");
    expectEntryWeight(assists[1], SIMMONS, "10.9", "semibold");
    expectEntryWeight(assists[2], YOUNG, "10.8", "regular");
  });

  it("a board with no leader reads 'No player qualifies yet.' and lists no one", async () => {
    openRecords(seasonalAt(IN_PROGRESS_SEASON));

    const card = await findCard("three_point_pct");
    expect(norm(card.textContent)).toContain("No player qualifies yet.");
    expect(card.querySelector("ol")).toBeNull();
    expect(within(card).queryAllByRole("link")).toEqual([]);
  });
});

// ------------------------------------------------------ criterion 3: View all

describe("View all", () => {
  it("each card has a View all button named for its board", async () => {
    openRecords(seasonalAt(COMPLETE_SEASON));

    const cards = await findCards();
    for (const card of cards) {
      const title = titleOf(card);
      const button = viewAllOf(card);
      expect(button.tagName).toBe("BUTTON");
      expect(
        norm(
          button.getAttribute("aria-label") ?? button.textContent,
        ).toLowerCase(),
      ).toBe(`view all ${title.toLowerCase()} leaders`);
      expect(
        within(card).queryByRole("link", { name: /view all/i }),
      ).toBeNull();
    }
  });

  it("opens a dialog titled with the board and season: the top ten, rank, player, team, GP and value", async () => {
    const { router } = openRecords(seasonalAt(COMPLETE_SEASON));
    const user = userEvent.setup();
    const card = await findCard("points");
    const address = `${router.state.location.pathname}${router.state.location.search}`;

    await user.click(viewAllOf(card));

    const dialog = await dialogOpens();
    const title = dialogTitle(dialog);
    expect(title.toLowerCase()).toContain(titleOf(card).toLowerCase());
    expect(title).toContain(COMPLETE_SEASON);
    expect(
      `${router.state.location.pathname}${router.state.location.search}`,
    ).toBe(address);

    const table = onlyTable(dialog);
    const headers = columnHeaders(table).join(" | ");
    expect(headers).toMatch(/#|rank/i);
    expect(headers).toMatch(/player/i);
    expect(headers).toMatch(/team/i);
    expect(headers).toMatch(/\bGP\b|games/i);
    expect(columnHeaders(table).length).toBeGreaterThanOrEqual(5);
    expect(tableProblems(dialog)).toEqual([]);

    const leaders = boardOf(
      testLeaderBoards(COMPLETE_SEASON),
      "points",
    ).leaders;
    const rows = bodyRows(table);
    expect(rows).toHaveLength(LIMIT);
    leaders.forEach((who, index) => {
      const text = rowText(rows[index]);
      expect(norm(rows[index].cells[0]?.textContent)).toBe(String(index + 1));
      expect(text).toContain(leaderName(who));
      for (const team of who.teams) expect(text).toContain(team);
      expect(text).toMatch(
        new RegExp(`(?<![\\d.])${who.games_played}(?![\\d])`),
      );
      expect(text).toMatch(
        new RegExp(
          `(?<![\\d.])${who.value.toFixed(1).replace(".", "\\.")}(?![\\d])`,
        ),
      );
    });
  });

  it("a percentage board's dialog shows the percentage and the made and attempted", async () => {
    openRecords(seasonalAt(COMPLETE_SEASON));
    const user = userEvent.setup();

    await user.click(viewAllOf(await findCard("field_goal_pct")));

    const dialog = await dialogOpens();
    const table = onlyTable(dialog);
    expect(columnHeaders(table).join(" | ")).toMatch(/made|FGM/i);
    expect(columnHeaders(table).join(" | ")).toMatch(/att|FGA/i);
    const rows = bodyRows(table);
    expect(rows).toHaveLength(LIMIT);
    const leaders = boardOf(
      testLeaderBoards(COMPLETE_SEASON),
      "field_goal_pct",
    ).leaders;
    leaders.forEach((who, index) => {
      const text = rowText(rows[index]);
      expect(text).toContain(leaderName(who));
      expect(text).toMatch(
        new RegExp(`${(who.value * 100).toFixed(1).replace(".", "\\.")}\\s?%`),
      );
      expect(text).toMatch(new RegExp(`(?<![\\d.])${who.made}(?![\\d])`));
      expect(text).toMatch(new RegExp(`(?<![\\d.])${who.attempted}(?![\\d])`));
    });
    expect(rowText(rows[0])).toContain(leaderName(GAFFORD));
  });

  it("Escape closes it, and focus returns to the button", async () => {
    openRecords(seasonalAt(COMPLETE_SEASON));
    const user = userEvent.setup();
    const button = viewAllOf(await findCard("assists"));

    await user.click(button);
    const dialog = await dialogOpens();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));

    await dialogCloses();
    await waitFor(() => expect(button).toHaveFocus());
  });

  it("the Close button closes it, and focus returns to the button", async () => {
    openRecords(seasonalAt(COMPLETE_SEASON));
    const user = userEvent.setup();
    const button = viewAllOf(await findCard("blocks"));

    await user.click(button);
    const dialog = await dialogOpens();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    await dialogCloses();
    await waitFor(() => expect(button).toHaveFocus());
  });
});

// --------------------------------------------------- criterion 5: qualifier

/** The one element outside the cards whose own text holds `rule`. */
function qualifierLine(rule: string): HTMLElement {
  const panel = panelOf(viewBar());
  const list = cardList() as HTMLElement;
  const lines = [...panel.querySelectorAll<HTMLElement>("p, div, span")].filter(
    (element) =>
      !list.contains(element) &&
      element.closest("dialog") === null &&
      norm(element.textContent).includes(rule) &&
      ![...element.children].some((child) =>
        norm(child.textContent).includes(rule),
      ),
  );
  expect(lines, `one line holds "${rule}"`).toHaveLength(1);
  return lines[0];
}

describe("the qualifier above the cards", () => {
  it("a complete season: one muted line with the response's rule, above the cards", async () => {
    openRecords(seasonalAt(COMPLETE_SEASON));

    await findCards();
    const line = qualifierLine(RULE_65);
    expect(norm(line.textContent)).not.toMatch(/in progress/i);
    expect(styleOf(line, "color")).toBe("var(--color-text-muted)");
    expect(
      line.compareDocumentPosition(cardList() as HTMLElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("a season in progress: 'Season in progress: ' and the rule", async () => {
    openRecords("/stats/records?view=seasonal");

    await findCards();
    const line = qualifierLine(ON_PACE_RULE);
    expect(norm(line.textContent)).toMatch(
      new RegExp(`^Season in progress: ${ON_PACE_RULE}`),
    );
    expect(styleOf(line, "color")).toBe("var(--color-text-muted)");
  });

  it("another season's rule when it is different", async () => {
    openRecords(seasonalAt(OLDER_SEASON));

    await findCards();
    await waitFor(() => qualifierLine(RULE_70));
    expect(norm(panelOf(viewBar()).textContent)).not.toContain(RULE_65);
  });
});

// ---------------------------------------------------- criterion 4: requests

const BOARDS_REQUEST =
  /^GET \S*\/events\/seasons\/([^/]+)\/leader-boards(\?\S*)?$/;

function boardsRequests(requests: string[]): string[] {
  return requests.filter((r) => BOARDS_REQUEST.test(r));
}

describe("the requests", () => {
  it("one leader-boards read with limit 10 for the season, and no /leaders read", async () => {
    const { stubs } = openRecords("/stats/records?view=seasonal");

    await findCards();
    await quietAfter(0);
    expect(stubs.leaderBoards.requests.map((r) => r.path.season)).toEqual([
      IN_PROGRESS_SEASON,
    ]);
    expect(stubs.leaderBoards.requests[0].query.get("limit")).toBe("10");
    expect(stubs.leaders.requests).toEqual([]);
    expect(sent.filter((r) => /\/leaders(\?|$)/.test(r))).toEqual([]);
  });

  it("opening and closing every View all dialog asks nothing", async () => {
    openRecords(seasonalAt(COMPLETE_SEASON));
    const user = userEvent.setup();
    const cards = await findCards();
    await quietAfter(0);
    const mark = sent.length;

    for (const card of cards) {
      await user.click(viewAllOf(card));
      const dialog = await dialogOpens();
      await user.click(within(dialog).getByRole("button", { name: "Close" }));
      await dialogCloses();
    }

    const requests = await quietAfter(mark);
    expect(requests, requests.join("\n")).toEqual([]);
  });

  it("a season picked again is not asked for again", async () => {
    const { stubs, router } = openRecords("/stats/records?view=seasonal");
    const user = userEvent.setup();
    await findCards();
    const select = screen.getByRole("combobox", { name: "Season" });

    await user.selectOptions(select, COMPLETE_SEASON);
    await waitFor(() =>
      expect(params(router).get("season")).toBe(COMPLETE_SEASON),
    );
    await findCard("points");
    await waitFor(() =>
      expect(norm(cardList()?.textContent)).toContain(leaderName(LUKA)),
    );
    await user.selectOptions(select, IN_PROGRESS_SEASON);
    await waitFor(() =>
      expect(params(router).get("season")).toBe(IN_PROGRESS_SEASON),
    );
    await findCards();
    await quietAfter(0);

    expect(stubs.leaderBoards.requests.map((r) => r.path.season)).toEqual([
      IN_PROGRESS_SEASON,
      COMPLETE_SEASON,
    ]);
    expect(boardsRequests(sent)).toHaveLength(2);
    expect(stubs.leaders.requests).toEqual([]);
  });
});
