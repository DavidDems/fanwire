/**
 * FRONTEND-019 criterion 5: Records > Seasonal, the season's leaders, moved
 * here from the Seasons tab (the human, 2026-10-24: never a deploy without
 * them). Through the real route table.
 *
 * The leaders tests are `SeasonsTab.test.tsx`'s FRONTEND-009 criterion 4
 * tests, moved with what they test and otherwise unchanged.
 *
 * FRONTEND-043 replaced the season's three leader tables with eleven cards
 * (`SeasonalCards.test.tsx`): this file now waits on the cards and counts
 * `GET .../leader-boards`, and its "leaders" describe (the three tables, their
 * requests, the rule line and the table contract) was deleted, each test
 * replaced there.
 *
 * The interface this file pins:
 *
 * - `/stats/records?view=seasonal` selects Seasonal; its panel holds, in
 *   order, a native select named "Season" (`GET /events/seasons`, newest
 *   first, the newest selected by default and **not** written), an `h2`
 *   "<season> leaders", and the season's leader cards (FRONTEND-043: a grid
 *   of eleven cards, `StatsNav.module.css`'s `.cards`, from one
 *   `GET .../leader-boards` read).
 * - A picked season is `?season=` (kept beside `view=seasonal`), and a page
 *   opened at `?season=` shows that season.
 * - No Team / Player bar, no Historical record cards, and no teams read.
 * - Nothing prints null, undefined or NaN.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";

import nav from "../../components/stats-nav/StatsNav.module.css";
import { BOARD_ORDER } from "../../test/leader-boards";
import {
  MISSING,
  openRecords,
  panelOf,
  params,
  queryCardList,
  queryTablistHolding,
  selectedTab,
  viewBar,
} from "../../test/records-screen";
import { NEWEST_SEASON, TEST_SEASON_LIST, type Stub } from "../../test/stats";

// The Director's correction (FRONTEND-019): the Records tab is a lazy route,
// and the first test of a file to open it waited on the cold transform of its
// chunk (RecordsTab and the shared navigator), which overran findBy's 1 s
// under the full suite's load. Importing it once here does that work outside
// any test; no assertion changes.
beforeAll(async () => {
  await import("./RecordsTab");
}, 30_000);

function seasonSelect(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: "Season" }) as HTMLSelectElement;
}

function seasonsAsked(stub: Stub): string[] {
  return stub.requests.map((request) => request.path.season);
}

/**
 * FRONTEND-043 changed this wait, which was for the "Leaders" region and its
 * three tables: the season's grid of eleven leader cards.
 */
async function leadersShown(): Promise<HTMLElement> {
  let grid: HTMLElement | undefined;
  await waitFor(() => {
    const grids = [
      ...panelOf(viewBar()).querySelectorAll<HTMLElement>(`.${nav.cards}`),
    ];
    expect(grids).toHaveLength(1);
    grid = grids[0];
    expect(
      [...grid.children].filter((child) => child.tagName === "LI"),
    ).toHaveLength(BOARD_ORDER.length);
  });
  return grid as HTMLElement;
}

describe("the Seasonal view", () => {
  it("opens on ?view=seasonal: the season select, then '<season> leaders', then the Leaders, in its panel", async () => {
    const { router } = openRecords("/stats/records?view=seasonal");

    const leaders = await leadersShown();
    expect(selectedTab(viewBar())).toBe("Seasonal");
    const select = seasonSelect();
    const heading = screen.getByRole("heading", {
      level: 2,
      name: `${NEWEST_SEASON} leaders`,
    });
    const panel = panelOf(viewBar());
    for (const part of [select, heading, leaders])
      expect(panel.contains(part)).toBe(true);
    expect(
      select.compareDocumentPosition(heading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      heading.compareDocumentPosition(leaders) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(params(router).has("season")).toBe(false);
  });

  it("lists GET /events/seasons newest first, the newest selected", async () => {
    const { stubs } = openRecords("/stats/records?view=seasonal");

    await leadersShown();
    expect(
      within(seasonSelect())
        .getAllByRole("option")
        .map((option) => option.textContent?.trim()),
    ).toEqual(TEST_SEASON_LIST);
    expect(seasonSelect().value).toBe(NEWEST_SEASON);
    // FRONTEND-043: the season's one read is GET .../leader-boards.
    expect(new Set(seasonsAsked(stubs.leaderBoards))).toEqual(
      new Set([NEWEST_SEASON]),
    );
  });

  it("honours ?season= on load: that season selected, and only it asked for", async () => {
    const { stubs } = openRecords(
      "/stats/records?view=seasonal&season=2023-24",
    );

    await leadersShown();
    await waitFor(() => expect(seasonSelect().value).toBe("2023-24"));
    expect(
      screen.getByRole("heading", { level: 2, name: "2023-24 leaders" }),
    ).toBeVisible();
    expect(new Set(seasonsAsked(stubs.leaderBoards))).toEqual(
      new Set(["2023-24"]),
    );
  });

  it("keeps a picked season in the URL beside view=seasonal, and shows its leaders", async () => {
    const { stubs, router } = openRecords("/stats/records?view=seasonal");
    const user = userEvent.setup();
    await leadersShown();

    await user.selectOptions(seasonSelect(), "2022-23");

    await waitFor(() => expect(params(router).get("season")).toBe("2022-23"));
    expect(params(router).get("view")).toBe("seasonal");
    expect(
      await screen.findByRole("heading", { level: 2, name: "2022-23 leaders" }),
    ).toBeVisible();
    await waitFor(() =>
      expect(seasonsAsked(stubs.leaderBoards)).toContain("2022-23"),
    );
  });

  // FRONTEND-043 changed this test, "shows no Team / Player bar and no
  // cards": Seasonal has cards of its own now, so it is the Historical
  // record cards (a list named "Top records", "Team records" or "Player
  // records") that are not shown.
  it("shows no Team / Player bar and no Historical record cards", async () => {
    openRecords("/stats/records?view=seasonal");

    await leadersShown();
    expect(queryTablistHolding("Player")).toBeNull();
    expect(queryCardList()).toBeNull();
  });

  // Kept from the deleted leaders describe below: it is not about tables.
  it("never prints null, undefined or NaN", async () => {
    openRecords("/stats/records?view=seasonal");

    await leadersShown();
    expect(screen.getByRole("main").textContent).not.toMatch(MISSING);
  });
});

// FRONTEND-043 deleted the describe "the leaders (moved from Seasons,
// FRONTEND-009 criterion 4)" that stood here: its tests pinned the
// three leader tables the unit replaces with cards. Each is replaced in
// `SeasonalCards.test.tsx`: the points, rebounds and assists requests by one
// leader-boards read; the three tables by the cards' top three and View
// all's dialog table (its caption, scopes and scroll region there); the rule
// line and a different season's rule by "the qualifier above the cards".
// "never prints null, undefined or NaN" moved up, unchanged.
