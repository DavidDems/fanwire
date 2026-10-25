/**
 * FRONTEND-009 criteria 1 and 2: the Stats page's routes and its tabs,
 * through the real route table (`renderAppAt`).
 *
 * - `/stats` redirects to `/stats/seasons`.
 * - `/stats/seasons` and `/stats/players` are public, and render one level-one
 *   "Stats" heading above a tab list (the shared `Tabs`, a `<nav>` named
 *   "Stats") with two links, Seasons and Players. The current one carries
 *   `aria-current="page"`.
 * - **The URL alone decides which tab shows.** The Seasons tab is the one with
 *   the season picker (a select named "Season"); the Players tab is the one
 *   with the player search box (a searchbox named "Search players"). Following
 *   a tab changes the address, and Back moves between them.
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
    it.each(["/stats/seasons", "/stats/players"])(
      "%s is public: one Stats heading above the two tabs",
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
          "Players",
        ]);
        expect(links[0]).toHaveAttribute("href", "/stats/seasons");
        expect(links[1]).toHaveAttribute("href", "/stats/players");
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
});
