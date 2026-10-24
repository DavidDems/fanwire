/**
 * FRONTEND-009 criteria 3, 4 and 6 (the league view), and the table half of
 * 13: the Seasons tab at `/stats/seasons`, through the real route table.
 *
 * The interface this file pins:
 *
 * - **The season picker** is a native select named "Season", filled from
 *   `GET /events/seasons` in the API's order (newest first), with the newest
 *   selected by default. The default is **not** written into the URL: until
 *   the user picks one, `/stats/seasons` stays the address of "the current
 *   season". A picked season is `?season=`, and a page opened at
 *   `?season=` shows that season (a reload or a shared link).
 * - **The league view** is three sections, each a region named by its
 *   heading: "Champion", "Standings" and "Leaders". (FRONTEND-018 dropped the
 *   fourth, "Games": the human, 2026-10-24. Its tests are replaced by one that
 *   pins it gone; the conference tabs, the team level and the request counts
 *   are `SeasonsNavigation.test.tsx` and `stats-requests.test.tsx`.)
 *   - Champion: the champion's and the runner-up's names and the series
 *     result from `GET /events/seasons/{season}/champion`, or a line saying
 *     the season has no champion (matching /no champion/i) when they are null.
 *   - Standings: one table per conference from
 *     `GET /events/seasons/{season}/standings`, captioned with the conference
 *     name, its teams in the conference's order (win percentage, then wins,
 *     then name: not division by division), and the API's `tie_break` text
 *     in the section. Each team's row header is a link to the Seasons tab
 *     filtered to that team (`/stats/seasons?team=<id>`, with `season=` the
 *     season shown when it carries one).
 *   - Leaders: points, rebounds and assists, one request each to
 *     `GET /events/seasons/{season}/leaders?stat=`, one table each captioned
 *     with the stat's name, every leader's name a link to `/players/<id>`, and
 *     the `rule` string the API names shown in the section.
 *   - No season-wide games: no "Games" region, and `GET /events/games` is
 *     never asked.
 * - Every table has a caption, a scope on every header cell, and its own
 *   named, focusable scroll region (`src/test/tables.ts`).
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { teamsAre } from "../../test/auth";
import { renderAppAt } from "../../test/app-route";
import {
  CELTICS,
  MAVERICKS,
  NETS,
  NEWEST_SEASON,
  NUGGETS,
  RAPTORS,
  RULE_65,
  RULE_70,
  SUNS,
  TEST_LEADERS,
  TEST_SEASON_LIST,
  TIE_BREAK,
  championStub,
  leadersStub,
  seasonGames,
  seasonGamesStub,
  seasonsStub,
  standingsStub,
  statsTeams,
  teamSeasonStub,
  testChampion,
  type GameOut,
  type Stub,
} from "../../test/stats";
import {
  bodyRows,
  figure,
  rowText,
  tableCaptioned,
  tableProblems,
} from "../../test/tables";

interface Stubs {
  seasons: Stub;
  champion: Stub;
  standings: Stub;
  leaders: Stub;
  games: Stub;
  teamSeason: Stub;
}

function openSeasons(
  path = "/stats/seasons",
  options: {
    games?: Record<string, GameOut[]>;
    rules?: Record<string, string>;
    tweak?: (stubs: Stubs) => void;
  } = {},
) {
  const stubs: Stubs = {
    seasons: seasonsStub(),
    champion: championStub({ "2023-24": testChampion("2023-24") }),
    standings: standingsStub(),
    leaders: leadersStub(options.rules ?? {}),
    games: seasonGamesStub(
      options.games ?? {
        "2024-25": seasonGames("2024-25", 3),
        "2023-24": seasonGames("2023-24", 4),
        "2022-23": seasonGames("2022-23", 2),
      },
    ),
    teamSeason: teamSeasonStub(),
  };
  options.tweak?.(stubs);
  const { router } = renderAppAt(path, "anonymous", [
    teamsAre(statsTeams()),
    ...Object.values(stubs).map((stub) => stub.handler),
  ]);
  return { stubs, router };
}

function seasonSelect(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: "Season" }) as HTMLSelectElement;
}

async function region(name: string): Promise<HTMLElement> {
  return screen.findByRole("region", { name });
}

function seasonsAsked(stub: Stub): string[] {
  return stub.requests.map((request) => request.path.season);
}

describe("the season picker (criterion 3)", () => {
  it("lists GET /events/seasons newest first, the newest selected, and writes nothing to the URL", async () => {
    const { stubs, router } = openSeasons();

    const select = await screen.findByRole("combobox", { name: "Season" });
    await waitFor(() =>
      expect(
        within(select)
          .getAllByRole("option")
          .map((option) => option.textContent?.trim()),
      ).toEqual(TEST_SEASON_LIST),
    );
    expect((select as HTMLSelectElement).value).toBe(NEWEST_SEASON);
    expect(stubs.seasons.requests.length).toBeGreaterThanOrEqual(1);

    await waitFor(() =>
      expect(seasonsAsked(stubs.champion)).toContain(NEWEST_SEASON),
    );
    expect(router.state.location.pathname).toBe("/stats/seasons");
    expect(
      new URLSearchParams(router.state.location.search).has("season"),
    ).toBe(false);
  });

  it("asks every league read for the newest season by default", async () => {
    const { stubs } = openSeasons();

    await waitFor(() => {
      expect(seasonsAsked(stubs.champion)).toEqual([NEWEST_SEASON]);
      expect(seasonsAsked(stubs.standings)).toEqual([NEWEST_SEASON]);
      expect(new Set(seasonsAsked(stubs.leaders))).toEqual(
        new Set([NEWEST_SEASON]),
      );
    });
    // FRONTEND-018: the season-wide games list is gone, and so is its read.
    expect(stubs.games.requests).toEqual([]);
  });

  it("honours ?season= on load: that season selected, and only it asked for", async () => {
    const { stubs } = openSeasons("/stats/seasons?season=2023-24");

    await waitFor(() => expect(seasonSelect().value).toBe("2023-24"));
    await within(await region("Champion")).findByText(/Boston Celtics/);

    expect(new Set(seasonsAsked(stubs.champion))).toEqual(new Set(["2023-24"]));
    expect(new Set(seasonsAsked(stubs.standings))).toEqual(
      new Set(["2023-24"]),
    );
    expect(new Set(seasonsAsked(stubs.leaders))).toEqual(new Set(["2023-24"]));
    // FRONTEND-018: the season-wide games list is gone, and so is its read.
    expect(stubs.games.requests).toEqual([]);
  });

  it("keeps a picked season in the URL and shows it", async () => {
    const { stubs, router } = openSeasons();
    const user = userEvent.setup();
    await waitFor(() => expect(seasonSelect().value).toBe(NEWEST_SEASON));

    await user.selectOptions(seasonSelect(), "2023-24");

    await waitFor(() =>
      expect(
        new URLSearchParams(router.state.location.search).get("season"),
      ).toBe("2023-24"),
    );
    expect(seasonSelect().value).toBe("2023-24");
    await within(await region("Champion")).findByText(/Boston Celtics/);
    expect(seasonsAsked(stubs.champion)).toContain("2023-24");
  });

  it("Back returns to the season shown before the pick", async () => {
    const { router } = openSeasons();
    const user = userEvent.setup();
    await waitFor(() => expect(seasonSelect().value).toBe(NEWEST_SEASON));

    await user.selectOptions(seasonSelect(), "2022-23");
    await waitFor(() => expect(seasonSelect().value).toBe("2022-23"));
    await router.navigate(-1);

    await waitFor(() => expect(seasonSelect().value).toBe(NEWEST_SEASON));
  });
});

describe("the champion (criterion 4)", () => {
  it("names the champion, the runner-up and the series result", async () => {
    openSeasons("/stats/seasons?season=2023-24");

    const champion = await region("Champion");
    await within(champion).findByText(/Boston Celtics/);
    expect(champion.textContent).toContain(MAVERICKS.name);
    expect(champion.textContent).toContain("4-1");
  });

  it("says the season has no champion yet when the API's are null", async () => {
    openSeasons();

    const champion = await region("Champion");
    expect(await within(champion).findByText(/no champion/i)).toBeVisible();
    expect(champion.textContent).not.toMatch(/null|undefined/);
  });

  it("shows an alert in its own section when the request fails, and the rest still renders", async () => {
    openSeasons("/stats/seasons", {
      tweak: (stubs) => stubs.champion.fail(),
    });

    expect(
      await within(await region("Champion")).findByRole("alert"),
    ).toBeVisible();
    const standings = await region("Standings");
    expect(await within(standings).findAllByRole("table")).toHaveLength(2);
  });
});

describe("the standings (criterion 4)", () => {
  it("is one table per conference, captioned with its name", async () => {
    openSeasons();

    const standings = await region("Standings");
    const tables = await within(standings).findAllByRole("table");
    expect(tables).toHaveLength(2);
    tableCaptioned(standings, /eastern/i);
    tableCaptioned(standings, /western/i);
  });

  it("shows the API's tie-break note", async () => {
    openSeasons();

    const standings = await region("Standings");
    await within(standings).findAllByRole("table");
    expect(standings.textContent?.replace(/\s+/g, " ")).toContain(TIE_BREAK);
  });

  it.each([
    ["Eastern", [CELTICS, NETS, RAPTORS]],
    ["Western", [NUGGETS, MAVERICKS, SUNS]],
  ])(
    "lists the %s conference in its own order, not division by division",
    async (conference, expected) => {
      openSeasons();

      const standings = await region("Standings");
      await within(standings).findAllByRole("table");
      const table = tableCaptioned(standings, new RegExp(conference, "i"));
      const shown = bodyRows(table).map((row) => {
        const name = expected.find((t) => rowText(row).includes(t.name));
        return name?.name ?? rowText(row);
      });

      expect(shown).toEqual(expected.map((t) => t.name));
    },
  );

  it("shows each team's wins, losses and win percentage", async () => {
    openSeasons();

    const standings = await region("Standings");
    await within(standings).findAllByRole("table");
    const table = tableCaptioned(standings, /eastern/i);
    const boston = bodyRows(table).find((row) =>
      rowText(row).includes(CELTICS.name),
    );
    if (boston === undefined) throw new Error("no Boston row");

    const text = rowText(boston);
    expect(text).toMatch(figure(64));
    expect(text).toMatch(figure(18));
    expect(text).toMatch(figure(".780"));
    expect(text).not.toMatch(/0\.780/);
  });

  it("links every team to the Seasons tab filtered to it", async () => {
    openSeasons("/stats/seasons?season=2023-24");

    const standings = await region("Standings");
    await within(standings).findAllByRole("table");
    for (const team of statsTeams()) {
      const link = within(standings).getByRole("link", {
        name: new RegExp(team.name),
      });
      const href = new URL(link.getAttribute("href") ?? "", "http://x.test");
      expect(href.pathname).toBe("/stats/seasons");
      expect(href.searchParams.get("team")).toBe(String(team.id));
      const season = href.searchParams.get("season");
      if (season !== null) expect(season).toBe("2023-24");
    }
  });

  it("following a team's link shows that team's season", async () => {
    const { stubs, router } = openSeasons("/stats/seasons?season=2023-24");
    const user = userEvent.setup();

    const standings = await region("Standings");
    await within(standings).findAllByRole("table");
    await user.click(
      within(standings).getByRole("link", { name: new RegExp(CELTICS.name) }),
    );

    await waitFor(() =>
      expect(
        new URLSearchParams(router.state.location.search).get("team"),
      ).toBe(String(CELTICS.id)),
    );
    await waitFor(() =>
      expect(stubs.teamSeason.requests.map((r) => r.path)).toContainEqual({
        team_id: String(CELTICS.id),
        season: "2023-24",
      }),
    );
  });
});

describe("the leaders (criterion 4)", () => {
  it("asks for the points, rebounds and assists leaders of the season", async () => {
    const { stubs } = openSeasons();

    await waitFor(() =>
      expect(
        new Set(stubs.leaders.requests.map((r) => r.query.get("stat"))),
      ).toEqual(new Set(["points", "rebounds", "assists"])),
    );
  });

  it.each(["points", "rebounds", "assists"] as const)(
    "shows the %s leaders in a table of their own, each linking to the player",
    async (stat) => {
      openSeasons();

      const leaders = await region("Leaders");
      await within(leaders).findAllByRole("table");
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

  it("shows the qualifying rule the API names", async () => {
    openSeasons();

    const leaders = await region("Leaders");
    await within(leaders).findAllByRole("table");
    expect(leaders.textContent).toContain(RULE_65);
  });

  it("shows a different season's rule when that season's is different", async () => {
    openSeasons("/stats/seasons?season=2022-23", {
      rules: { "2022-23": RULE_70 },
    });

    const leaders = await region("Leaders");
    await within(leaders).findAllByRole("table");
    expect(leaders.textContent).toContain(RULE_70);
    expect(leaders.textContent).not.toContain(RULE_65);
  });
});

describe("the season-wide games list is gone (FRONTEND-018)", () => {
  it("shows no Games section and never asks GET /events/games", async () => {
    const { stubs } = openSeasons("/stats/seasons?season=2023-24");

    await within(await region("Standings")).findAllByRole("table");
    await within(await region("Leaders")).findAllByRole("table");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.queryByRole("region", { name: "Games" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /load more games/i }),
    ).toBeNull();
    expect(stubs.games.requests).toEqual([]);
  });
});

describe("the league view's tables (criterion 13)", () => {
  it("each has a caption, scoped headers and its own scroll region", async () => {
    openSeasons("/stats/seasons?season=2023-24");

    await within(await region("Standings")).findAllByRole("table");
    await within(await region("Leaders")).findAllByRole("table");
    const main = screen.getByRole("main");

    expect(main.querySelectorAll("table").length).toBeGreaterThanOrEqual(5);
    expect(tableProblems(main)).toEqual([]);
  });

  it("never prints null, undefined or NaN", async () => {
    openSeasons();

    await within(await region("Standings")).findAllByRole("table");
    await within(await region("Leaders")).findAllByRole("table");
    expect(screen.getByRole("main").textContent).not.toMatch(
      /\bnull\b|\bundefined\b|\bNaN\b/,
    );
  });
});
