/**
 * FRONTEND-009 criterion 9: on the game page, each box-score player's name is
 * a link to `/players/<player_id>` (`0x08-frontend.md`: "Box-score names are
 * not links yet: FRONTEND-009 links them once `/players/:id` exists").
 *
 * The link sits in the player's row header (the `th scope="row"`), its
 * accessible name is the player's full name, and it is the only link in that
 * cell. The rest of the box score is `GamePage.test.tsx`'s, unchanged.
 */
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderAppAt } from "../../test/app-route";
import {
  AWAY_PLAYERS,
  HOME_PLAYERS,
  TEST_AWAY_TEAM,
  TEST_HOME_TEAM,
  gameDetailStub,
  testGameDetail,
  type BoxScorePlayerOut,
  type TeamRefOut,
} from "../../test/games";

function fullName(player: BoxScorePlayerOut): string {
  return [player.first_name, player.last_name]
    .filter((part): part is string => part !== null)
    .join(" ");
}

async function openGame() {
  const game = testGameDetail();
  renderAppAt(`/games/${game.id}`, "anonymous", [gameDetailStub([game]).handler]);
  await screen.findByRole("heading", {
    level: 1,
    name: new RegExp(game.home_team.name),
  });
}

function boxScoreFor(team: TeamRefOut): HTMLTableElement {
  const table = screen
    .getAllByRole("table")
    .find((candidate) =>
      new RegExp(`${team.name}.*box score`, "i").test(
        candidate.querySelector("caption")?.textContent ?? "",
      ),
    );
  if (table === undefined) throw new Error(`no box score for ${team.name}`);
  return table as HTMLTableElement;
}

describe("box-score names link to the player page", () => {
  it.each([
    [TEST_HOME_TEAM.name, TEST_HOME_TEAM, HOME_PLAYERS],
    [TEST_AWAY_TEAM.name, TEST_AWAY_TEAM, AWAY_PLAYERS],
  ] as const)(
    "%s: every played row's name is one link to /players/<id>, in its row header",
    async (_name, team, players) => {
      await openGame();
      const table = boxScoreFor(team);

      for (const player of players) {
        const link = within(table).getByRole("link", {
          name: new RegExp(`^${fullName(player)}$`),
        });
        expect(link).toHaveAttribute("href", `/players/${player.player_id}`);

        const cell = link.closest("th");
        expect(cell, `${fullName(player)}'s link is not in a th`).not.toBeNull();
        expect(cell).toHaveAttribute("scope", "row");
        expect(within(cell as HTMLElement).getAllByRole("link")).toHaveLength(1);
      }
    },
  );

  it("links no totals row", async () => {
    await openGame();

    for (const team of [TEST_HOME_TEAM, TEST_AWAY_TEAM]) {
      const foot = boxScoreFor(team).tFoot;
      expect(foot).not.toBeNull();
      expect(within(foot as HTMLElement).queryAllByRole("link")).toEqual([]);
    }
  });
});
