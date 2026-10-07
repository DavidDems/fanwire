/**
 * FRONTEND-007 — the sports-data filter: acceptance criteria 4, 5, 6, 7 (its
 * half), 10, and the shared-component half of 9.
 *
 * **There is no free-text search for sports data.** That is a business rule
 * (`business-rules.md`, carried into [[0x07-search]]), not a UX preference, and
 * the brief names the way it is most likely to be broken: a dropdown with a
 * type-ahead box "just to narrow the team list" *is* a text input. So the very
 * first test below asserts the absence of every `textbox` and `searchbox` role
 * in the Games region, that every `combobox` there is a native `<select>` (a
 * native select is a combobox; an editable `input role="combobox"` must fail),
 * and that no `input`, `textarea` or `contenteditable` exists in it at all —
 * checked once the options have loaded *and* again once results are showing,
 * because a type-ahead can appear late.
 *
 * **Changing a filter re-queries.** The games handler answers each combination
 * of parameters with a *different* list, so a component that filtered its
 * previous results on the client would show the wrong games rather than the
 * right ones by luck.
 *
 * **A game row is `GameScore`, variant `row`, with status `FT`** (historical,
 * so "Final"), and names both teams by abbreviation from `GET /events/teams`.
 * No logo and no team colour (`components.md` §4): no `<img>` and no inline
 * `style` anywhere in the region.
 *
 * Results are found as list items in the Games region, the same shape as the
 * accounts list.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import buttonStyles from "../../components/ui/Button.module.css";
import gameScoreStyles from "../../components/ui/GameScore.module.css";
import { teamsAre, testTeams } from "../../test/auth";
import { renderWithProviders } from "../../test/render";
import {
  TEST_POSITIONS,
  TEST_SEASONS,
  gameFiltersAre,
  gamesPage,
  gamesStub,
  offsetOf,
  testGame,
  type GamesPageBody,
} from "../../test/search";
import { server } from "../../test/server";
import { GameFilter } from "./GameFilter";

const GAME_2022 = testGame({
  id: 601,
  season: "2022",
  home_score: 101,
  away_score: 99,
});
const GAME_2023 = testGame({
  id: 602,
  season: "2023",
  home_team_id: 2,
  away_team_id: 1,
  home_score: 117,
  away_score: 109,
});

/** Each season answers its own game, so client-side filtering cannot pass. */
function bySeason(params: URLSearchParams): GamesPageBody {
  const season = params.get("season");
  if (season === "2022") return gamesPage([GAME_2022]);
  if (season === "2023") return gamesPage([GAME_2023]);
  return gamesPage([]);
}

function gamesRegion(): HTMLElement {
  return screen.getByRole("region", { name: "Games" });
}

function select(name: string): HTMLElement {
  return within(gamesRegion()).getByRole("combobox", { name });
}

/** Render the filter and wait until all three dropdowns have their options. */
async function renderFilter(
  answer: (params: URLSearchParams) => GamesPageBody | null = bySeason,
) {
  const games = gamesStub(answer);
  server.use(gameFiltersAre(), teamsAre(), games.handler);
  renderWithProviders(<GameFilter />);

  const region = await screen.findByRole("region", { name: "Games" });
  await within(region).findByRole("option", { name: TEST_SEASONS[1] });
  await within(region).findByRole("option", { name: TEST_POSITIONS[0] });
  await within(region).findByRole("option", { name: testTeams()[0].name });
  return { games, user: userEvent.setup() };
}

/**
 * The region's visible text without the dropdowns' own option labels, which
 * would otherwise contain every season, team and position on offer.
 */
function textOutsideControls(region: HTMLElement): string {
  const copy = region.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("select").forEach((element) => element.remove());
  return copy.textContent ?? "";
}

function assertNoTextInput(region: HTMLElement): void {
  expect(
    within(region).queryAllByRole("textbox"),
    "a textbox in the sports-data UI",
  ).toEqual([]);
  expect(
    within(region).queryAllByRole("searchbox"),
    "a searchbox in the sports-data UI",
  ).toEqual([]);

  const comboboxes = within(region).getAllByRole("combobox");
  // Not vacuous: the three dropdowns are comboboxes, so there is something to check.
  expect(comboboxes.length).toBeGreaterThanOrEqual(3);
  for (const combobox of comboboxes) {
    expect(
      combobox.tagName,
      "every combobox must be a native <select>, never editable",
    ).toBe("SELECT");
  }

  expect(
    [...region.querySelectorAll("input, textarea, [contenteditable]")].map(
      (element) => element.outerHTML,
    ),
  ).toEqual([]);
}

