/**
 * FRONTEND-031: the player page shows the player's current team with its
 * `TeamIcon`, beside the team as text (its name or abbreviation), outside
 * the tables. The current team is the newest one the page has: LeBron's
 * fixture is LAL in his newest season line and in every game of his log.
 *
 * A dense cell that shows only an opponent's abbreviation, a single game's
 * entry in the game log ("vs PHX"), stays text with no icon.
 *
 * `TeamIcon` is replaced by a stand-in that renders no text and keeps the
 * real interface (see `components/stats-nav/team-icons.test.tsx`).
 */
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderAppAt } from "../../test/app-route";
import {
  playerDetailStub,
  playerGames,
  playerGamesStub,
  testPlayerDetail,
} from "../../test/stats";

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

const LEBRON = testPlayerDetail();

function openLebron() {
  renderAppAt(`/players/${LEBRON.id}`, "anonymous", [
    playerDetailStub([LEBRON]).handler,
    playerGamesStub({ [LEBRON.id]: playerGames(3) }).handler,
  ]);
  return screen.findByRole("heading", { level: 1, name: "LeBron James" });
}

describe("the player page's current team (PlayerPage)", () => {
  it("shows the current team's icon beside the team, outside the tables", async () => {
    await openLebron();
    let icon: Element | undefined;
    await waitFor(() => {
      icon = [...document.querySelectorAll('[data-team-icon="LAL"]')].find(
        (element) => element.closest("table") === null,
      );
      expect(icon, "no LAL icon outside the tables").toBeDefined();
    });
    // Beside the team as text: the icon's container names it.
    expect(icon?.parentElement?.textContent ?? "").toMatch(
      /\bLAL\b|Los Angeles Lakers/,
    );
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the game log's opponent cells as text, with no icon", async () => {
    await openLebron();
    const log = await screen.findByRole("region", { name: "Game log" });
    await waitFor(() => expect(log.textContent ?? "").toMatch(/(vs|at) PHX/));
    const cells = [...log.querySelectorAll("td")].filter((cell) =>
      /^(vs|at)\s/.test(cell.textContent?.trim() ?? ""),
    );
    expect(cells.length).toBe(3);
    for (const cell of cells)
      expect(cell.querySelectorAll("[data-team-icon]")).toHaveLength(0);
  });
});
