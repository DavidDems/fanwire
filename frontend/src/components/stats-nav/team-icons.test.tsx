/**
 * FRONTEND-031: a team is shown with its `TeamIcon` beside its name on the
 * stats navigator's levels: standings rows (SeasonLevel), the team level
 * (TeamLevel), and team records on cards (RecordsLevel) and lists
 * (RecordLevel). The icon never replaces the text: the name is still shown.
 * A dense cell that shows only an opponent's abbreviation (a record list's
 * Opp column) stays text, with no icon.
 *
 * `TeamIcon` is replaced here by a stand-in that renders no text, so these
 * tests see where an icon is placed and with what, and nothing of how it
 * draws (that is `components/ui/TeamIcon.test.tsx`'s). The stand-in keeps
 * the real interface: `abbreviation`, `size`, and `label` only where the
 * icon stands alone (then `role="img"`; else `aria-hidden`).
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { teamsAre } from "../../test/auth";
import { findRecordCard, openRecords } from "../../test/records-screen";
import { createTestQueryClient } from "../../test/render";
import { server } from "../../test/server";
import {
  CELTICS,
  championStub,
  seasonsStub,
  standingsStub,
  statsTeams,
  teamSeasonStub,
  testChampion,
} from "../../test/stats";
import { bodyRows, columnHeaders } from "../../test/tables";
import { StatsNavigator, type StatsLevel } from "./StatsNavigator";

vi.mock("../ui/TeamIcon", async () => {
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

const SEASON = "2023-24";

/** The abbreviations of the icons inside `root`. */
function iconsIn(root: Element): string[] {
  return [...root.querySelectorAll("[data-team-icon]")].map(
    (icon) => icon.getAttribute("data-team-icon") ?? "",
  );
}

function iconFor(root: Element, abbreviation: string): Element | null {
  return root.querySelector(`[data-team-icon="${abbreviation}"]`);
}

const ABBREVIATION: Record<string, string> = {
  ...Object.fromEntries(statsTeams().map((t) => [t.name, t.abbreviation])),
  "Golden State Warriors": "GSW",
  "Charlotte Bobcats": "CHA",
  "Miami Heat": "MIA",
};

function tableHolding(element: Element): HTMLTableElement {
  const table = element.closest("table");
  if (table === null) throw new Error("not in a table");
  return table;
}

const adapter = {
  gameLink: (gameId: number, children: ReactNode) => (
    <a href={`#game-${gameId}`}>{children}</a>
  ),
  playerLink: (playerId: number, children: ReactNode) => (
    <a href={`#player-${playerId}`}>{children}</a>
  ),
};

function renderNavigator(stack: StatsLevel[]) {
  server.use(
    teamsAre(statsTeams()),
    seasonsStub().handler,
    championStub({ [SEASON]: testChampion(SEASON) }).handler,
    standingsStub().handler,
    teamSeasonStub().handler,
  );
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <StatsNavigator
        stack={stack}
        open={() => {}}
        replace={() => {}}
        pop={() => {}}
        adapter={adapter}
      />
    </QueryClientProvider>,
  );
}

describe("standings rows (SeasonLevel)", () => {
  it("puts each team's icon beside its name in its row header", async () => {
    renderNavigator([{ kind: "season", season: SEASON, conf: "all" }]);
    const standings = await screen.findByRole("region", { name: "Standings" });
    await within(standings).findAllByRole("table");

    const rows = within(standings)
      .getAllByRole("table")
      .flatMap((table) => bodyRows(table as HTMLTableElement));
    expect(rows.length).toBe(6);
    for (const row of rows) {
      const header = row.querySelector("th");
      expect(header).not.toBeNull();
      const name = (header?.textContent ?? "").trim();
      const abbreviation = ABBREVIATION[name];
      expect(
        abbreviation,
        `the row header still names the team: "${name}"`,
      ).toBeDefined();
      expect(iconsIn(header as Element)).toEqual([abbreviation]);
      expect(iconFor(header as Element, abbreviation)).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    }
  });
});

describe("the team level (TeamLevel)", () => {
  it("shows the team's icon beside its name, outside the games tables", async () => {
    renderNavigator([
      { kind: "season", season: SEASON, conf: "all" },
      { kind: "team", season: SEASON, teamId: CELTICS.id },
    ]);
    await screen.findByRole("heading", {
      level: 2,
      name: new RegExp(CELTICS.name),
    });

    await waitFor(() => {
      const outside = [
        ...document.querySelectorAll(
          `[data-team-icon="${CELTICS.abbreviation}"]`,
        ),
      ].filter((icon) => icon.closest("table, nav") === null);
      expect(outside.length).toBeGreaterThan(0);
    });
    const icon = [
      ...document.querySelectorAll(
        `[data-team-icon="${CELTICS.abbreviation}"]`,
      ),
    ].find((element) => element.closest("table, nav") === null) as Element;
    // Beside the name: the icon's container also names the team.
    expect(icon.parentElement?.textContent ?? "").toContain(CELTICS.name);
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });
});

describe("team records on lists (RecordLevel)", () => {
  it("puts each team holder's icon beside its name in its row header", async () => {
    openRecords("/stats/records?record=team-best-season");
    const table = tableHolding(
      await screen.findByText("Golden State Warriors"),
    );

    const rows = bodyRows(table);
    expect(rows.length).toBe(4);
    for (const row of rows) {
      const header = row.querySelector("th");
      const name = (header?.textContent ?? "").trim();
      const abbreviation = ABBREVIATION[name];
      expect(
        abbreviation,
        `the row header still names the team: "${name}"`,
      ).toBeDefined();
      expect(iconsIn(header as Element)).toEqual([abbreviation]);
      expect(iconFor(header as Element, abbreviation)).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    }
  });

  it("keeps the opponent's abbreviation as text, with no icon", async () => {
    openRecords("/stats/records?record=team-most-points-game");
    const table = tableHolding(await screen.findByText("Denver Nuggets"));
    const opp = columnHeaders(table).findIndex((label) => /^opp/i.test(label));
    expect(opp, "the list has an Opp column").toBeGreaterThan(-1);

    const cells = bodyRows(table).map((row) => row.cells[opp]);
    expect(cells.map((cell) => (cell.textContent ?? "").trim())).toEqual([
      "PHX",
      "DEN",
    ]);
    for (const cell of cells) expect(iconsIn(cell)).toEqual([]);
    // The holders still have theirs.
    expect(iconsIn(table)).toEqual(expect.arrayContaining(["DEN", "PHX"]));
  });
});

describe("team records on cards (RecordsLevel)", () => {
  // FRONTEND-042: a card names a team by its short name (`teamShortName`).
  it.each([
    ["team-best-season", "Warriors", "GSW"],
    ["team-championships", "Celtics", "BOS"],
  ])(
    "%s: the holder's icon is beside its name",
    async (id, name, abbreviation) => {
      openRecords("/stats/records?group=team");
      const card = await findRecordCard(id);
      await waitFor(() => expect(card.textContent ?? "").toContain(name));

      const icon = iconFor(card, abbreviation);
      expect(icon, `no ${abbreviation} icon on the ${id} card`).not.toBeNull();
      expect(icon?.parentElement?.textContent ?? "").toContain(name);
      expect(icon).toHaveAttribute("aria-hidden", "true");
    },
  );
});
