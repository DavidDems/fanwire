/**
 * FRONTEND-031: the game page shows each team's `TeamIcon` beside its name
 * in the page's header (GamePage) and in each box score's heading
 * (BoxScore). The names stay as text, so the headings' names are unchanged.
 * The dense rows stay text with no icon: the line score's rows, which show
 * only each team's abbreviation, and every box score table.
 *
 * `TeamIcon` is replaced by a stand-in that renders no text and keeps the
 * real interface (see `components/stats-nav/team-icons.test.tsx`).
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderAppAt } from "../../test/app-route";
import {
  TEST_AWAY_TEAM,
  TEST_HOME_TEAM,
  gameDetailStub,
  testGameDetail,
} from "../../test/games";
import { server } from "../../test/server";

vi.mock("../../components/ui/TeamIcon", async () => {
  const { createElement } = await import("react");
  return {
    TeamIcon: ({
      abbreviation,
      size,
      label,
    }: {
      abbreviation: string | null | undefined;
      size: string;
      label?: string;
    }) =>
      createElement("span", {
        "data-team-icon": abbreviation ?? "",
        "data-size": size,
        ...(label === undefined
          ? { "aria-hidden": "true" }
          : { role: "img", "aria-label": label }),
      }),
  };
});

function iconsIn(root: Element): string[] {
  return [...root.querySelectorAll("[data-team-icon]")].map(
    (icon) => icon.getAttribute("data-team-icon") ?? "",
  );
}

async function openGame() {
  const game = testGameDetail();
  server.use(gameDetailStub([game]).handler);
  renderAppAt(`/games/${game.id}`, "anonymous");
  return screen.findByRole("heading", {
    level: 1,
    name: new RegExp(TEST_HOME_TEAM.name),
  });
}

describe("the game page's header (GamePage)", () => {
  it("shows both teams' icons, each beside its name", async () => {
    const heading = await openGame();
    expect(iconsIn(heading).sort()).toEqual(
      [TEST_AWAY_TEAM.abbreviation, TEST_HOME_TEAM.abbreviation].sort(),
    );
    for (const team of [TEST_AWAY_TEAM, TEST_HOME_TEAM]) {
      const icon = heading.querySelector(
        `[data-team-icon="${team.abbreviation}"]`,
      );
      expect(icon).toHaveAttribute("aria-hidden", "true");
      // Beside its own name, not the other team's.
      const side = icon?.parentElement?.textContent ?? "";
      expect(side).toContain(team.name);
      const other = team === TEST_HOME_TEAM ? TEST_AWAY_TEAM : TEST_HOME_TEAM;
      expect(side).not.toContain(other.name);
    }
  });

  it("keeps the heading's name: both teams and both scores", async () => {
    const heading = await openGame();
    expect(heading).toHaveAccessibleName(
      expect.stringMatching(
        new RegExp(
          `${TEST_AWAY_TEAM.name}.*109.*at.*${TEST_HOME_TEAM.name}.*117`,
        ),
      ),
    );
  });
});

describe("each box score's heading (BoxScore)", () => {
  it.each([
    ["away", TEST_AWAY_TEAM],
    ["home", TEST_HOME_TEAM],
  ])("the %s team's heading has its icon and its name", async (_side, team) => {
    await openGame();
    // FRONTEND-037: each box score is behind its team's tab ("Suns 109").
    const tab = screen.getByRole("tab", {
      name: new RegExp(`^${team.name.split(" ").slice(-1)[0]} \\d+$`),
    });
    if (tab.getAttribute("aria-selected") !== "true")
      await userEvent.setup().click(tab);
    const heading = screen.getByRole("heading", { level: 2, name: team.name });
    expect(iconsIn(heading)).toEqual([team.abbreviation]);
    expect(heading.querySelector("[data-team-icon]")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("puts no icon in any table: the line score and box score rows stay text", async () => {
    await openGame();
    const tables = [...document.querySelectorAll("table")];
    // FRONTEND-037 changed this from 3: one box score is shown at a time.
    expect(tables.length).toBeGreaterThanOrEqual(2);
    for (const table of tables) expect(iconsIn(table)).toEqual([]);
    // The line score still shows each team's abbreviation as its row header.
    const lineScore = tables.find((table) =>
      [...table.querySelectorAll("tbody th")].some(
        (th) => th.textContent?.trim() === TEST_HOME_TEAM.abbreviation,
      ),
    );
    expect(
      lineScore,
      "the line score's rows show the abbreviations",
    ).toBeDefined();
  });
});
