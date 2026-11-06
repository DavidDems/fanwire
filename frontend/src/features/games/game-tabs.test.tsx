/**
 * FRONTEND-037: the game page's team links and team tabs, through the real
 * route table (`renderAppAt`), with the detail from msw.
 *
 * The interface this file pins:
 *
 * - **Team links in the heading.** The one `h1` holds two links, one per team,
 *   each to that team's Stats > Seasons page: `/stats/seasons?season=<s>&team=
 *   <team id>` when the page's address carries `?season=<s>`, else
 *   `/stats/seasons?team=<team id>` (no season: the Seasons tab's default).
 *   The game's own path stays `/games/<id>`.
 * - **No result sentence.** "Final: <team> won, 117–109" is gone.
 * - **Team tabs.** A `tablist` named "Team box scores" with two tabs, each
 *   named exactly "<short name> <score>" ("Raptors 117", "Suns 109"). The
 *   winner is the first tab and starts selected (`aria-selected="true"`). A
 *   tie, or a 0-0 game not yet played, puts the home team first and selected.
 *   A `?line=<line_id>` naming a player line of the other team starts on that
 *   team instead, so the marked row is visible; the order does not change.
 * - **One box score at a time.** The `tabpanel` (linked to its tab) shows the
 *   selected team's box score; the other team's players are not shown. A
 *   click on the other tab, or ArrowRight / ArrowLeft from the selected one,
 *   switches it. The line score, the date and the venue stay.
 * - **No extra reads.** Still one `GET /events/games/{id}`, and no team-season
 *   read, with or without a season in the address.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderAppAt } from "../../test/app-route";
import { attachGameDetail } from "../../test/attach";
import {
  TEST_AWAY_TEAM,
  TEST_HOME_TEAM,
  gameDetailStub,
  testGameDetail,
  type GameDetailOut,
} from "../../test/games";
import { server } from "../../test/server";

const originalScrollIntoView = Element.prototype.scrollIntoView;
let sent: string[] = [];

function record({ request }: { request: Request }): void {
  sent.push(new URL(request.url).pathname);
}

beforeEach(() => {
  // jsdom has no scrollIntoView; a `?line=` row calls it.
  Element.prototype.scrollIntoView = vi.fn();
  sent = [];
  server.events.on("request:start", record);
});

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
  server.events.removeListener("request:start", record);
});

async function openGame(path: string, game: GameDetailOut = testGameDetail()) {
  const stub = gameDetailStub([game]);
  const rendered = renderAppAt(path, "anonymous", [stub.handler]);
  const heading = await screen.findByRole("heading", {
    level: 1,
    name: new RegExp(game.home_team.name),
  });
  return { ...rendered, stub, heading, user: userEvent.setup() };
}

function main(): HTMLElement {
  return screen.getByRole("main");
}

function tablist(): HTMLElement {
  return within(main()).getByRole("tablist", { name: "Team box scores" });
}

function tabs(): HTMLElement[] {
  return within(tablist()).getAllByRole("tab");
}

function selected(): HTMLElement {
  const found = tabs().filter(
    (tab) => tab.getAttribute("aria-selected") === "true",
  );
  expect(found, "exactly one selected tab").toHaveLength(1);
  return found[0];
}

function panel(): HTMLElement {
  return within(main()).getByRole("tabpanel");
}

function href(link: HTMLElement): URL {
  return new URL(link.getAttribute("href") ?? "", "http://x.test");
}

/** A player's name link, if the page shows it. */
function playerShown(name: string): HTMLElement | null {
  return within(main()).queryByRole("link", { name });
}

const AWAY_WINS = {
  home_score: 101,
  away_score: 112,
  home_line_score: [25, 25, 26, 25],
  away_line_score: [28, 30, 27, 27],
};

