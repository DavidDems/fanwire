/**
 * FRONTEND-018: the Seasons tab rebuilt on the shared navigator, through the
 * real route table. `features/stats/SeasonsTab.tsx` is the **route adapter**:
 * the address is the state.
 *
 * The interface this file pins:
 *
 * - **Conference.** The standings sit under a `SegmentedTabs` bar named
 *   "Conference" (All / East / West). All is the default and is **not**
 *   written; East and West are `?conf=east` and `?conf=west`, so a reload, a
 *   shared link and Back keep them; an unknown `?conf=` shows All. All shows
 *   both conference tables, East and West one each.
 * - **Leaders** stay on Seasons as they were, below the standings, whatever
 *   the conference.
 * - **Team level.** Opened from a standings row (a link, as today) or the team
 *   search, at today's `?team=` address, keeping `?season=` and `?conf=`. The
 *   breadcrumb (a nav named "Stats path", an ordered list) reads season ›
 *   team name, the team's item `aria-current="location"`; a "Back" button and
 *   the breadcrumb's season item return to the season level on the conference
 *   tab it was on. The browser's Back does too.
 * - **Focus** moves to the new level's heading (tabIndex -1) on open and pop,
 *   never on a cold load.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http } from "msw";
import { describe, expect, it } from "vitest";

import { teamsAre } from "../../test/auth";
import { renderAppAt, type AppRouter } from "../../test/app-route";
import { server } from "../../test/server";
import {
  CELTICS,
  NEWEST_SEASON,
  SUNS,
  championStub,
  leadersStub,
  seasonGamesStub,
  seasonsStub,
  standingsStub,
  statsTeams,
  teamSeasonStub,
  testChampion,
} from "../../test/stats";

function openSeasons(path = "/stats/seasons") {
  const teamSeason = teamSeasonStub();
  const { router } = renderAppAt(path, "anonymous", [
    teamsAre(statsTeams()),
    seasonsStub().handler,
    championStub({ "2023-24": testChampion("2023-24") }).handler,
    standingsStub().handler,
    leadersStub().handler,
    seasonGamesStub().handler,
    teamSeason.handler,
  ]);
  return { router, teamSeason };
}

function params(router: AppRouter): URLSearchParams {
  return new URLSearchParams(router.state.location.search);
}

function conferenceTabs(): HTMLElement {
  return screen.getByRole("tablist", { name: "Conference" });
}

function selectedTab(): string {
  const tab = within(conferenceTabs())
    .getAllByRole("tab")
    .find((t) => t.getAttribute("aria-selected") === "true");
  return tab?.textContent?.trim() ?? "";
}

async function standingsCaptions(): Promise<string[]> {
  const standings = await screen.findByRole("region", { name: "Standings" });
  const tables = await within(standings).findAllByRole("table");
  return tables.map((t) => t.querySelector("caption")?.textContent ?? "");
}

function crumbs(): HTMLElement[] {
  const nav = screen.getByRole("navigation", { name: "Stats path" });
  const list = nav.querySelector("ol");
  if (list === null) throw new Error("the breadcrumb holds no ordered list");
  return within(list).getAllByRole("listitem");
}

function isCurrent(item: HTMLElement): boolean {
  return (
    item.getAttribute("aria-current") === "location" ||
    item.querySelector('[aria-current="location"]') !== null
  );
}

function controlIn(item: HTMLElement): HTMLElement {
  const control =
    within(item).queryAllByRole("link")[0] ??
    within(item).queryAllByRole("button")[0];
  if (control === undefined)
    throw new Error("the breadcrumb item is no control");
  return control;
}

function backButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: /^back\b/i });
}

function focusedHeading(): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  if (active === null || !/^H[1-6]$/.test(active.tagName)) return null;
  return active;
}

async function teamLevelShown(name: string, season: string): Promise<void> {
  await screen.findByRole("heading", { name: new RegExp(name) });
  await waitFor(() => {
    const items = crumbs();
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain(season);
    expect(items[1].textContent).toContain(name);
    expect(isCurrent(items[1])).toBe(true);
    expect(isCurrent(items[0])).toBe(false);
  });
  expect(backButton()).not.toBeNull();
  expect(screen.queryByRole("region", { name: "Standings" })).toBeNull();
}

async function clickStandingsTeam(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  const standings = await screen.findByRole("region", { name: "Standings" });
  await within(standings).findAllByRole("table");
  await user.click(
    within(standings).getByRole("link", { name: new RegExp(name) }),
  );
}

describe("the conference bar", () => {
  it("opens on All, both conferences, with ?conf= not written", async () => {
    const { router } = openSeasons();

    expect(await standingsCaptions()).toHaveLength(2);
    expect(selectedTab()).toBe("All");
    expect(
      within(conferenceTabs())
        .getAllByRole("tab")
        .map((t) => t.textContent?.trim()),
    ).toEqual(["All", "East", "West"]);
    expect(params(router).has("conf")).toBe(false);
  });

  it("East and West each show one conference and are written as ?conf=; All drops it", async () => {
    const { router } = openSeasons();
    const user = userEvent.setup();
    await standingsCaptions();

    await user.click(
      within(conferenceTabs()).getByRole("tab", { name: "East" }),
    );
    await waitFor(() => expect(params(router).get("conf")).toBe("east"));
    let shown = await standingsCaptions();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatch(/eastern/i);

    await user.click(
      within(conferenceTabs()).getByRole("tab", { name: "West" }),
    );
    await waitFor(() => expect(params(router).get("conf")).toBe("west"));
    shown = await standingsCaptions();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatch(/western/i);

    await user.click(
      within(conferenceTabs()).getByRole("tab", { name: "All" }),
    );
    await waitFor(() => expect(params(router).has("conf")).toBe(false));
    expect(await standingsCaptions()).toHaveLength(2);
  });

  it.each([
    ["east", "East", /eastern/i],
    ["west", "West", /western/i],
  ])(
    "opens on ?conf=%s (a reload or a shared link)",
    async (conf, label, caption) => {
      openSeasons(`/stats/seasons?season=2023-24&conf=${conf}`);

      const shown = await standingsCaptions();
      expect(selectedTab()).toBe(label);
      expect(shown).toHaveLength(1);
      expect(shown[0]).toMatch(caption);
    },
  );

  it("shows All for an unknown ?conf=", async () => {
    openSeasons("/stats/seasons?conf=north");

    expect(await standingsCaptions()).toHaveLength(2);
    expect(selectedTab()).toBe("All");
  });

  it("keeps the leaders below the standings, three boards, on every conference", async () => {
    openSeasons("/stats/seasons?season=2023-24&conf=east");

    const standings = await screen.findByRole("region", { name: "Standings" });
    const leaders = await screen.findByRole("region", { name: "Leaders" });
    expect(await within(leaders).findAllByRole("table")).toHaveLength(3);
    expect(
      standings.compareDocumentPosition(leaders) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(standings.contains(leaders)).toBe(false);
  });

  it("moves no focus on a cold load", async () => {
    openSeasons();

    await standingsCaptions();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("the team level from a standings row", () => {
  it("opens at ?team=, keeping ?season= and ?conf=, with the season › team breadcrumb", async () => {
    const { router, teamSeason } = openSeasons(
      "/stats/seasons?season=2023-24&conf=east",
    );
    const user = userEvent.setup();

    await clickStandingsTeam(user, CELTICS.name);

    await waitFor(() =>
      expect(params(router).get("team")).toBe(String(CELTICS.id)),
    );
    expect(params(router).get("season")).toBe("2023-24");
    expect(params(router).get("conf")).toBe("east");
    await teamLevelShown(CELTICS.name, "2023-24");
    expect(teamSeason.requests.map((r) => r.path)).toContainEqual({
      team_id: String(CELTICS.id),
      season: "2023-24",
    });
  });

  it("moves focus to the team's heading", async () => {
    openSeasons("/stats/seasons?season=2023-24");
    const user = userEvent.setup();

    await clickStandingsTeam(user, CELTICS.name);

    await waitFor(() => {
      const heading = focusedHeading();
      expect(heading, "focus is on no heading").not.toBeNull();
      expect(heading?.textContent ?? "").toContain(CELTICS.name);
      expect(heading).toHaveAttribute("tabindex", "-1");
    });
  });

  it("names the team in the focused heading before its season read lands", async () => {
    // The skeptic's second pass: the team's name is already in the cached
    // teams list, so a screen reader must never hear a "Team" placeholder.
    openSeasons("/stats/seasons?season=2023-24");
    server.use(
      http.get("*/events/teams/:team_id/seasons/:season", async () => {
        await delay("infinite");
      }),
    );
    const user = userEvent.setup();

    await clickStandingsTeam(user, CELTICS.name);

    await waitFor(() => {
      const heading = focusedHeading();
      expect(heading, "focus is on no heading").not.toBeNull();
      expect(heading?.textContent ?? "").toContain(CELTICS.name);
    });
    expect(
      within(screen.getByRole("navigation", { name: "Stats path" })).getByText(
        CELTICS.name,
      ),
    ).toBeInTheDocument();
  });

  it("Back returns to the season level on the same conference tab, focus on its heading", async () => {
    const { router } = openSeasons("/stats/seasons?season=2023-24&conf=west");
    const user = userEvent.setup();
    await clickStandingsTeam(user, SUNS.name);
    await teamLevelShown(SUNS.name, "2023-24");

    await user.click(backButton() as HTMLElement);

    await waitFor(() => expect(params(router).has("team")).toBe(false));
    expect(params(router).get("conf")).toBe("west");
    expect(params(router).get("season")).toBe("2023-24");
    const shown = await standingsCaptions();
    expect(selectedTab()).toBe("West");
    expect(shown).toHaveLength(1);
    expect(backButton()).toBeNull();
    expect(crumbs()).toHaveLength(1);
    await waitFor(() => {
      const heading = focusedHeading();
      expect(heading, "focus is on no heading").not.toBeNull();
      expect(heading?.textContent ?? "").toContain("2023-24");
      expect(heading).toHaveAttribute("tabindex", "-1");
    });
  });

  it("the breadcrumb's season item returns to the season level on the same conference tab", async () => {
    const { router } = openSeasons("/stats/seasons?season=2023-24&conf=east");
    const user = userEvent.setup();
    await clickStandingsTeam(user, CELTICS.name);
    await teamLevelShown(CELTICS.name, "2023-24");

    await user.click(controlIn(crumbs()[0]));

    await waitFor(() => expect(params(router).has("team")).toBe(false));
    expect(params(router).get("conf")).toBe("east");
    await standingsCaptions();
    expect(selectedTab()).toBe("East");
  });

  it("the browser's Back returns to the season level on the same conference tab", async () => {
    const { router } = openSeasons("/stats/seasons?season=2023-24&conf=east");
    const user = userEvent.setup();
    await clickStandingsTeam(user, CELTICS.name);
    await teamLevelShown(CELTICS.name, "2023-24");

    await router.navigate(-1);

    const shown = await standingsCaptions();
    expect(selectedTab()).toBe("East");
    expect(shown).toHaveLength(1);
    expect(params(router).has("team")).toBe(false);
  });
});

describe("the team level from the team search", () => {
  it("reads season › team in the breadcrumb, on the season shown", async () => {
    const { router } = openSeasons();
    const user = userEvent.setup();
    await standingsCaptions();

    await user.type(screen.getByRole("combobox", { name: "Team" }), "bos");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() =>
      expect(params(router).get("team")).toBe(String(CELTICS.id)),
    );
    await teamLevelShown(CELTICS.name, NEWEST_SEASON);
  });
});

describe("a reload keeps season, conference and team", () => {
  it("opens straight on the team level, and Back goes to that season and conference", async () => {
    const { router } = openSeasons(
      `/stats/seasons?season=2023-24&conf=west&team=${CELTICS.id}`,
    );
    const user = userEvent.setup();

    await teamLevelShown(CELTICS.name, "2023-24");
    expect(document.activeElement).toBe(document.body);

    await user.click(backButton() as HTMLElement);

    await waitFor(() => expect(params(router).has("team")).toBe(false));
    const shown = await standingsCaptions();
    expect(selectedTab()).toBe("West");
    expect(shown).toHaveLength(1);
    expect(
      (screen.getByRole("combobox", { name: "Season" }) as HTMLSelectElement)
        .value,
    ).toBe("2023-24");
  });
});
