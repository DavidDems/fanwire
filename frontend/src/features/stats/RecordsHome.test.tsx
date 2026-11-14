/**
 * FRONTEND-030: the records home and its search, at `/stats/records`,
 * Historical, through the real route table, as a guest.
 *
 * The interface this file pins:
 *
 * - **The search box.** A labelled `<input type="search">` (a `searchbox`
 *   named with "records"), inside the Historical panel, above the cards. Not
 *   on Seasonal.
 * - **The bar.** `Top records`, `Team`, `Player`, in that order, Top records
 *   the default. Top records writes no `group`; Team is `?group=team`,
 *   written explicitly (the brief's trap: Team is no longer the default);
 *   Player is `?group=player`; an unknown `?group=` shows Top records. Each
 *   tab replaces the history entry. The level's `h2` and its list of cards
 *   are named "Top records", "Team records" or "Player records".
 * - **Top records** with no query is exactly the catalog's sixteen records
 *   with a `featured_rank`, in that order, chosen from the catalog (not a
 *   list in the code), with no Load more.
 * - **Team and Player** are their group's whole library in catalog order,
 *   24 cards a page, and Load more adds 24 until every match is shown.
 * - **The query is the URL.** Typing writes `?q=` with replace (no history
 *   entry), clearing the box drops it, and opening `?q=` (a reload, a shared
 *   link) restores the box and its results. `?q=` keeps the bar's group, and
 *   the bar keeps `q`. Switching to Seasonal drops `q`. Opening a card from
 *   the results pushes `?record=<id>`, and the browser's Back restores the
 *   query.
 * - **The match.** The query is split on whitespace; every term must be
 *   found, case-insensitive, as a substring of the record's title, category,
 *   group, unit or keywords (`test/records.ts`'s `matchesQuery` is the
 *   reference, and each field is reached by a term only it holds). On Top
 *   records a query searches the whole library; on Team or Player, that
 *   group. The filter runs in the browser over the catalog: typing a query
 *   asks for the catalog again never, and makes at most one holders read.
 * - **A card**, from the catalog at once: its title as an `h3` and its
 *   category (the category's own word, outside the title), and its one
 *   control, the stretched View all link at `?record=<id>`. Its holder area
 *   carries a class whose rule sets a `min-height`, while the holders load
 *   and after they land, so the answer moves nothing.
 * - **A failed holders read** shows one alert per failed page and keeps every
 *   card's title and link.
 * - **No match** shows an empty state naming the query and a button that
 *   clears it, and makes no holders read.
 * - **The count.** A polite live region, in the DOM before the first
 *   keystroke, says how many records match (the whole count, not the page),
 *   debounced: typing a ten-character query changes what it says at most
 *   twice.
 *
 * The requests per screen are `records-requests.test.tsx`'s, the value
 * shapes `RecordValues.test.tsx`'s, the grid's columns
 * `components/stats-nav/records-grid.test.ts`'s, and the wide column
 * `routes/AppLayout.test.tsx`'s and `routes/shell-css.test.ts`'s.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, delay, http } from "msw";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  FEATURED_IDS,
  PAGE_SIZE,
  idsOf,
  recordDefinition,
  recordsOf,
  searchIds,
  testRecordsSummary,
} from "../../test/records";
import {
  MISSING,
  cardId,
  findCardList,
  findCards,
  findRecordCard,
  groupBar,
  loadMore,
  norm,
  openRecords,
  panelOf,
  params,
  queryCardList,
  queryTablistHolding,
  searchBox,
  selectedTab,
  shownCards,
  shownIds,
  tab,
  tabNames,
  viewAll,
  viewBar,
  type RecordsBar,
} from "../../test/records-screen";
import { readSrcFile, allBlocks, parseCss, selectors } from "../../test/css";

// As the other Records files: warm the lazy chunk outside any test.
beforeAll(async () => {
  await import("./RecordsTab");
}, 30_000);

const FOCUSABLE =
  'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

type Opened = ReturnType<typeof openRecords>;

/** Every holders read a test made, checked: never one with no ids. */
let opened: Opened | null = null;

function open(...args: Parameters<typeof openRecords>): Opened {
  opened = openRecords(...args);
  return opened;
}

