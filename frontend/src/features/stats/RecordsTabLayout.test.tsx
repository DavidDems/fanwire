/**
 * The records tab's layout, adjusted by hand after FRONTEND-031 (the human,
 * 2026-11-04):
 *
 * - **One title.** On the records home (Top records, Team, Player) the
 *   level's name is shown once, as its `h2`: the navigator's one-item
 *   breadcrumb ("Stats path"), which repeated it as plain text, is gone. A
 *   record's own level keeps its breadcrumb (`RecordLevel.test.tsx`).
 * - **One row of bars.** The Historical / Seasonal bar shares a row with
 *   the Top records / Team / Player bar: the group bar at the row's start,
 *   the view bar after it, at the row's end. The view bar still switches its
 *   panel, which now holds it. On Seasonal it shares the season picker's
 *   row, after the picker; on a record's level, which has no group bar, it
 *   stays above the navigator.
 */
import { screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import {
  groupBar,
  openRecords,
  panelOf,
  queryTablistHolding,
  viewBar,
} from "../../test/records-screen";

beforeAll(async () => {
  await import("./RecordsTab");
}, 30_000);

function follows(first: Node, second: Node): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

/** The nearest element holding both nodes. */
function commonParent(a: HTMLElement, b: HTMLElement): HTMLElement {
  let node: HTMLElement | null = a.parentElement;
  while (node !== null && !node.contains(b)) node = node.parentElement;
  if (node === null) throw new Error("no common parent");
  return node;
}

describe("one title on the records home", () => {
  for (const [path, title] of [
    ["/stats/records", "Top records"],
    ["/stats/records?group=team", "Team records"],
    ["/stats/records?group=player", "Player records"],
  ] as const) {
    it(`${title}: the h2 alone, no one-item breadcrumb`, async () => {
      openRecords(path);

      await screen.findByRole("heading", { level: 2, name: title });
      expect(
        screen.queryByRole("navigation", { name: "Stats path" }),
      ).toBeNull();
      expect(
        within(screen.getByRole("main")).queryAllByText(title, {
          selector: ":not(h2):not(h2 *)",
          ignore: "[role=tab], [role=tab] *, script, style",
        }),
      ).toEqual([]);
    });
  }
});

describe("the view bar shares the group bar's row", () => {
  it("puts the group bar first and the view bar after it, in one row", async () => {
    openRecords();
    await screen.findByRole("heading", { level: 2, name: "Top records" });

    const group = groupBar();
    const view = viewBar();
    expect(follows(group, view)).toBe(true);
    const row = commonParent(group, view);
    // The row holds the two bars, not the cards: the group's panel is
    // outside it.
    expect(row.contains(panelOf(group))).toBe(false);
    expect(row.contains(group)).toBe(true);
  });

  it("keeps the view bar switching a panel that holds it and the records", async () => {
    openRecords();
    await screen.findByRole("heading", { level: 2, name: "Top records" });

    const panel = panelOf(viewBar());
    expect(panel.contains(viewBar())).toBe(true);
    expect(panel.contains(groupBar())).toBe(true);
    expect(panel.contains(screen.getByRole("heading", { level: 2 }))).toBe(
      true,
    );
  });

  it("has no view bar above the records home's heading any more", async () => {
    openRecords();
    const heading = await screen.findByRole("heading", {
      level: 2,
      name: "Top records",
    });

    expect(follows(heading, viewBar())).toBe(true);
  });

  it("on Seasonal, shares the season picker's row, after it", async () => {
    openRecords("/stats/records?view=seasonal");
    const select = await screen.findByRole("combobox", { name: "Season" });

    const view = viewBar();
    expect(follows(select, view)).toBe(true);
    const row = commonParent(select, view);
    expect(
      row.querySelector("h2"),
      "the row is the controls, not the leaders",
    ).toBeNull();
  });

  it("on a record's level, stays above the navigator, with no group bar", async () => {
    openRecords("/stats/records?record=team-best-season");
    await screen.findByRole("heading", {
      level: 2,
      name: "Best regular season",
    });

    expect(queryTablistHolding("Player")).toBeNull();
    const path = screen.getByRole("navigation", { name: "Stats path" });
    expect(follows(viewBar(), path)).toBe(true);
    expect(panelOf(viewBar()).contains(path)).toBe(true);
  });
});
