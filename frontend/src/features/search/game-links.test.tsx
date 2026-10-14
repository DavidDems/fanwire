/**
 * FRONTEND-008 acceptance criterion 9, the search half: every game result on
 * the search page is a `GameScore` that links to that game's page.
 *
 * Each result row holds exactly one link, to `/games/<id>`, wrapping the score
 * block (its text has the Final state and both figures), with an accessible
 * name naming both teams — by name or abbreviation — and both scores. The
 * rest of the row (`GameFilter.test.tsx`) is unchanged.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { teamsAre, testTeams } from "../../test/auth";
import { renderWithProviders } from "../../test/render";
import {
  gameFiltersAre,
  gamesPage,
  gamesStub,
  testGame,
} from "../../test/search";
import { server } from "../../test/server";
import { GameFilter } from "./GameFilter";

const GAMES = [
  testGame({ id: 602, home_score: 117, away_score: 109 }),
  testGame({
    id: 603,
    home_team_id: 2,
    away_team_id: 1,
    home_score: 98,
    away_score: 121,
  }),
];

async function resultRows(): Promise<HTMLElement[]> {
  server.use(
    gameFiltersAre(),
    teamsAre(),
    gamesStub(() => gamesPage(GAMES)).handler,
  );
  renderWithProviders(<GameFilter />);
  const user = userEvent.setup();
  const region = await screen.findByRole("region", { name: "Games" });
  await within(region).findByRole("option", { name: "2023" });
  await within(region).findByRole("option", { name: testTeams()[0].name });
  await user.selectOptions(
    within(region).getByRole("combobox", { name: "Season" }),
    "2023",
  );
  const rows = await within(region).findAllByRole("listitem");
  expect(rows).toHaveLength(GAMES.length);
  return rows;
}

/** The link's computed accessible name, as Testing Library computes it. */
function accessibleName(link: HTMLElement): string {
  let computed = "";
  screen.getByRole("link", {
    name: (name, element) => {
      if (element === link) computed = name;
      return element === link;
    },
  });
  return computed;
}

function namesTeam(name: string, teamId: number): boolean {
  const team = testTeams().find((candidate) => candidate.id === teamId);
  if (team === undefined) throw new Error(`no test team ${teamId}`);
  return (
    name.includes(team.name) ||
    new RegExp(`\\b${team.abbreviation}\\b`).test(name)
  );
}

describe("search game results link to their game page", () => {
  it("gives each row one link, to /games/<id>", async () => {
    const rows = await resultRows();

    rows.forEach((row, index) => {
      const links = within(row).getAllByRole("link");
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveAttribute("href", `/games/${GAMES[index].id}`);
    });
  });

  it("makes the score block the link, named for both teams and the score", async () => {
    const rows = await resultRows();

    rows.forEach((row, index) => {
      const game = GAMES[index];
      const link = within(row).getByRole("link");
      const text = link.textContent ?? "";
      expect(text).toContain("Final");
      expect(text).toContain(String(game.home_score));
      expect(text).toContain(String(game.away_score));

      const name = accessibleName(link);
      expect(namesTeam(name, game.home_team_id), name).toBe(true);
      expect(namesTeam(name, game.away_team_id), name).toBe(true);
      expect(name).toContain(String(game.home_score));
      expect(name).toContain(String(game.away_score));
    });
  });
});