afterEach(() => {
  const asked = opened?.stubs.holders.requests ?? [];
  for (const request of asked) {
    const ids = idsOf(request.query);
    expect(ids.length, "a holders read with no ids").toBeGreaterThan(0);
    expect(ids.length).toBeLessThanOrEqual(PAGE_SIZE);
    expect(ids, "a holders read's ids unsorted").toEqual(sorted(ids));
  }
  opened = null;
});

/** Wait until no stub has answered anything new for two settles in a row. */
async function settle(stubs: Opened["stubs"]): Promise<void> {
  const count = () =>
    Object.values(stubs).reduce((sum, stub) => sum + stub.requests.length, 0);
  let last = -1;
  while (last !== count()) {
    last = count();
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

/** How many PUSH navigations the router makes from now on. */
function countPushes(router: Opened["router"]): () => number {
  let pushes = 0;
  router.subscribe((state) => {
    if (state.historyAction === "PUSH") pushes += 1;
  });
  return () => pushes;
}

function sorted(ids: readonly string[]): string[] {
  return [...ids].sort();
}

/** The category's own word, which a card shows outside its title. */
const CATEGORY_WORD: Record<string, RegExp> = {
  "team-franchise": /franchise/i,
  "team-season": /season/i,
  "team-game": /game/i,
  "player-game": /game/i,
  "player-season": /season/i,
  "player-career": /career/i,
  "player-playoffs": /playoff/i,
};

/** A card's text without its title and its View all link. */
function textBesideTitle(card: HTMLElement): string {
  const clone = card.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("h3, a").forEach((node) => node.remove());
  return norm(clone.textContent);
}

/** Every alert in main. */
function alerts(): HTMLElement[] {
  return within(screen.getByRole("main")).queryAllByRole("alert");
}

async function typeQuery(text: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(searchBox(), text);
}

// ------------------------------------------------------- the module classes

/** Every module stylesheet a records view can take a class from. */
const MODULES = import.meta.glob<{ default: Record<string, string> }>(
  ["../../components/**/*.module.css", "./*.module.css"],
  { eager: true },
);

function srcPath(globKey: string): string {
  return globKey.startsWith("./")
    ? `features/stats/${globKey.slice(2)}`
    : globKey.replace(/^\.\.\/\.\.\//, "");
}

/**
 * The generated classes under `root` whose own rule (a selector ending in the
 * class) sets a `min-height` or `min-block-size`: the room an area keeps.
 */
function heldClasses(root: HTMLElement): Set<string> {
  const held = new Set<string>();
  const elements = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const element of elements) {
    for (const generated of Array.from(element.classList)) {
      const name = /^_(.+)_[0-9a-z]+$/i.exec(generated)?.[1] ?? generated;
      for (const [path, module] of Object.entries(MODULES)) {
        if (module.default?.[name] !== generated) continue;
        const ending = new RegExp(`\\.${name}(?![\\w-])(?::[\\w-]+)*$`);
        const sets = allBlocks(parseCss(readSrcFile(srcPath(path)))).some(
          (block) =>
            selectors(block).some((selector) => ending.test(selector)) &&
            block.declarations.some(
              ({ property }) =>
                property === "min-height" || property === "min-block-size",
            ),
        );
        if (sets) held.add(generated);
      }
    }
  }
  return held;
}

// ------------------------------------------------------------ the home

describe("the records home: the search box and the bar", () => {
  it("shows a labelled search box above the cards, in the Historical panel", async () => {
    open();

    const list = await findCardList("top");
    const box = searchBox();
    expect(box).toBeVisible();
    expect(box).toHaveAttribute("type", "search");
    expect(box).toHaveAccessibleName(/records/i);
    expect(box).toHaveValue("");
    expect(panelOf(viewBar()).contains(box)).toBe(true);
    expect(
      box.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("is not on Seasonal", async () => {
    open("/stats/records?view=seasonal");

    await waitFor(() => expect(selectedTab(viewBar())).toBe("Seasonal"));
    expect(screen.queryByRole("searchbox", { name: /records/i })).toBeNull();
  });

  it("offers Top records, Team and Player, in that order, Top records selected and not written", async () => {
    const { router } = open();

    await findCards("top");
    expect(tabNames(groupBar())).toEqual(["Top records", "Team", "Player"]);
    expect(selectedTab(groupBar())).toBe("Top records");
    expect(params(router).has("group")).toBe(false);
    expect(
      screen.getByRole("heading", { level: 2, name: "Top records" }),
    ).toBeVisible();
  });

  it("shows Top records for an unknown ?group=", async () => {
    open("/stats/records?group=coaches");

    await findCards("top");
    expect(selectedTab(groupBar())).toBe("Top records");
  });

  it("writes Team as ?group=team, explicitly, and replaces the history entry", async () => {
    const { router } = open();
    const user = userEvent.setup();
    await findCards("top");

    await user.click(tab(groupBar(), "Team"));

    await waitFor(() => expect(params(router).get("group")).toBe("team"));
    expect(router.state.historyAction).toBe("REPLACE");
    await findCards("team");
    expect(selectedTab(groupBar())).toBe("Team");
    expect(
      screen.getByRole("heading", { level: 2, name: "Team records" }),
    ).toBeVisible();
  });

  it("writes Player as ?group=player, and Top records drops group", async () => {
    const { router } = open("/stats/records?group=player");
    const user = userEvent.setup();
    await findCards("player");

    await user.click(tab(groupBar(), "Top records"));

    await waitFor(() => expect(params(router).has("group")).toBe(false));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(router.state.location.search).toBe("");
    await findCards("top");
  });

  it("opens ?group=team on Team (a reload or a shared link)", async () => {
    open("/stats/records?group=team");

    await findCards("team");
    expect(selectedTab(groupBar())).toBe("Team");
  });

  it("keeps the search box and the bar off a record's level", async () => {
    open("/stats/records?record=team-best-season");

    await screen.findByRole("heading", {
      level: 2,
      name: recordDefinition("team-best-season").title,
    });
    expect(queryTablistHolding("Player")).toBeNull();
    expect(screen.queryByRole("searchbox", { name: /records/i })).toBeNull();
  });
});

describe("Top records", () => {
  it("is exactly the sixteen featured records, in featured_rank order, with no Load more", async () => {
    open();

    const cards = await findCards("top");
    expect(cards).toHaveLength(16);
    expect(cards.map(cardId)).toEqual(FEATURED_IDS);
    expect(loadMore()).toBeNull();
  });

  it("orders by featured_rank, not by the catalog's order", async () => {
    const summary = testRecordsSummary();
    open("/stats/records", {
      summary: { ...summary, records: [...summary.records].reverse() },
    });

    expect((await findCards("top")).map(cardId)).toEqual(FEATURED_IDS);
  });

  it("chooses from the catalog: a record the catalog features is shown, one it does not is not", async () => {
    const summary = testRecordsSummary();
    const records = summary.records.map((record) =>
      record.id === "team-largest-win"
        ? { ...record, featured_rank: null }
        : record.id === "player-career-games"
          ? { ...record, featured_rank: 16 }
          : record,
    );
    open("/stats/records", { summary: { ...summary, records } });

    const ids = (await findCards("top")).map(cardId);
    expect(ids).toEqual([...FEATURED_IDS.slice(0, 15), "player-career-games"]);
  });

  it("shows the old twelve-card screen no more: Top records holds records it never had", async () => {
    open();

    const ids = (await findCards("top")).map(cardId);
    expect(ids).toEqual(
      expect.arrayContaining([
        "player-threes-season",
        "player-three-pct-season",
        "player-ppg-season",
        "team-longest-win-streak",
      ]),
    );
  });
});

describe("Team and Player: the group's whole library, 24 at a time", () => {
  it("Team shows the first 24 team records in catalog order, and Load more adds the rest", async () => {
    open("/stats/records?group=team");
    const user = userEvent.setup();
    const team = recordsOf("team").map((record) => record.id);

    const cards = await findCards("team");
    expect(cards.map(cardId)).toEqual(team.slice(0, PAGE_SIZE));
    const more = loadMore();
    expect(more).not.toBeNull();
    expect(more?.tagName).toBe("BUTTON");

    await user.click(more as HTMLElement);

    await waitFor(() => expect(shownIds()).toEqual(team));
    expect(loadMore()).toBeNull();
  });

  it("Player adds 24 a click, to the whole 70", async () => {
    open("/stats/records?group=player");
    const user = userEvent.setup();
    const player = recordsOf("player").map((record) => record.id);
    expect(player).toHaveLength(70);

    await findCards("player");
    expect(shownIds()).toEqual(player.slice(0, 24));

    await user.click(loadMore() as HTMLElement);
    await waitFor(() => expect(shownIds()).toEqual(player.slice(0, 48)));

    await user.click(loadMore() as HTMLElement);
    await waitFor(() => expect(shownIds()).toEqual(player));
    expect(loadMore()).toBeNull();
  });

  it("asks once per page, with that page's ids sorted, and nothing for a page already read", async () => {
    const { stubs } = open("/stats/records?group=team");
    const user = userEvent.setup();
    const team = recordsOf("team").map((record) => record.id);
    await findCards("team");
    await settle(stubs);

    expect(stubs.holders.requests.map((r) => idsOf(r.query))).toEqual([
      sorted(team.slice(0, 24)),
    ]);

    await user.click(loadMore() as HTMLElement);
    await waitFor(() => expect(shownIds()).toEqual(team));
    await settle(stubs);
    expect(stubs.holders.requests.map((r) => idsOf(r.query))).toEqual([
      sorted(team.slice(0, 24)),
      sorted(team.slice(24)),
    ]);

    await user.click(tab(groupBar(), "Player"));
    await findCards("player");
    await settle(stubs);
    const afterPlayer = stubs.holders.requests.length;
    expect(afterPlayer).toBe(3);

    await user.click(tab(groupBar(), "Team"));
    await findCards("team");
    await user.click(loadMore() as HTMLElement);
    await waitFor(() => expect(shownIds()).toEqual(team));
    await settle(stubs);
    expect(stubs.holders.requests).toHaveLength(afterPlayer);
  });

  it("each page's holders land on its own cards", async () => {
    open("/stats/records?group=team");
    const user = userEvent.setup();
    await findCards("team");
    await user.click(loadMore() as HTMLElement);

    // team-largest-win is the team library's 26th: on the second page.
    const card = await findRecordCard("team-largest-win");
    await waitFor(() => expect(norm(card.textContent)).toMatch(/qualif/i));
    const streak = await findRecordCard("team-longest-win-streak");
    await waitFor(() => expect(norm(streak.textContent)).toMatch(/\b27\b/));
  });
});

describe("a card", () => {
  it("shows its title and its category from the catalog while its holder loads", async () => {
    open("/stats/records", {
      handlers: [
        http.get("*/events/records/holders", async () => {
          await delay("infinite");
        }),
      ],
    });

    const cards = await findCards("top");
    expect(cards.map(cardId)).toEqual(FEATURED_IDS);
    for (const card of cards) {
      const record = recordDefinition(cardId(card));
      expect(
        within(card).getByRole("heading", { level: 3 }).textContent?.trim(),
      ).toBe(record.title);
      expect(
        textBesideTitle(card),
        `${record.id}'s category (${record.category}) is not on its card`,
      ).toMatch(CATEGORY_WORD[record.category]);
      expect(viewAll(card)).toHaveAttribute(
        "href",
        `/stats/records?record=${record.id}`,
      );
    }
    expect(screen.getByRole("main").textContent).not.toMatch(MISSING);
  });

  it("tells the two Most championships cards apart by their category", async () => {
    open();

    const team = await findRecordCard("team-championships");
    const player = await findRecordCard("player-championships");
    expect(textBesideTitle(team)).toMatch(/franchise/i);
    expect(textBesideTitle(player)).toMatch(/playoff/i);
  });

  it("keeps its holder's room with the same held class while loading and after the holder lands", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const summary = testRecordsSummary();
    open("/stats/records", {
      handlers: [
        http.get("*/events/records/holders", async ({ request }) => {
          await gate;
          const ids = idsOf(new URL(request.url).searchParams);
          return HttpResponse.json({
            holders: Object.fromEntries(
              ids.map((id) => [
                id,
                summary.records.find((record) => record.id === id)?.holder ??
                  null,
              ]),
            ),
          });
        }),
      ],
    });

    const loading = await findRecordCard("team-best-season");
    const whileLoading = heldClasses(loading);
    expect(
      [...whileLoading],
      "no element of a loading card keeps a min-height",
    ).not.toEqual([]);

    release();
    await waitFor(() => expect(norm(loading.textContent)).toContain("73–9"));
    const landed = await findRecordCard("team-best-season");
    const afterLanding = heldClasses(landed);
    expect(
      [...whileLoading].filter((name) => afterLanding.has(name)),
      "the held area is gone once the holder lands",
    ).not.toEqual([]);
  });

  it.each([
    ["top", "/stats/records"],
    ["team", "/stats/records?group=team"],
    ["top", "/stats/records?q=3pt"],
  ])(
    "on the %s list at %s, has exactly one tab stop, View all, named with its title, at its record",
    async (bar, path) => {
      open(path);

      await findCardList(bar as RecordsBar);
      await waitFor(() => expect(shownCards().length).toBeGreaterThan(0));
      for (const card of shownCards()) {
        const id = cardId(card);
        expect(card.querySelectorAll(FOCUSABLE)).toHaveLength(1);
        expect(within(card).getAllByRole("link")).toHaveLength(1);
        expect(within(card).queryAllByRole("button")).toEqual([]);
        expect(viewAll(card)).toHaveAttribute(
          "href",
          `/stats/records?record=${id}`,
        );
        expect(viewAll(card)).toHaveAccessibleName(
          new RegExp(recordDefinition(id).title),
        );
      }
    },
  );

  it("opens its record's list, pushing ?record=<id>", async () => {
    const { router } = open();
    const user = userEvent.setup();

    await user.click(viewAll(await findRecordCard("player-ppg-season")));

    await waitFor(() =>
      expect(params(router).get("record")).toBe("player-ppg-season"),
    );
    expect(router.state.historyAction).toBe("PUSH");
    await screen.findByRole("heading", {
      level: 2,
      name: recordDefinition("player-ppg-season").title,
    });
    await within(screen.getByRole("main")).findByRole("table");
  });
});

describe("a failed holders read", () => {
  it("shows one alert and keeps every card's title and link", async () => {
    const { stubs } = open();
    stubs.holders.fail();

    const cards = await findCards("top");
    await waitFor(() => expect(alerts()).toHaveLength(1));
    expect(cards.map(cardId)).toEqual(FEATURED_IDS);
    for (const card of shownCards()) {
      expect(within(card).getByRole("heading", { level: 3 })).toBeVisible();
      expect(viewAll(card)).toBeVisible();
    }
    expect(screen.getByRole("main").textContent).not.toMatch(MISSING);
  });

  it("is one alert for its own page: a later page that answers adds none", async () => {
    open("/stats/records?group=team", {
      handlers: [
        http.get(
          "*/events/records/holders",
          () =>
            HttpResponse.json(
              { detail: "Internal Server Error" },
              { status: 500 },
            ),
          { once: true },
        ),
      ],
    });
    const user = userEvent.setup();
    const team = recordsOf("team").map((record) => record.id);

    await findCards("team");
    await waitFor(() => expect(alerts()).toHaveLength(1));

    await user.click(loadMore() as HTMLElement);
    const streak = await findRecordCard("team-longest-win-streak");
    expect(team.indexOf("team-longest-win-streak")).toBeLessThan(24);
    const largest = await findRecordCard("team-largest-win");
    await waitFor(() => expect(norm(largest.textContent)).toMatch(/qualif/i));
    expect(alerts()).toHaveLength(1);
    expect(shownIds()).toEqual(team);
    // The failed page's cards keep their titles and links.
    expect(within(streak).getByRole("heading", { level: 3 })).toBeVisible();
    expect(viewAll(streak)).toBeVisible();
  });

  it("is one alert per failed page", async () => {
    const { stubs } = open("/stats/records?group=team");
    stubs.holders.fail();
    const user = userEvent.setup();

    await findCards("team");
    await waitFor(() => expect(alerts()).toHaveLength(1));

    await user.click(loadMore() as HTMLElement);
    await waitFor(() => expect(alerts()).toHaveLength(2));
    expect(shownIds()).toEqual(recordsOf("team").map((record) => record.id));
  });
});

// ------------------------------------------------------------ the search

describe("the search: what matches", () => {
  it("'3pt season' finds the season threes records, team and player", async () => {
    open();
    await findCards("top");

    await typeQuery("3pt season");

    await waitFor(() =>
      expect(sorted(shownIds())).toEqual(sorted(searchIds("3pt season"))),
    );
    expect(shownIds()).toEqual(
      expect.arrayContaining([
        "team-most-threes-season",
        "team-three-pct-season",
        "player-threes-season",
        "player-three-pct-season",
      ]),
    );
  });

  it("ignores case and extra whitespace", async () => {
    open();
    await findCards("top");

    await typeQuery("  3PT   Season ");

    await waitFor(() =>
      expect(sorted(shownIds())).toEqual(sorted(searchIds("3pt season"))),
    );
  });

  it("needs every term: '3pt playoffs career' is the one record holding all three", async () => {
    open();
    await findCards("top");

    await typeQuery("3pt playoffs career");

    await waitFor(() =>
      expect(shownIds()).toEqual(["player-playoff-career-threes"]),
    );
  });

  it.each([
    // Each term is found in one field only.
    [
      "the title",
      "longest",
      ["team-longest-win-streak", "team-longest-losing-streak"],
    ],
    ["the keywords", "rings", ["team-championships", "player-championships"]],
    [
      "the unit",
      "fg%",
      [
        "team-field-goal-pct-season",
        "player-field-goal-pct-game",
        "player-field-goal-pct-season",
        "player-career-field-goal-pct",
      ],
    ],
  ])("finds a term held only by %s ('%s')", async (_field, query, expected) => {
    expect(sorted(searchIds(query))).toEqual(sorted(expected));
    open();
    await findCards("top");

    await typeQuery(query);

    await waitFor(() => expect(sorted(shownIds())).toEqual(sorted(expected)));
  });

  it("finds a term held only by the category ('player-playoffs')", async () => {
    const expected = recordsOf("player")
      .filter((record) => record.category === "player-playoffs")
      .map((record) => record.id);
    expect(expected).toHaveLength(14);
    open("/stats/records?q=player-playoffs");

    await waitFor(() => expect(shownIds()).toEqual(expected));
  });

  it("finds a term held only by the group ('team' on Top records is every team record, 24 at a time)", async () => {
    const team = recordsOf("team").map((record) => record.id);
    expect(sorted(searchIds("team"))).toEqual(sorted(team));
    open("/stats/records?q=team");

    await waitFor(() => expect(shownIds()).toHaveLength(PAGE_SIZE));
    expect(shownIds().every((id) => team.includes(id))).toBe(true);
    expect(loadMore()).not.toBeNull();
  });

  it.each(["per game", "rebounds game", "pts", "3pt", "points"])(
    "agrees with the reference for '%s'",
    async (query) => {
      const expected = searchIds(query);
      expect(expected.length).toBeLessThanOrEqual(PAGE_SIZE);
      open(`/stats/records?q=${encodeURIComponent(query)}`);

      await waitFor(() => expect(sorted(shownIds())).toEqual(sorted(expected)));
      expect(loadMore()).toBeNull();
    },
  );
});

describe("the search: where it looks", () => {
  it("on Top records, searches the whole library, not only the sixteen", async () => {
    open();
    await findCards("top");

    await typeQuery("3pt");

    await waitFor(() =>
      expect(sorted(shownIds())).toEqual(sorted(searchIds("3pt"))),
    );
    expect(shownIds()).toContain("team-most-threes-game");
    expect(FEATURED_IDS).not.toContain("team-most-threes-game");
  });

  it.each(["team", "player"] as const)(
    "on %s, searches that group only",
    async (group) => {
      open(`/stats/records?group=${group}`);
      await findCards(group);

      await typeQuery("3pt");

      await waitFor(() =>
        expect(sorted(shownIds())).toEqual(sorted(searchIds("3pt", group))),
      );
      expect(shownIds().every((id) => id.startsWith(`${group}-`))).toBe(true);
      expect(searchIds("3pt", group).length).toBeLessThan(
        searchIds("3pt").length,
      );
    },
  );

  it("pages a long result 24 at a time: 'player' on Top records is the 70 player records", async () => {
    open("/stats/records?q=player");
    const user = userEvent.setup();
    const expected = searchIds("player");
    expect(expected).toHaveLength(70);

    await waitFor(() => expect(shownIds()).toHaveLength(24));
    await user.click(loadMore() as HTMLElement);
    await waitFor(() => expect(shownIds()).toHaveLength(48));
    await user.click(loadMore() as HTMLElement);
    await waitFor(() => expect(shownIds()).toHaveLength(70));
    expect(sorted(shownIds())).toEqual(sorted(expected));
    expect(loadMore()).toBeNull();
  });

  it("filters in the browser: typing asks for the catalog never again, and makes at most one holders read", async () => {
    const { stubs } = open();
    await findCards("top");
    await settle(stubs);
    const catalog = stubs.summary.requests.length;
    const holders = stubs.holders.requests.length;
    expect(catalog).toBe(1);

    await typeQuery("3pt season");
    await waitFor(() =>
      expect(sorted(shownIds())).toEqual(sorted(searchIds("3pt season"))),
    );
    await settle(stubs);

    expect(stubs.summary.requests).toHaveLength(catalog);
    const typed = stubs.holders.requests.slice(holders);
    expect(
      typed.length,
      typed.map((r) => r.query.toString()).join("\n"),
    ).toBeLessThanOrEqual(1);
    for (const request of typed)
      expect(idsOf(request.query)).toEqual(sorted(searchIds("3pt season")));
    expect(stubs.list.requests).toEqual([]);
  });
});

describe("the search: the query is the URL", () => {
  it("writes ?q= with replace, adding no history entry", async () => {
    const { router } = open();
    await findCards("top");
    const pushes = countPushes(router);

    await typeQuery("3pt season");

    await waitFor(() => expect(params(router).get("q")).toBe("3pt season"));
    expect(pushes()).toBe(0);
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("drops q when the box is cleared", async () => {
    const { router } = open("/stats/records?q=3pt");
    const user = userEvent.setup();
    await waitFor(() => expect(searchBox()).toHaveValue("3pt"));

    await user.clear(searchBox());

    await waitFor(() => expect(params(router).has("q")).toBe(false));
    expect(router.state.location.search).toBe("");
    await waitFor(() => expect(shownIds()).toEqual(FEATURED_IDS));
  });

  it("restores the box and its results from ?q= (a reload or a shared link)", async () => {
    open("/stats/records?q=3pt%20season");

    await waitFor(() => expect(searchBox()).toHaveValue("3pt season"));
    await waitFor(() =>
      expect(sorted(shownIds())).toEqual(sorted(searchIds("3pt season"))),
    );
    expect(selectedTab(groupBar())).toBe("Top records");
  });

  it("restores a group's search from ?group=player&q=", async () => {
    open("/stats/records?group=player&q=3pt");

    await waitFor(() => expect(searchBox()).toHaveValue("3pt"));
    expect(selectedTab(groupBar())).toBe("Player");
    await waitFor(() =>
      expect(sorted(shownIds())).toEqual(sorted(searchIds("3pt", "player"))),
    );
  });

  it("keeps q when the bar changes group, and searches the new group", async () => {
    const { router } = open("/stats/records?q=3pt");
    const user = userEvent.setup();
    await waitFor(() => expect(shownIds().length).toBeGreaterThan(0));

    await user.click(tab(groupBar(), "Team"));

    await waitFor(() => expect(params(router).get("group")).toBe("team"));
    expect(params(router).get("q")).toBe("3pt");
    expect(searchBox()).toHaveValue("3pt");
    await waitFor(() =>
      expect(sorted(shownIds())).toEqual(sorted(searchIds("3pt", "team"))),
    );
  });

  it("drops q when the view switches to Seasonal, and Historical comes back empty", async () => {
    const { router } = open("/stats/records?group=team&q=3pt");
    const user = userEvent.setup();
    await waitFor(() => expect(shownIds().length).toBeGreaterThan(0));

    await user.click(tab(viewBar(), "Seasonal"));

    await waitFor(() => expect(params(router).get("view")).toBe("seasonal"));
    expect(params(router).has("q")).toBe(false);
    expect(params(router).has("group")).toBe(false);

    await user.click(tab(viewBar(), "Historical"));
    await findCards("top");
    expect(searchBox()).toHaveValue("");
    expect(shownIds()).toEqual(FEATURED_IDS);
  });

  it("opens a result's record with a push, and the browser's Back restores the query", async () => {
    const { router } = open("/stats/records?q=3pt%20season");
    const user = userEvent.setup();

    await user.click(viewAll(await findRecordCard("player-three-pct-season")));

    await waitFor(() =>
      expect(params(router).get("record")).toBe("player-three-pct-season"),
    );
    expect(router.state.historyAction).toBe("PUSH");
    expect(params(router).has("q")).toBe(false);

    await router.navigate(-1);

    await waitFor(() => expect(searchBox()).toHaveValue("3pt season"));
    expect(params(router).get("q")).toBe("3pt season");
    await waitFor(() =>
      expect(sorted(shownIds())).toEqual(sorted(searchIds("3pt season"))),
    );
  });

  it("still opens an old ?group=player address on Player's first page", async () => {
    open("/stats/records?group=player");
    expect((await findCards("player")).map(cardId)).toEqual(
      recordsOf("player")
        .slice(0, 24)
        .map((record) => record.id),
    );
  });
});

describe("no match", () => {
  it("shows an empty state naming the query, with a button that clears it, and asks for no holders", async () => {
    const { router, stubs } = open();
    const user = userEvent.setup();
    await findCards("top");
    await settle(stubs);
    const holders = stubs.holders.requests.length;

    await typeQuery("zzqx");

    await waitFor(() => expect(shownCards()).toEqual([]));
    const panel = panelOf(groupBar());
    await waitFor(() => expect(norm(panel.textContent)).toContain("zzqx"));
    const clear = within(panel).getByRole("button", { name: /clear/i });
    await settle(stubs);
    expect(stubs.holders.requests).toHaveLength(holders);
    expect(panel.textContent).not.toMatch(MISSING);

    await user.click(clear);

    await waitFor(() => expect(params(router).has("q")).toBe(false));
    expect(searchBox()).toHaveValue("");
    await waitFor(() => expect(shownIds()).toEqual(FEATURED_IDS));
  });

  it("names the query on a cold ?q= too", async () => {
    open("/stats/records?group=team&q=zzqx");

    await waitFor(() =>
      expect(norm(panelOf(groupBar()).textContent)).toContain("zzqx"),
    );
    expect(queryCardList() === null || shownCards().length === 0).toBe(true);
    expect(
      within(panelOf(groupBar())).getByRole("button", { name: /clear/i }),
    ).toBeVisible();
  });
});

describe("the count, announced", () => {
  /** The polite live regions in the Historical panel. */
  function politeRegions(): HTMLElement[] {
    return Array.from(
      panelOf(viewBar()).querySelectorAll<HTMLElement>(
        '[aria-live="polite"], [role="status"]',
      ),
    ).filter((region) => region.getAttribute("aria-live") !== "assertive");
  }

  /** The polite region whose text counts records, or undefined. */
  function countRegion(): HTMLElement | undefined {
    return politeRegions().find((region) =>
      /\d[\d,]*\s+records?\b/i.test(norm(region.textContent)),
    );
  }

  it("says how many records match, politely, from a region in place before the first keystroke", async () => {
    open();
    await findCards("top");
    const before = new Set(politeRegions());

    await typeQuery("3pt season");

    const expected = searchIds("3pt season").length;
    await waitFor(() =>
      expect(norm(countRegion()?.textContent)).toMatch(
        new RegExp(`\\b${expected}\\s+records?\\b`, "i"),
      ),
    );
    expect(before.has(countRegion() as HTMLElement)).toBe(true);
  });

  it("counts every match, not the page shown", async () => {
    open("/stats/records?q=player");

    await waitFor(() => expect(shownIds()).toHaveLength(24));
    await waitFor(() =>
      expect(norm(countRegion()?.textContent)).toMatch(/\b70\s+records\b/i),
    );
  });

  it("is debounced: a ten-character query changes what it says at most twice", async () => {
    open();
    await findCards("top");
    const said: string[] = [];
    const observer = new MutationObserver(() => {
      const text = norm(countRegion()?.textContent);
      if (text !== "" && said[said.length - 1] !== text) said.push(text);
    });
    observer.observe(panelOf(viewBar()), {
      subtree: true,
      childList: true,
      characterData: true,
    });

    await typeQuery("3pt season");
    await waitFor(() =>
      expect(norm(countRegion()?.textContent)).toMatch(
        new RegExp(`\\b${searchIds("3pt season").length}\\s+records?\\b`, "i"),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
    observer.disconnect();

    expect(said.length, said.join(" | ")).toBeLessThanOrEqual(2);
  });
});

describe("nothing prints null, undefined or NaN", () => {
  it.each([
    ["top", "/stats/records"],
    ["team", "/stats/records?group=team"],
    ["player", "/stats/records?group=player"],
    ["top", "/stats/records?q=3pt"],
  ] as const)("on the %s list at %s", async (bar, path) => {
    open(path);
    await findCardList(bar);

    await waitFor(() => expect(shownCards().length).toBeGreaterThan(0));
    await waitFor(() =>
      expect(screen.getByRole("main").textContent).not.toMatch(/loading/i),
    );
    expect(screen.getByRole("main").textContent).not.toMatch(MISSING);
  });
});