describe("the heading links each team to its Stats season page", () => {
  it("carries the address's season into both team links", async () => {
    const { heading } = await openGame("/games/501?season=2023-24");

    const links = within(heading).getAllByRole("link");
    expect(links).toHaveLength(2);
    const byTeam = new Map(
      links.map((link) => [href(link).searchParams.get("team"), href(link)]),
    );
    for (const team of [TEST_AWAY_TEAM, TEST_HOME_TEAM]) {
      const target = byTeam.get(String(team.id));
      expect(target, `a link for ${team.name}`).toBeDefined();
      expect(target?.pathname).toBe("/stats/seasons");
      expect(target?.searchParams.get("season")).toBe("2023-24");
    }
    // Each link is named for its own team.
    for (const link of links) {
      const team =
        href(link).searchParams.get("team") === String(TEST_HOME_TEAM.id)
          ? TEST_HOME_TEAM
          : TEST_AWAY_TEAM;
      expect(link).toHaveAccessibleName(
        new RegExp(team.name.split(" ").slice(-1)[0]),
      );
    }
  });

  it("writes no season into the team links of a direct game address", async () => {
    const { heading } = await openGame("/games/501");

    const links = within(heading).getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links.map((link) => href(link).search).sort()).toEqual(
      [`?team=${TEST_AWAY_TEAM.id}`, `?team=${TEST_HOME_TEAM.id}`].sort(),
    );
    for (const link of links)
      expect(href(link).pathname).toBe("/stats/seasons");
  });

  it("keeps the game's own path, and a team link opens that team with the season", async () => {
    const { heading, router, user } = await openGame(
      "/games/501?season=2023-24",
    );
    expect(router.state.location.pathname).toBe("/games/501");

    const away = within(heading)
      .getAllByRole("link")
      .find(
        (link) =>
          href(link).searchParams.get("team") === String(TEST_AWAY_TEAM.id),
      );
    if (away === undefined) throw new Error("no link for the away team");
    await user.click(away);

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/stats/seasons"),
    );
    const search = new URLSearchParams(router.state.location.search);
    expect(search.get("season")).toBe("2023-24");
    expect(search.get("team")).toBe(String(TEST_AWAY_TEAM.id));
  });
});

describe("the result sentence is replaced by two team tabs", () => {
  it("drops the spelled-out final-score sentence", async () => {
    await openGame("/games/501");

    expect(main().textContent).not.toMatch(/Final:/);
    expect(main().textContent).not.toMatch(/\bwon,/);
  });

  it("names each tab by short name and score, the winner first and selected", async () => {
    await openGame("/games/501");

    const [first, second] = tabs();
    expect(tabs()).toHaveLength(2);
    expect(first).toHaveAccessibleName("Raptors 117");
    expect(second).toHaveAccessibleName("Suns 109");
    expect(selected()).toBe(first);
    expect(second).toHaveAttribute("aria-selected", "false");
  });

  it("puts an away winner first and selected", async () => {
    await openGame("/games/501", testGameDetail(AWAY_WINS));

    expect(tabs()).toHaveLength(2);
    expect(tabs()[0]).toHaveAccessibleName("Suns 112");
    expect(tabs()[1]).toHaveAccessibleName("Raptors 101");
    expect(selected()).toBe(tabs()[0]);
    expect(
      within(panel()).getByRole("link", { name: "Devin Booker" }),
    ).toBeVisible();
    expect(playerShown("Scottie Barnes")).toBeNull();
  });

  it.each([
    ["a tie", { home_score: 110, away_score: 110 }, "Raptors 110", "Suns 110"],
    [
      "a game not yet played (0-0)",
      {
        home_score: 0,
        away_score: 0,
        home_line_score: null,
        away_line_score: null,
      },
      "Raptors 0",
      "Suns 0",
    ],
  ] as const)(
    "puts the home team first and selected for %s",
    async (_case, overrides, home, away) => {
      await openGame("/games/501", testGameDetail(overrides));

      expect(tabs()[0]).toHaveAccessibleName(home);
      expect(tabs()[1]).toHaveAccessibleName(away);
      expect(selected()).toBe(tabs()[0]);
    },
  );

  it("starts on the team of a ?line= player line, keeping the order, with the row shown", async () => {
    // attachGameDetail gives every line its own id: Booker (away) is 80011.
    const game = attachGameDetail();
    const booker = game.away_box_score.players.find(
      (player) => player.last_name === "Booker",
    );
    if (booker === undefined) throw new Error("the fixture has no Booker");
    await openGame(`/games/501?line=${booker.line_id}`, game);

    expect(tabs()[0]).toHaveAccessibleName("Raptors 117");
    expect(tabs()[1]).toHaveAccessibleName("Suns 109");
    expect(selected()).toBe(tabs()[1]);
    const link = within(panel()).getByRole("link", { name: "Devin Booker" });
    expect(link).toBeVisible();
    await waitFor(() =>
      expect(link.closest("tr")).toHaveAttribute("aria-current", "true"),
    );
  });

  it("keeps the winner selected for a ?line= of the winning team", async () => {
    const game = attachGameDetail();
    const barnes = game.home_box_score.players.find(
      (player) => player.last_name === "Barnes",
    );
    if (barnes === undefined) throw new Error("the fixture has no Barnes");
    await openGame(`/games/501?line=${barnes.line_id}`, game);

    expect(selected()).toBe(tabs()[0]);
    expect(
      within(panel()).getByRole("link", { name: "Scottie Barnes" }),
    ).toBeVisible();
  });
});

