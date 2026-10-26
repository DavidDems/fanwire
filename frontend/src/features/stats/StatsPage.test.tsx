/**
 * FRONTEND-009 criteria 1 and 2: the Stats page's routes and its tabs,
 * through the real route table (`renderAppAt`).
 *
 * - `/stats` redirects to `/stats/seasons`.
 * - `/stats/seasons`, `/stats/records` and `/stats/players` are public, and
 *   render one level-one "Stats" heading above a tab list (the shared `Tabs`,
 *   a `<nav>` named "Stats") with three links, Seasons, Records and Players
 *   (FRONTEND-019 added Records, between the two). The current one carries
 *   `aria-current="page"`.
 * - **The URL alone decides which tab shows.** The Seasons tab is the one with
 *   the season picker (a select named "Season"); the Players tab is the one
 *   with the player search box (a searchbox named "Search players"); the
 *   Records tab is the one with the Historical / Seasonal bar. Following a tab
 *   changes the address, and Back moves between them.
 *
 * The tab bodies are the other files' (`SeasonsTab.test.tsx`,
 * `PlayersTab.test.tsx`); this file only tells them apart.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderAppAt, type Visitor } from "../../test/app-route";

function tabNav(): HTMLElement {
  return screen.getByRole("navigation", { name: "Stats" });
}

async function seasonsTabShown(): Promise<void> {
  await screen.findByRole("combobox", { name: "Season" });
  expect(
    screen.queryByRole("searchbox", { name: "Search players" }),
  ).toBeNull();
}

async function recordsTabShown(): Promise<void> {
  await screen.findByRole("tab", { name: "Historical" });
  expect(
    screen.queryByRole("searchbox", { name: "Search players" }),
  ).toBeNull();
}

async function playersTabShown(): Promise<void> {
  await screen.findByRole("searchbox", { name: "Search players" });
  expect(screen.queryByRole("combobox", { name: "Season" })).toBeNull();
}

describe("/stats", () => {
  it("redirects to /stats/seasons", async () => {
    const { router } = renderAppAt("/stats", "anonymous");

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/stats/seasons"),
    );
    await seasonsTabShown();
  });
});

describe.each<Visitor>(["anonymous", "member"])(
  "the Stats page for a %s visitor",
  (as) => {
    // FRONTEND-019 changed these tests: three route tabs (Records joins
    // between Seasons and Players), and /stats/records is one more path.
    it.each(["/stats/seasons", "/stats/records", "/stats/players"])(
      "%s is public: one Stats heading above the three tabs",
      async (path) => {
        const { router } = renderAppAt(path, as);

        const headings = await screen.findAllByRole("heading", {
          level: 1,
        });
        expect(headings.map((h) => h.textContent?.trim())).toEqual(["Stats"]);
        expect(router.state.location.pathname).toBe(path);
        expect(
          screen.queryByRole("heading", { name: /^sign\s*-?\s*in$/i }),
        ).toBeNull();

        const links = within(tabNav()).getAllByRole("link");
        expect(links.map((link) => link.textContent?.trim())).toEqual([
          "Seasons",
          "Records",
          "Players",
        ]);
        expect(links[0]).toHaveAttribute("href", "/stats/seasons");
        expect(links[1]).toHaveAttribute("href", "/stats/records");
        expect(links[2]).toHaveAttribute("href", "/stats/players");
        // The heading comes before the tab list.
        expect(
          headings[0].compareDocumentPosition(tabNav()) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      },
    );
  },
);

describe("the URL decides the tab", () => {
  it("/stats/seasons shows the Seasons tab, marked current", async () => {
    renderAppAt("/stats/seasons", "anonymous");

    await seasonsTabShown();
    expect(
      within(tabNav()).getByRole("link", { name: "Seasons" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(tabNav()).getByRole("link", { name: "Players" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("/stats/records shows the Records tab, marked current", async () => {
    renderAppAt("/stats/records", "anonymous");

    await recordsTabShown();
    expect(
      within(tabNav()).getByRole("link", { name: "Records" }),
    ).toHaveAttribute("aria-current", "page");
    for (const other of ["Seasons", "Players"])
      expect(
        within(tabNav()).getByRole("link", { name: other }),
      ).not.toHaveAttribute("aria-current");
  });

  it("/stats/players shows the Players tab, marked current", async () => {
    renderAppAt("/stats/players", "anonymous");

    await playersTabShown();
    expect(
      within(tabNav()).getByRole("link", { name: "Players" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(tabNav()).getByRole("link", { name: "Seasons" }),
    ).not.toHaveAttribute("aria-current");
  });

  // FRONTEND-018 changed this test: the Seasons tab now holds one in-page
  // ARIA tablist of its own, the "Conference" bar (UI-010's SegmentedTabs).
  // The route tabs are still links, never ARIA tabs.
  it("the route tabs are not ARIA tabs: the only tablist is Seasons' Conference bar", async () => {
    renderAppAt("/stats/seasons", "anonymous");
    await seasonsTabShown();

    expect(within(tabNav()).queryAllByRole("tab")).toEqual([]);
    const tablists = await screen.findAllByRole("tablist");
    expect(tablists.map((list) => list.getAttribute("aria-label"))).toEqual([
      "Conference",
    ]);
    expect(tabNav().contains(tablists[0])).toBe(false);
  });

  it("on Records the tablists are the Historical / Seasonal and Team / Player bars, outside the route tabs", async () => {
    renderAppAt("/stats/records", "anonymous");
    await recordsTabShown();
    await screen.findByRole("tab", { name: "Player" });

    expect(within(tabNav()).queryAllByRole("tab")).toEqual([]);
    const tablists = screen.getAllByRole("tablist");
    expect(tablists).toHaveLength(2);
    expect(
      tablists.map((list) =>
        within(list)
          .getAllByRole("tab")
          .map((t) => t.textContent?.trim()),
      ),
    ).toEqual([
      ["Historical", "Seasonal"],
      ["Team", "Player"],
    ]);
    for (const list of tablists) expect(tabNav().contains(list)).toBe(false);
  });

  it("the Players tab has no ARIA tabs at all", async () => {
    renderAppAt("/stats/players", "anonymous");
    await playersTabShown();

    expect(screen.queryAllByRole("tab")).toEqual([]);
    expect(screen.queryAllByRole("tablist")).toEqual([]);
    expect(screen.queryAllByRole("tabpanel")).toEqual([]);
  });

  it("following a tab changes the address, and Back returns to the other tab", async () => {
    const { router } = renderAppAt("/stats/seasons", "anonymous");
    const user = userEvent.setup();
    await seasonsTabShown();

    await user.click(within(tabNav()).getByRole("link", { name: "Players" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/stats/players"),
    );
    await playersTabShown();

    await router.navigate(-1);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/stats/seasons"),
    );
    await seasonsTabShown();
    expect(
      within(tabNav()).getByRole("link", { name: "Seasons" }),
    ).toHaveAttribute("aria-current", "page");

    await router.navigate(1);
    await playersTabShown();
  });

  it("following the Records tab changes the address to /stats/records", async () => {
    const { router } = renderAppAt("/stats/seasons", "anonymous");
    const user = userEvent.setup();
    await seasonsTabShown();

    await user.click(within(tabNav()).getByRole("link", { name: "Records" }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/stats/records"),
    );
    await recordsTabShown();
    expect(router.state.location.search).toBe("");
  });
});
