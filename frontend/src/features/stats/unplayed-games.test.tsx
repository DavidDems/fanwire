/**
 * FRONTEND-037 (Director decision): unplayed games on Stats > Seasons > a
 * team. The team-season API returns every stored game with `won` = own score
 * > theirs, so a scheduled game arrives as 0-0 with `won: false`. A game is
 * unplayed when `team_score === 0 && opponent_score === 0`.
 *
 * The interface this file pins:
 *
 * - An unplayed game's card shows no standalone "W" or "L"; its link's
 *   accessible name holds neither "Won" nor "Lost" but "Not played yet" and
 *   "0–0" (en dash); it is still exactly one link, to
 *   `/games/<id>?season=<season>`.
 * - The cumulative chart and its "Record after each game" table count played
 *   games only: [W, L, unplayed, W] in chronological order gives three rows,
 *   1-0, 1-1, 2-1.
 * - A season whose games are all unplayed has no chart and no record table,
 *   and still lists its cards.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { teamsAre } from "../../test/auth";
import { renderAppAt } from "../../test/app-route";
import {
  CELTICS,
  NETS,
  championStub,
  ref,
  seasonsStub,
  standingsStub,
  statsTeams,
  teamSeasonStub,
  testChampion,
  testTeamSeason,
  type TeamSeasonGameOut,
} from "../../test/stats";
import { bodyRows, rowText, tablesCaptioned } from "../../test/tables";

const SEASON = "2023-24";
const EN_DASH = String.fromCodePoint(0x2013);
const UNPLAYED_ID = 9104;

/** A scheduled game, as the API sends it: 0-0, `won: false`. */
const UNPLAYED: TeamSeasonGameOut = {
  game_id: UNPLAYED_ID,
  date: "2024-04-10T19:30:00",
  game_type: "regular",
  label: null,
  sub_label: null,
  opponent: ref(NETS),
  is_home: true,
  team_score: 0,
  opponent_score: 0,
  won: false,
};

/**
 * Newest first, as the API sends them: June W, April unplayed, March L,
 * January W. Chronologically: W, L, unplayed, W.
 */
function withUnplayed(): TeamSeasonGameOut[] {
  const [june, march, january] = testTeamSeason(CELTICS, SEASON).games;
  return [june, UNPLAYED, march, january];
}

function openTeam(games: TeamSeasonGameOut[]) {
  return renderAppAt(
    `/stats/seasons?season=${SEASON}&team=${CELTICS.id}`,
    "anonymous",
    [
      teamsAre(statsTeams()),
      seasonsStub().handler,
      championStub({ [SEASON]: testChampion(SEASON) }).handler,
      standingsStub().handler,
      teamSeasonStub((_teamId, season) => ({
        ...testTeamSeason(CELTICS, season),
        games,
      })).handler,
    ],
  );
}

function main(): HTMLElement {
  return screen.getByRole("main");
}

function hrefOf(link: Element): URL {
  return new URL(link.getAttribute("href") ?? "", "http://x.test");
}

/** The list whose items link to games, once it is on screen. */
async function resultItems(): Promise<HTMLElement[]> {
  let found: HTMLElement[] = [];
  await waitFor(() => {
    const list = within(main())
      .queryAllByRole("list")
      .find((candidate) =>
        within(candidate)
          .queryAllByRole("listitem")
          .some((item) =>
            within(item)
              .queryAllByRole("link")
              .some((link) => /^\/games\/\d+$/.test(hrefOf(link).pathname)),
          ),
      );
    expect(list, "a list of the team's games").toBeDefined();
    found = within(list as HTMLElement).getAllByRole("listitem");
  });
  return found;
}

/** Each row's record, as "wins-losses". */
function recordsOf(table: HTMLTableElement): string[] {
  return bodyRows(table).map((row) => {
    const found = rowText(row).match(/\b(\d+)\s*[-–]\s*(\d+)\b/);
    return found === null ? "" : `${found[1]}-${found[2]}`;
  });
}

describe("an unplayed game's card", () => {
  it("shows no W or L, is named 'Not played yet' and 0–0, and is still one link with the season", async () => {
    openTeam(withUnplayed());
    const items = await resultItems();
    expect(items).toHaveLength(4);

    const item = items[1];
    const controls = [
      ...within(item).queryAllByRole("link"),
      ...within(item).queryAllByRole("button"),
    ];
    expect(controls, "one interactive element per card").toHaveLength(1);
    const link = controls[0];
    expect(link.tagName).toBe("A");
    expect(hrefOf(link).pathname).toBe(`/games/${UNPLAYED_ID}`);
    expect(hrefOf(link).searchParams.get("season")).toBe(SEASON);

    expect(link).toHaveAccessibleName(
      expect.stringContaining("Not played yet"),
    );
    expect(link).toHaveAccessibleName(expect.stringContaining(`0${EN_DASH}0`));
    expect(link).not.toHaveAccessibleName(/\bWon\b/);
    expect(link).not.toHaveAccessibleName(/\bLost\b/);
    expect(within(item).queryByText("W", { exact: true })).toBeNull();
    expect(within(item).queryByText("L", { exact: true })).toBeNull();
  });

  it("leaves the played games' cards marked W or L", async () => {
    openTeam(withUnplayed());
    const items = await resultItems();

    expect(within(items[0]).getByText("W", { exact: true })).toBeVisible();
    expect(within(items[2]).getByText("L", { exact: true })).toBeVisible();
    expect(within(items[3]).getByText("W", { exact: true })).toBeVisible();
  });
});

describe("the cumulative record counts played games only", () => {
  it("gives [W, L, unplayed, W] three rows: 1-0, 1-1, 2-1", async () => {
    openTeam(withUnplayed());
    const user = userEvent.setup();

    expect(
      await screen.findByRole("img", { name: /wins and losses/i }),
    ).toBeVisible();
    const summary = await within(main()).findByText("Record after each game", {
      selector: "summary",
    });
    const details = summary.closest("details");
    expect(details, "the summary opens a <details>").not.toBeNull();
    if (!(details as HTMLDetailsElement).open) await user.click(summary);

    const tables = tablesCaptioned(main(), /record after each game/i);
    expect(tables).toHaveLength(1);
    expect(bodyRows(tables[0])).toHaveLength(3);
    expect(recordsOf(tables[0])).toEqual(["1-0", "1-1", "2-1"]);
  });

  it("draws no chart and no record table when every game is unplayed, and still lists the cards", async () => {
    const games: TeamSeasonGameOut[] = [
      { ...UNPLAYED, game_id: 9105, date: "2024-04-12T19:30:00" },
      UNPLAYED,
    ];
    openTeam(games);

    const items = await resultItems();
    expect(items).toHaveLength(2);
    for (const item of items)
      expect(within(item).getByRole("link")).toHaveAccessibleName(
        expect.stringContaining("Not played yet"),
      );
    expect(screen.queryByRole("img", { name: /wins and losses/i })).toBeNull();
    expect(screen.queryByText("Record after each game")).toBeNull();
    expect(tablesCaptioned(main(), /record after each game/i)).toEqual([]);
  });
});