describe("the tab panel shows one team's box score at a time", () => {
  it("is the selected tab's panel, with only that team's players", async () => {
    await openGame("/games/501");

    const tab = selected();
    const shown = panel();
    expect(tab.getAttribute("aria-controls")).toBe(shown.id);
    expect(shown.id).not.toBe("");
    expect(
      within(shown).getByRole("link", { name: "Scottie Barnes" }),
    ).toBeVisible();
    expect(playerShown("Devin Booker")).toBeNull();
    expect(within(shown).getAllByRole("table")).toHaveLength(1);
  });

  it("switches team on a click of the other tab", async () => {
    const { user } = await openGame("/games/501");

    await user.click(tabs()[1]);

    expect(selected()).toBe(tabs()[1]);
    expect(
      within(panel()).getByRole("link", { name: "Devin Booker" }),
    ).toBeVisible();
    expect(playerShown("Scottie Barnes")).toBeNull();
  });

  it("switches team with ArrowRight and back with ArrowLeft, keeping one tab stop", async () => {
    const { user } = await openGame("/games/501");

    tabs()[0].focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(selected()).toBe(tabs()[1]));
    expect(document.activeElement).toBe(tabs()[1]);
    expect(playerShown("Devin Booker")).not.toBeNull();

    await user.keyboard("{ArrowLeft}");
    await waitFor(() => expect(selected()).toBe(tabs()[0]));
    expect(document.activeElement).toBe(tabs()[0]);
    expect(playerShown("Scottie Barnes")).not.toBeNull();
    expect(
      tabs().filter((tab) => tab.getAttribute("tabindex") !== "-1"),
    ).toHaveLength(1);
  });

  it("keeps the line score, the date and the venue", async () => {
    await openGame("/games/501", testGameDetail({ venue: "Scotiabank Arena" }));

    const lineScore = within(main())
      .getAllByRole("table")
      .find((table) =>
        within(table)
          .queryAllByRole("columnheader")
          .some((header) => header.textContent?.trim() === "Q1"),
      );
    expect(lineScore, "the line score").toBeDefined();
    expect(main().textContent).toMatch(/15 Jan(uary)?,? 2024/);
    expect(main().textContent).toContain("Scotiabank Arena");
  });
});

describe("the page makes no extra reads", () => {
  it.each(["/games/501", "/games/501?season=2023-24"])(
    "%s asks for the game once and no team season",
    async (path) => {
      await openGame(path);
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(
        sent
          .filter((p) => /\/events\/games\/\d+$/.test(p))
          .map((p) => p.slice(p.indexOf("/events/"))),
      ).toEqual(["/events/games/501"]);
      expect(sent.filter((p) => /\/events\/teams\/\d+\//.test(p))).toEqual([]);
    },
  );
});
