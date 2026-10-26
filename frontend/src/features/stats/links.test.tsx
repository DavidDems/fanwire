/**
 * FRONTEND-019 criteria 1 and 7: `features/stats/links.ts`, the route
 * adapter's addresses. The helpers keep their output for the same inputs,
 * and `ROUTE_LINKS` gives the navigator's new optional `teamLink(teamId,
 * season | null, children)` through `teamHref`: the Seasons tab filtered to
 * that team, for that season when there is one.
 */
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/render";
import { ROUTE_LINKS, gameHref, playerHref, teamHref } from "./links";

describe("the addresses keep their output", () => {
  it("gameHref, playerHref and teamHref", () => {
    expect(gameHref(9101)).toBe("/games/9101");
    expect(playerHref(2544)).toBe("/players/2544");
    expect(teamHref(3, null)).toBe("/stats/seasons?team=3");
    expect(teamHref(3, "2023-24")).toBe("/stats/seasons?season=2023-24&team=3");
  });
});

describe("ROUTE_LINKS", () => {
  it("links a game and a player as before", () => {
    renderWithProviders(
      <>
        {ROUTE_LINKS.gameLink(9101, "17 Jun 2024")}
        {ROUTE_LINKS.playerLink(2544, "LeBron James")}
      </>,
    );

    expect(screen.getByRole("link", { name: "17 Jun 2024" })).toHaveAttribute(
      "href",
      "/games/9101",
    );
    expect(screen.getByRole("link", { name: "LeBron James" })).toHaveAttribute(
      "href",
      "/players/2544",
    );
  });

  it("gives teamLink, through teamHref, with and without a season", () => {
    expect(ROUTE_LINKS.teamLink).toBeDefined();

    renderWithProviders(
      <>
        {ROUTE_LINKS.teamLink?.(7, "2015-16", "Golden State Warriors")}
        {ROUTE_LINKS.teamLink?.(3, null, "Boston Celtics")}
      </>,
    );

    expect(
      screen.getByRole("link", { name: "Golden State Warriors" }),
    ).toHaveAttribute("href", teamHref(7, "2015-16"));
    expect(
      screen.getByRole("link", { name: "Boston Celtics" }),
    ).toHaveAttribute("href", teamHref(3, null));
  });
});
