/**
 * FRONTEND-037: Stats > Seasons > a team, through the real route table. The
 * team's games are compact result cards; the chart is `SeasonsTab.test.tsx`'s.
 *
 * The interface this file pins:
 *
 * - The team heading and the facts line stay: Record, Home and Away, with
 *   their values.
 * - The games are one list (`<ul>` or `<ol>`), in the API's order (newest
 *   first), so the DOM order, the reading order and the keyboard order are all
 *   newest first. A CSS grid may lay it out in two columns; it never reorders.
 * - Each item is exactly one interactive element: a link to
 *   `/games/<game_id>?season=<the level's season>`, which is the level's season
 *   even when it is the default one the page's URL does not carry.
 * - The link's accessible name holds the matchup with the selected team first
 *   ("Celtics vs Mavericks" at home, "Celtics at Suns" away, short names), the
 *   word "Won" or "Lost", the score as the team's then the opponent's joined by
 *   an en dash ("106–88"), and the game's label and sub-label, else its type in
 *   words ("Regular season"). The card shows a standalone "W" or "L".
 * - No date and no city name anywhere in the list.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { teamsAre } from "../../test/auth";
import { renderAppAt } from "../../test/app-route";
import {
  CELTICS,
  NEWEST_SEASON,
  championStub,
  seasonsStub,
  standingsStub,
  statsTeams,
  teamSeasonStub,
  testChampion,
  testTeamSeason,
} from "../../test/stats";
import { rowText } from "../../test/tables";

const EN_DASH = String.fromCodePoint(0x2013);

function openTeam(path: string) {
  return renderAppAt(path, "anonymous", [
    teamsAre(statsTeams()),
    seasonsStub().handler,
    championStub({ "2023-24": testChampion("2023-24") }).handler,
    standingsStub().handler,
    teamSeasonStub().handler,
  ]);
}

function main(): HTMLElement {
  return screen.getByRole("main");
}

function gameHref(link: Element): URL {
  return new URL(link.getAttribute("href") ?? "", "http://x.test");
}

function isGameLink(element: Element): boolean {
  return /^\/games\/\d+$/.test(gameHref(element).pathname);
}

/** The list whose items link to games. */
async function resultList(): Promise<HTMLElement> {
  let found: HTMLElement | undefined;
  await waitFor(() => {
    found = within(main())
      .queryAllByRole("list")
      .find((list) =>
        within(list)
          .queryAllByRole("listitem")
          .some((item) => within(item).queryAllByRole("link").some(isGameLink)),
      );
    expect(found, "a list of the team's games").toBeDefined();
  });
  return found as HTMLElement;
}

function items(list: HTMLElement): HTMLElement[] {
  return within(list).getAllByRole("listitem");
}

function interactive(item: HTMLElement): HTMLElement[] {
  return [
    ...within(item).queryAllByRole("link"),
    ...within(item).queryAllByRole("button"),
  ];
}

/** Every date spelling the fixture's three games could be shown in. */
const FIXTURE_DATES =
  /\b17 Jun|\bJun(e)? 17\b|\b20 Mar|\bMar(ch)? 20\b|\b15 Jan|\bJan(uary)? 15\b|\b2024-0[136]-\d\d\b|\b0?[136]\/\d\d\b/;

const CITIES = /\bBoston\b|\bDallas\b|\bPhoenix\b|\bToronto\b/;

describe("the team level keeps its heading and its facts line", () => {
  it("names the team and season, and shows Record, Home and Away with their values", async () => {
    openTeam(`/stats/seasons?season=2023-24&team=${CELTICS.id}`);

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: /Boston Celtics, 2023-24/,
      }),
    ).toBeVisible();
    await waitFor(() => expect(rowText(main())).toMatch(/Record\s*64-18/));
    expect(rowText(main())).toMatch(/Home\s*37-4\b/);
    expect(rowText(main())).toMatch(/Away\s*27-14/);
  });
});