describe("the sports-data UI has no text input of any kind (written first)", () => {
  it("renders no textbox, no searchbox and no editable combobox once its options load", async () => {
    await renderFilter();

    assertNoTextInput(gamesRegion());
  });

  it("still renders none once results are showing", async () => {
    const { user } = await renderFilter();

    await user.selectOptions(select("Season"), "2023");
    await within(gamesRegion()).findByRole("listitem");

    assertNoTextInput(gamesRegion());
  });
});

describe("the dropdowns' options come from the API", () => {
  function optionsOf(name: string): { text: string; value: string }[] {
    return within(select(name))
      .getAllByRole("option")
      .map((option) => ({
        text: option.textContent ?? "",
        value: (option as HTMLOptionElement).value,
      }));
  }

  it("is a region named Games with a Season, a Team and a Position select", async () => {
    await renderFilter();

    for (const name of ["Season", "Team", "Position"]) {
      expect(select(name).tagName).toBe("SELECT");
    }
  });

  it("offers the seasons from GET /search/games/filters, after an any option", async () => {
    await renderFilter();
    const options = optionsOf("Season");

    expect(options[0].value).toBe("");
    expect(options.slice(1)).toEqual(
      TEST_SEASONS.map((season) => ({ text: season, value: season })),
    );
  });

  it("offers the positions from the filters response's positions field, after an any option", async () => {
    await renderFilter();
    const options = optionsOf("Position");

    expect(options[0].value).toBe("");
    expect(options.slice(1)).toEqual(
      TEST_POSITIONS.map((position) => ({ text: position, value: position })),
    );
  });

  it("offers the teams from GET /events/teams by name, valued by id, after an any option", async () => {
    await renderFilter();
    const options = optionsOf("Team");

    expect(options[0].value).toBe("");
    expect(options.slice(1)).toEqual(
      testTeams().map((team) => ({ text: team.name, value: String(team.id) })),
    );
  });
});

