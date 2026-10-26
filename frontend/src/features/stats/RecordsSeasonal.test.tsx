/**
 * FRONTEND-019 criterion 5: Records > Seasonal, the season's leaders, moved
 * here from the Seasons tab (the human, 2026-10-24: never a deploy without
 * them). Through the real route table.
 *
 * The leaders tests are `SeasonsTab.test.tsx`'s FRONTEND-009 criterion 4
 * tests, moved with what they test and otherwise unchanged.
 *
 * The interface this file pins:
 *
 * - `/stats/records?view=seasonal` selects Seasonal; its panel holds, in
 *   order, a native select named "Season" (`GET /events/seasons`, newest
 *   first, the newest selected by default and **not** written), an `h2`
 *   "<season> leaders", and today's Leaders section unchanged: a region named
 *   "Leaders" with the API's qualifying rule, then the points, rebounds and
 *   assists boards, one request and one table each, every leader's name a link
 *   to `/players/<id>`.
 * - A picked season is `?season=` (kept beside `view=seasonal`), and a page
 *   opened at `?season=` shows that season.
 * - No Team / Player bar, no cards, and no teams read.
 * - Every table keeps its caption, scopes and scroll region; nothing prints
 *   null, undefined or NaN.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";

import {
  MISSING,
  norm,
  openRecords,
  panelOf,
  params,
  queryTablistHolding,
  selectedTab,
  viewBar,
} from "../../test/records-screen";
import {
  NEWEST_SEASON,
  RULE_65,
  RULE_70,
  TEST_LEADERS,
  TEST_SEASON_LIST,
  type Stub,
} from "../../test/stats";
import {
  bodyRows,
  figure,
  rowText,
  tableCaptioned,
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

function seasonSelect(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: "Season" }) as HTMLSelectElement;
}

function seasonsAsked(stub: Stub): string[] {
  return stub.requests.map((request) => request.path.season);
}

async function leadersShown(): Promise<HTMLElement> {
  const leaders = await screen.findByRole("region", { name: "Leaders" });
  await waitFor(() =>
    expect(within(leaders).getAllByRole("table")).toHaveLength(3),
  );
  return leaders;
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
    expect(new Set(seasonsAsked(stubs.leaders))).toEqual(
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
    expect(new Set(seasonsAsked(stubs.leaders))).toEqual(new Set(["2023-24"]));
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
      expect(seasonsAsked(stubs.leaders)).toContain("2022-23"),
    );
  });

  it("shows no Team / Player bar and no cards", async () => {
    openRecords("/stats/records?view=seasonal");

    await leadersShown();
    expect(queryTablistHolding("Player")).toBeNull();
    expect(screen.queryByRole("list", { name: /records/i })).toBeNull();
  });
});

describe("the leaders (moved from Seasons, FRONTEND-009 criterion 4)", () => {
  it("asks for the points, rebounds and assists leaders of the season", async () => {
    const { stubs } = openRecords("/stats/records?view=seasonal");

    await waitFor(() =>
      expect(
        new Set(stubs.leaders.requests.map((r) => r.query.get("stat"))),
      ).toEqual(new Set(["points", "rebounds", "assists"])),
    );
  });

  it.each(["points", "rebounds", "assists"] as const)(
    "shows the %s leaders in a table of their own, each linking to the player",
    async (stat) => {
      openRecords("/stats/records?view=seasonal");

      const leaders = await leadersShown();
      const table = tableCaptioned(leaders, new RegExp(stat, "i"));
      const rows = bodyRows(table);
      expect(rows).toHaveLength(TEST_LEADERS[stat].length);

      TEST_LEADERS[stat].forEach((leader, index) => {
        const name = `${leader.first_name} ${leader.last_name}`;
        const link = within(rows[index]).getByRole("link", {
          name: new RegExp(name),
        });
        expect(link).toHaveAttribute("href", `/players/${leader.player_id}`);
        expect(rowText(rows[index])).toMatch(figure(leader.average.toFixed(1)));
        for (const abbreviation of leader.teams) {
          expect(rowText(rows[index])).toContain(abbreviation);
        }
      });
    },
  );

  it("shows the qualifying rule the API names, before the boards", async () => {
    openRecords("/stats/records?view=seasonal");

    const leaders = await leadersShown();
    expect(norm(leaders.textContent)).toContain(RULE_65);
    const rule = [...leaders.querySelectorAll("p")].find((p) =>
      norm(p.textContent).includes(RULE_65),
    );
    if (rule === undefined) throw new Error("no line names the rule");
    expect(
      rule.compareDocumentPosition(within(leaders).getAllByRole("table")[0]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows a different season's rule when that season's is different", async () => {
    openRecords("/stats/records?view=seasonal&season=2022-23", {
      rules: { "2022-23": RULE_70 },
    });

    const leaders = await leadersShown();
    await waitFor(() => expect(leaders.textContent).toContain(RULE_70));
    expect(leaders.textContent).not.toContain(RULE_65);
  });

  it("each table has a caption, scoped headers and its own scroll region", async () => {
    openRecords("/stats/records?view=seasonal&season=2023-24");

    await leadersShown();
    const main = screen.getByRole("main");
    expect(main.querySelectorAll("table")).toHaveLength(3);
    expect(tableProblems(main)).toEqual([]);
  });

  it("never prints null, undefined or NaN", async () => {
    openRecords("/stats/records?view=seasonal");

    await leadersShown();
    expect(screen.getByRole("main").textContent).not.toMatch(MISSING);
  });
});
