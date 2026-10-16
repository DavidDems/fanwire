/**
 * FRONTEND-009 criteria 5 and 6 (the team view): the Seasons tab's team
 * search bar and the one-team view it opens, through the real route table.
 *
 * The interface this file pins:
 *
 * - **The bar is an ARIA 1.2 combobox**: an input with `role="combobox"`
 *   named "Team", `aria-expanded` false until it offers matches, and while it
 *   does, `aria-controls` naming the id of a `role="listbox"` whose options
 *   are the matching teams. The arrow keys move `aria-activedescendant`
 *   through the options (the active one `aria-selected="true"`), Enter
 *   chooses the active option, Escape closes the list without choosing, and
 *   a click on an option chooses it.
 * - **Matching is client-side**, over the one `GET /events/teams` answer:
 *   case-insensitive, on the team's name or its abbreviation, as the user
 *   types. Typing asks the API nothing more.
 * - **Choosing a team** writes `?team=<id>` (keeping any `?season=`), puts the
 *   team's name in the bar, and replaces the league view (its Champion,
 *   Standings and Leaders sections are gone) with that team's season from
 *   `GET /events/teams/{id}/seasons/{season}`: a heading naming the team, its
 *   record and home and away splits, and its games, each a link to
 *   `/games/<id>`, in the API's order, with a win or a loss marked in words
 *   or letters (W/L), not colour alone. A page opened at `?team=` shows that
 *   view straight away.
 * - **Clearing the bar** removes `?team=` and brings the league view back.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { renderAppAt } from "../../test/app-route";
import {
  CELTICS,
  NETS,
  NEWEST_SEASON,
  RAPTORS,
  SUNS,
  championStub,
  leadersStub,
  seasonGamesStub,
  seasonsStub,
  standingsStub,
  statsTeams,
  teamSeasonStub,
  testTeamSeason,
  type TeamOut,
} from "../../test/stats";
import { rowText, tableProblems } from "../../test/tables";

function openSeasons(path = "/stats/seasons") {
  const teamRequests: string[] = [];
  const teams = http.get("*/events/teams", ({ request }) => {
    teamRequests.push(request.url);
    return HttpResponse.json<TeamOut[]>(statsTeams());
  });
  const teamSeason = teamSeasonStub();
  const { router } = renderAppAt(path, "anonymous", [
    teams,
    seasonsStub().handler,
    championStub().handler,
    standingsStub().handler,
    leadersStub().handler,
    seasonGamesStub().handler,
    teamSeason.handler,
  ]);
  return { router, teamRequests, teamSeason };
}

function bar(): HTMLInputElement {
  return screen.getByRole("combobox", { name: "Team" }) as HTMLInputElement;
}

async function readyBar(): Promise<HTMLInputElement> {
  await screen.findByRole("combobox", { name: "Team" });
  // The teams are what the bar matches against; wait for the league view,
  // which renders once the page has settled.
  await screen.findByRole("region", { name: "Standings" });
  return bar();
}

function optionNames(): string[] {
  return screen
    .queryAllByRole("option")
    .filter((option) => option.closest('[role="listbox"]') !== null)
    .map((option) => option.textContent?.replace(/\s+/g, " ").trim() ?? "");
}

function listedTeams(): string[] {
  return statsTeams()
    .filter((team) => optionNames().some((name) => name.includes(team.name)))
    .map((team) => team.name);
}

function search(router: { state: { location: { search: string } } }) {
  return new URLSearchParams(router.state.location.search);
}