describe("GET /search/games", () => {
  it("is not called until a filter is chosen", async () => {
    const { games } = await renderFilter();

    // Give a request that was going to fire on mount the chance to.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(games.requests).toHaveLength(0);
    expect(within(gamesRegion()).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("sends only the selected filter, omitting the ones left at any", async () => {
    const { games, user } = await renderFilter();

    await user.selectOptions(select("Season"), "2023");

    await waitFor(() => expect(games.requests).toHaveLength(1));
    const params = games.requests[0];
    expect(params.get("season")).toBe("2023");
    expect(params.has("team_id")).toBe(false);
    expect(params.has("position")).toBe(false);
    expect(offsetOf(params)).toBe(0);
  });

  it("sends the selected season, team id and position together", async () => {
    const { games, user } = await renderFilter();
    const suns = testTeams()[1];

    await user.selectOptions(select("Season"), "2023");
    await user.selectOptions(select("Team"), suns.name);
    await user.selectOptions(select("Position"), "PF");

    await waitFor(() => {
      const last = games.requests[games.requests.length - 1];
      expect(last?.get("position")).toBe("PF");
    });
    const last = games.requests[games.requests.length - 1];
    expect(last.get("season")).toBe("2023");
    expect(last.get("team_id")).toBe(String(suns.id));
    const unexpected = [...last.keys()].filter(
      (key) =>
        !["season", "team_id", "position", "limit", "offset"].includes(key),
    );
    expect(unexpected).toEqual([]);
  });

  it("sends a team on its own as team_id, without a season or position", async () => {
    const { games, user } = await renderFilter();
    const raptors = testTeams()[0];

    await user.selectOptions(select("Team"), raptors.name);

    await waitFor(() => expect(games.requests).toHaveLength(1));
    expect(games.requests[0].get("team_id")).toBe(String(raptors.id));
    expect(games.requests[0].has("season")).toBe(false);
    expect(games.requests[0].has("position")).toBe(false);
  });

  it("re-queries when a filter changes and shows the new response's games, not a filtered copy", async () => {
    const { games, user } = await renderFilter();

    await user.selectOptions(select("Season"), "2022");
    await within(gamesRegion()).findByText(/101/);

    await user.selectOptions(select("Season"), "2023");

    await waitFor(() => {
      expect(textOutsideControls(gamesRegion())).toMatch(/117/);
    });
    expect(textOutsideControls(gamesRegion())).not.toMatch(/101/);
    expect(games.requests.map((params) => params.get("season"))).toEqual([
      "2022",
      "2023",
    ]);
  });
});

describe("a game result row", () => {
  async function oneRow(): Promise<HTMLElement> {
    const { user } = await renderFilter();
    await user.selectOptions(select("Season"), "2023");
    const rows = await within(gamesRegion()).findAllByRole("listitem");
    expect(rows).toHaveLength(1);
    return rows[0];
  }

  it("renders through GameScore's row variant, as a final", async () => {
    const row = await oneRow();

    expect(row.querySelector(`.${gameScoreStyles.score}`)).not.toBeNull();
    expect(row.querySelector(`.${gameScoreStyles.row}`)).not.toBeNull();
    expect(within(row).getByText("Final")).toBeInTheDocument();
    expect(within(row).queryByText("Live")).toBeNull();
    expect(within(row).getByText("Home")).toBeInTheDocument();
    expect(within(row).getByText("Away")).toBeInTheDocument();
    expect(within(row).getByText("117")).toBeInTheDocument();
    expect(within(row).getByText("109")).toBeInTheDocument();
  });

  it("names both teams by abbreviation from GET /events/teams", async () => {
    const row = await oneRow();
    const [raptors, suns] = testTeams();

    // Matched against each element's own text, so "PHX" next to "Final" in
    // another element still reads as a word of its own.
    for (const team of [suns, raptors]) {
      expect(
        within(row).queryAllByText(new RegExp(`\\b${team.abbreviation}\\b`)),
        `${team.abbreviation} is not named in the row`,
      ).not.toEqual([]);
    }
  });

  it("carries no team logo and no team colour anywhere in the Games region", async () => {
    await oneRow();
    const region = gamesRegion();

    expect(region.querySelectorAll("img")).toHaveLength(0);
    expect(
      [...region.querySelectorAll("[style]")].map(
        (element) => element.outerHTML,
      ),
    ).toEqual([]);
  });
});

describe("paging the games", () => {
  const FIRST = testGame({ id: 611, home_score: 88, away_score: 80 });
  const SECOND = testGame({ id: 612, home_score: 77, away_score: 70 });

  function paged(params: URLSearchParams): GamesPageBody | null {
    if (offsetOf(params) === 0) return gamesPage([FIRST], 20);
    if (offsetOf(params) === 20) return gamesPage([SECOND], null);
    return null;
  }

  it("loads the next page with the same filters and offset=next_offset, and appends it", async () => {
    const { games, user } = await renderFilter(paged);

    await user.selectOptions(select("Season"), "2023");
    const more = await within(gamesRegion()).findByRole("button", {
      name: "Load more games",
    });
    expect(more).toHaveClass(buttonStyles.secondary);

    await user.click(more);

    await waitFor(() => {
      expect(within(gamesRegion()).getAllByRole("listitem")).toHaveLength(2);
    });
    const last = games.requests[games.requests.length - 1];
    expect(offsetOf(last)).toBe(20);
    expect(last.get("season")).toBe("2023");
    expect(textOutsideControls(gamesRegion())).toMatch(/88/);
    expect(textOutsideControls(gamesRegion())).toMatch(/77/);
    expect(
      within(gamesRegion()).queryByRole("button", { name: "Load more games" }),
    ).toBeNull();
  });

  it("offers no load-more when the first page's next_offset is null", async () => {
    const { user } = await renderFilter();

    await user.selectOptions(select("Season"), "2023");
    await within(gamesRegion()).findByRole("listitem");

    expect(
      within(gamesRegion()).queryByRole("button", { name: "Load more games" }),
    ).toBeNull();
  });
});

describe("states", () => {
  it("says no games were found, naming the season and team searched", async () => {
    const { games, user } = await renderFilter(() => gamesPage([]));
    const raptors = testTeams()[0];

    await user.selectOptions(select("Season"), "2022");
    await user.selectOptions(select("Team"), raptors.name);

    await waitFor(() => {
      expect(games.requests.some((params) => params.has("team_id"))).toBe(true);
    });
    await waitFor(() => {
      const text = textOutsideControls(gamesRegion());
      expect(text).toMatch(/2022/);
      expect(text).toMatch(
        new RegExp(`${raptors.abbreviation}|${raptors.name}`),
      );
    });
    expect(within(gamesRegion()).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("says no games were found, naming the position searched", async () => {
    const { user } = await renderFilter(() => gamesPage([]));

    await user.selectOptions(select("Position"), "PF");

    await waitFor(() => {
      expect(textOutsideControls(gamesRegion())).toMatch(/PF/);
    });
  });

  it("shows a status line while the games are loading", async () => {
    const { games, user } = await renderFilter();
    const release = games.hold();

    await user.selectOptions(select("Season"), "2023");

    expect(
      await within(gamesRegion()).findByRole("status"),
    ).toBeInTheDocument();
    release();
    await within(gamesRegion()).findByRole("listitem");
  });

  it("shows an alert in the Games region when the search fails", async () => {
    const { games, user } = await renderFilter();
    games.fail();

    await user.selectOptions(select("Season"), "2023");

    expect(await within(gamesRegion()).findByRole("alert")).toBeInTheDocument();
  });
});