describe("the team's games are a list of result cards, newest first", () => {
  it("lists every game once, in the API's order (newest first), each item one link", async () => {
    openTeam(`/stats/seasons?season=2023-24&team=${CELTICS.id}`);
    const list = await resultList();
    const games = testTeamSeason(CELTICS, "2023-24").games;

    const rows = items(list);
    expect(rows).toHaveLength(games.length);
    rows.forEach((row, index) => {
      const controls = interactive(row);
      expect(controls, "one interactive element per card").toHaveLength(1);
      expect(controls[0].tagName).toBe("A");
      expect(gameHref(controls[0]).pathname).toBe(
        `/games/${games[index].game_id}`,
      );
    });
    // No games table beside the cards, and no point-margin view.
    expect(
      within(main()).queryByRole("table", { name: /newest first/i }),
    ).toBeNull();
    expect(main().textContent).not.toMatch(/point margin/i);
  });

  it("links each card to its game with the level's season", async () => {
    openTeam(`/stats/seasons?season=2023-24&team=${CELTICS.id}`);
    const list = await resultList();

    for (const row of items(list)) {
      const href = gameHref(interactive(row)[0]);
      expect(href.searchParams.get("season")).toBe("2023-24");
    }
  });

  it("carries the default season too, though the page's URL does not", async () => {
    const { router } = openTeam(`/stats/seasons?team=${CELTICS.id}`);
    const list = await resultList();

    expect(
      new URLSearchParams(router.state.location.search).get("season"),
    ).toBeNull();
    for (const row of items(list)) {
      const href = gameHref(interactive(row)[0]);
      expect(href.searchParams.get("season")).toBe(NEWEST_SEASON);
    }
  });

  it.each([
    // [game id, matchup, result, score, game type or label]
    [9101, "Celtics vs Mavericks", "Won", `106${EN_DASH}88`, "NBA Finals"],
    [9102, "Celtics at Suns", "Lost", `111${EN_DASH}117`, "Regular season"],
    [9103, "Celtics vs Raptors", "Won", `126${EN_DASH}104`, "Regular season"],
  ] as const)(
    "game %i: names the matchup (selected team first), the result, the score and the game",
    async (gameId, matchup, result, score, kind) => {
      openTeam(`/stats/seasons?season=2023-24&team=${CELTICS.id}`);
      const list = await resultList();
      const link = items(list)
        .map((row) => interactive(row)[0])
        .find((control) => gameHref(control).pathname === `/games/${gameId}`);
      if (link === undefined) throw new Error(`no card for game ${gameId}`);

      expect(link).toHaveAccessibleName(expect.stringContaining(matchup));
      expect(link).toHaveAccessibleName(new RegExp(`\\b${result}\\b`));
      expect(link).toHaveAccessibleName(expect.stringContaining(score));
      expect(link).toHaveAccessibleName(expect.stringContaining(kind));
      if (gameId === 9101)
        expect(link).toHaveAccessibleName(expect.stringContaining("Game 5"));
      expect(link).not.toHaveAccessibleName(
        gameId === 9102 ? /\bWon\b/ : /\bLost\b/,
      );
    },
  );

  it("shows a standalone W or L on each card", async () => {
    openTeam(`/stats/seasons?season=2023-24&team=${CELTICS.id}`);
    const list = await resultList();
    const games = testTeamSeason(CELTICS, "2023-24").games;

    items(list).forEach((row, index) => {
      const letter = games[index].won ? "W" : "L";
      const other = games[index].won ? "L" : "W";
      expect(within(row).getByText(letter, { exact: true })).toBeVisible();
      expect(within(row).queryByText(other, { exact: true })).toBeNull();
    });
  });

  it("shows no dates and no city names in the list, in text or names", async () => {
    openTeam(`/stats/seasons?season=2023-24&team=${CELTICS.id}`);
    const list = await resultList();

    const text = rowText(list);
    expect(text).not.toMatch(FIXTURE_DATES);
    expect(text).not.toMatch(CITIES);
    expect(text).not.toMatch(/\bnull\b|\bundefined\b|\bNaN\b/);
    for (const row of items(list)) {
      const link = interactive(row)[0];
      expect(link).not.toHaveAccessibleName(FIXTURE_DATES);
      expect(link).not.toHaveAccessibleName(CITIES);
    }
  });
});