describe("the team search bar (criterion 5)", () => {
  it("is a combobox named Team, collapsed, with no list until it is typed in", async () => {
    openSeasons();

    const input = await readyBar();
    expect(input.tagName).toBe("INPUT");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it.each([
    ["bos", [CELTICS]],
    ["RAPTORS", [RAPTORS]],
    ["phx", [SUNS]],
    ["Suns", [SUNS]],
    ["b", [CELTICS, NETS]],
  ])(
    "typing %j offers the teams it matches by name or abbreviation, case-insensitively",
    async (typed, expected) => {
      openSeasons();
      const user = userEvent.setup();
      const input = await readyBar();

      await user.type(input, typed);

      const listbox = await screen.findByRole("listbox");
      expect(input).toHaveAttribute("aria-expanded", "true");
      expect(input.getAttribute("aria-controls")).toBe(listbox.id);
      expect(listbox.id).not.toBe("");
      await waitFor(() =>
        expect(new Set(listedTeams())).toEqual(
          new Set(expected.map((t) => t.name)),
        ),
      );
      expect(within(listbox).getAllByRole("option")).toHaveLength(
        expected.length,
      );
    },
  );

  it("offers nothing for text that matches no team", async () => {
    openSeasons();
    const user = userEvent.setup();
    const input = await readyBar();

    await user.type(input, "zzz");

    expect(optionNames()).toEqual([]);
  });

  it("matches on the client: typing asks GET /events/teams nothing more", async () => {
    const { teamRequests } = openSeasons();
    const user = userEvent.setup();
    const input = await readyBar();
    await waitFor(() => expect(teamRequests.length).toBeGreaterThan(0));
    const before = teamRequests.length;

    await user.type(input, "bo");
    await screen.findByRole("listbox");
    await user.type(input, "s");

    expect(teamRequests).toHaveLength(before);
  });

  it("ArrowDown moves aria-activedescendant through the options", async () => {
    openSeasons();
    const user = userEvent.setup();
    const input = await readyBar();
    await user.type(input, "b");
    const listbox = await screen.findByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options).toHaveLength(2);

    await user.keyboard("{ArrowDown}");
    expect(options[0].id).not.toBe("");
    expect(input).toHaveAttribute("aria-activedescendant", options[0].id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).not.toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", options[1].id);
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).not.toHaveAttribute("aria-selected", "true");
    // Focus never leaves the input: the options are pointed at, not focused.
    expect(document.activeElement).toBe(input);
  });

  it("Enter chooses the active option: ?team= in the URL, the name in the bar, the list closed", async () => {
    const { router } = openSeasons();
    const user = userEvent.setup();
    const input = await readyBar();
    await user.type(input, "b");
    const listbox = await screen.findByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    const second = statsTeams().find((team) =>
      options[1].textContent?.includes(team.name),
    );
    if (second === undefined) throw new Error("the second option names no team");

    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    await waitFor(() =>
      expect(search(router).get("team")).toBe(String(second.id)),
    );
    expect(bar()).toHaveValue(second.name);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(bar()).toHaveAttribute("aria-expanded", "false");
  });

  it("Escape closes the list without choosing", async () => {
    const { router } = openSeasons();
    const user = userEvent.setup();
    const input = await readyBar();
    await user.type(input, "bos");
    await screen.findByRole("listbox");

    await user.keyboard("{ArrowDown}{Escape}");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(input);
    expect(search(router).has("team")).toBe(false);
    expect(screen.getByRole("region", { name: "Standings" })).toBeVisible();
  });

  it("a click on an option chooses it", async () => {
    const { router } = openSeasons();
    const user = userEvent.setup();
    const input = await readyBar();
    await user.type(input, "raptors");

    await user.click(
      await screen.findByRole("option", { name: new RegExp(RAPTORS.name) }),
    );

    await waitFor(() =>
      expect(search(router).get("team")).toBe(String(RAPTORS.id)),
    );
    expect(bar()).toHaveValue(RAPTORS.name);
  });
});

describe("the team view (criteria 5, 6)", () => {
  async function chooseBoston() {
    const opened = openSeasons();
    const user = userEvent.setup();
    const input = await readyBar();
    await user.type(input, "bos");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}{Enter}");
    return { ...opened, user };
  }

  it("asks GET /events/teams/{id}/seasons/{season} for the season shown", async () => {
    const { teamSeason } = await chooseBoston();

    await waitFor(() =>
      expect(teamSeason.requests.map((r) => r.path)).toContainEqual({
        team_id: String(CELTICS.id),
        season: NEWEST_SEASON,
      }),
    );
  });

  it("replaces the league view with the team's record and games", async () => {
    await chooseBoston();

    expect(
      await screen.findByRole("heading", { name: new RegExp(CELTICS.name) }),
    ).toBeVisible();
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "Standings" })).toBeNull();
      expect(screen.queryByRole("region", { name: "Leaders" })).toBeNull();
      expect(screen.queryByRole("region", { name: "Champion" })).toBeNull();
    });

    const main = screen.getByRole("main");
    await waitFor(() => expect(rowText(main)).toMatch(/64\s*[-–]\s*18/));
    expect(rowText(main)).toMatch(/37\s*[-–]\s*4\b/);
    expect(rowText(main)).toMatch(/27\s*[-–]\s*14/);
  });

  it("links every game to its page, in the API's order, marked won or lost", async () => {
    await chooseBoston();
    const main = screen.getByRole("main");
    const season = testTeamSeason();

    await waitFor(() =>
      expect(
        within(main)
          .queryAllByRole("link")
          .some((link) => link.getAttribute("href") === "/games/9101"),
      ).toBe(true),
    );
    const hrefs = [
      ...new Set(
        within(main)
          .getAllByRole("link")
          .map((link) => link.getAttribute("href") ?? "")
          .filter((href) => /^\/games\/\d+$/.test(href)),
      ),
    ];
    expect(hrefs).toEqual(season.games.map((game) => `/games/${game.game_id}`));

    for (const game of season.games) {
      const link = within(main)
        .getAllByRole("link")
        .find((l) => l.getAttribute("href") === `/games/${game.game_id}`);
      const row = link?.closest<HTMLElement>("tr, li");
      if (row == null) throw new Error(`game ${game.game_id} is in no row`);
      const text = rowText(row);
      expect(
        text.includes(game.opponent.name) ||
          new RegExp(`\\b${game.opponent.abbreviation}\\b`).test(text),
      ).toBe(true);
      expect(text).toMatch(
        game.won ? /\bW\b|\bwon\b|\bwin\b/i : /\bL\b|\blost\b|\bloss\b/i,
      );
    }
  });

  it("opens straight on the team view from ?team=, with the team's name in the bar", async () => {
    const { teamSeason } = openSeasons(
      `/stats/seasons?season=2023-24&team=${CELTICS.id}`,
    );

    expect(
      await screen.findByRole("heading", { name: new RegExp(CELTICS.name) }),
    ).toBeVisible();
    await waitFor(() => expect(bar()).toHaveValue(CELTICS.name));
    expect(teamSeason.requests.map((r) => r.path)).toContainEqual({
      team_id: String(CELTICS.id),
      season: "2023-24",
    });
    expect(screen.queryByRole("region", { name: "Standings" })).toBeNull();
  });

  it("keeps ?season= when a team is chosen", async () => {
    const { router } = openSeasons("/stats/seasons?season=2023-24");
    const user = userEvent.setup();
    const input = await readyBar();
    await user.type(input, "bos");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() =>
      expect(search(router).get("team")).toBe(String(CELTICS.id)),
    );
    expect(search(router).get("season")).toBe("2023-24");
  });

  it("clearing the bar returns to the league view and drops ?team=", async () => {
    const { router, user } = await chooseBoston();
    await screen.findByRole("heading", { name: new RegExp(CELTICS.name) });

    await user.clear(bar());

    await waitFor(() => expect(search(router).has("team")).toBe(false));
    expect(await screen.findByRole("region", { name: "Standings" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Leaders" })).toBeVisible();
  });

  it("its tables have captions, scoped headers and their own scroll regions", async () => {
    openSeasons(`/stats/seasons?season=2023-24&team=${CELTICS.id}`);
    await screen.findByRole("heading", { name: new RegExp(CELTICS.name) });
    const main = screen.getByRole("main");
    await waitFor(() =>
      expect(
        within(main)
          .queryAllByRole("link")
          .some((link) => link.getAttribute("href") === "/games/9101"),
      ).toBe(true),
    );

    expect(tableProblems(main)).toEqual([]);
    expect(main.textContent).not.toMatch(/\bnull\b|\bundefined\b|\bNaN\b/);
  });
});
