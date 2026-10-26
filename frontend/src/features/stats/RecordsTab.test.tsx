/**
 * FRONTEND-019 criteria 2, 3 and 8: the Records tab at `/stats/records`,
 * Historical, through the real route table (`features/stats/RecordsTab.tsx`,
 * lazy, the navigator's route adapter for the records levels).
 *
 * The interface this file pins:
 *
 * - **The view bar.** A `SegmentedTabs` bar with the tabs Historical and
 *   Seasonal, in that order, Historical the default. Seasonal is
 *   `?view=seasonal`; Historical is never written, and an unknown `?view=`
 *   shows Historical. Its panel holds what it switches (the records navigator,
 *   or the Seasonal leaders). The bar **replaces** the history entry, and
 *   switching the view drops `group`, `record` and `season` from the address.
 * - **The group bar.** Inside Historical, a second `SegmentedTabs` bar, Team
 *   and Player, Team the default. Player is `?group=player`; Team is never
 *   written, and an unknown `?group=` shows Team. It too replaces the history
 *   entry. Its panel holds the group's cards.
 * - **The records level's heading** is an `h2`, "Team records" or "Player
 *   records".
 * - **One data-window line**: "Since <since_season>, through
 *   <through_season>" from `GET /events/records`; with no window, no line.
 * - **The cards**: a list named by its group ("Team records"), one list item
 *   per record of that group, in the API's order. Each card:
 *   - its title as an `h3`;
 *   - exactly one interactive element, a "View all" link whose accessible
 *     name includes the title, at `/stats/records?record=<id>`;
 *   - the holder as plain text: the team's name, or the player's first and
 *     last name and, for a single-game record, the team they played for; the
 *     value with its unit (a win percentage as `.890`, three places, no
 *     leading zero, as the standings show one); the season, or the game's date
 *     (`d MMM yyyy`, as `games/format` prints it) and opponent;
 *   - a tie: "and 1 other" for `tied_count` 2, "and 2 others" for 3;
 *   - no holder: a line saying nothing qualifies yet;
 *   - never the record's rule (that is on its list level).
 * - While the summary loads, a status line holds the cards' place.
 * - Nothing prints null, undefined or NaN.
 *
 * The record level the cards open is `RecordLevel.test.tsx`'s, Seasonal is
 * `RecordsSeasonal.test.tsx`'s and the request counts are
 * `records-requests.test.tsx`'s.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http } from "msw";
import { beforeAll, describe, expect, it } from "vitest";

import { formatGameDate } from "../games/format";
import {
  ADEBAYO,
  ADEBAYO_GAME,
  BOBCATS,
  HEAT,
  LEBRON,
  NUGGETS_GAME,
  RECORD_DEFINITIONS,
  SINCE_SEASON,
  THROUGH_SEASON,
  WARRIORS,
  emptyRecordsSummary,
  playerName,
  recordDefinition,
  recordsOf,
} from "../../test/records";
import {
  MISSING,
  findCard,
  findCards,
  groupBar,
  norm,
  openRecords,
  panelOf,
  params,
  queryTablistHolding,
  selectedTab,
  tab,
  tabNames,
  viewAll,
  viewBar,
} from "../../test/records-screen";
import { CELTICS, NUGGETS } from "../../test/stats";
import { rowText } from "../../test/tables";

// The Director's correction (FRONTEND-019): the Records tab is a lazy route,
// and the first test of a file to open it waited on the cold transform of its
// chunk (RecordsTab and the shared navigator), which overran findBy's 1 s
// under the full suite's load. Importing it once here does that work outside
// any test; no assertion changes.
beforeAll(async () => {
  await import("./RecordsTab");
}, 30_000);

const FOCUSABLE =
  'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

describe("the view bar: Historical / Seasonal", () => {
  it("opens on Historical, with ?view= not written", async () => {
    const { router } = openRecords();

    await findCards("team");
    expect(tabNames(viewBar())).toEqual(["Historical", "Seasonal"]);
    expect(selectedTab(viewBar())).toBe("Historical");
    expect(params(router).has("view")).toBe(false);
  });

  it("shows Historical for an unknown ?view=", async () => {
    openRecords("/stats/records?view=sideways");

    await findCards("team");
    expect(selectedTab(viewBar())).toBe("Historical");
  });

  it("holds the group bar and the cards in its panel", async () => {
    openRecords();

    const cards = await findCards("team");
    const panel = panelOf(viewBar());
    expect(panel.contains(groupBar())).toBe(true);
    expect(panel.contains(cards[0])).toBe(true);
    expect(viewBar().contains(groupBar())).toBe(false);
  });

  it("Seasonal is written as ?view=seasonal and replaces the history entry", async () => {
    const { router } = openRecords();
    const user = userEvent.setup();
    await findCards("team");

    await user.click(tab(viewBar(), "Seasonal"));

    await waitFor(() => expect(params(router).get("view")).toBe("seasonal"));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(selectedTab(viewBar())).toBe("Seasonal");
    expect(screen.queryByRole("list", { name: /team records/i })).toBeNull();
  });

  it("switching the view drops group, and Historical is not written", async () => {
    const { router } = openRecords("/stats/records?group=player");
    const user = userEvent.setup();
    await findCards("player");

    await user.click(tab(viewBar(), "Seasonal"));
    await waitFor(() => expect(params(router).get("view")).toBe("seasonal"));
    expect(params(router).has("group")).toBe(false);

    await user.click(tab(viewBar(), "Historical"));
    await waitFor(() => expect(params(router).has("view")).toBe(false));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(router.state.location.search).toBe("");
    // Back on Historical, on its default group.
    await findCards("team");
    expect(selectedTab(groupBar())).toBe("Team");
  });

  it("switching the view from Seasonal drops season", async () => {
    const { router } = openRecords(
      "/stats/records?view=seasonal&season=2023-24",
    );
    const user = userEvent.setup();
    await waitFor(() => expect(selectedTab(viewBar())).toBe("Seasonal"));

    await user.click(tab(viewBar(), "Historical"));

    await waitFor(() => expect(params(router).has("view")).toBe(false));
    expect(params(router).has("season")).toBe(false);
    await findCards("team");
  });

  it("moves between its tabs with the arrow keys (one tab stop)", async () => {
    const { router } = openRecords();
    const user = userEvent.setup();
    await findCards("team");

    tab(viewBar(), "Historical").focus();
    await user.keyboard("{ArrowRight}");

    await waitFor(() => expect(params(router).get("view")).toBe("seasonal"));
    expect(
      within(viewBar())
        .getAllByRole("tab")
        .filter((t) => t.getAttribute("tabindex") === "0"),
    ).toHaveLength(1);
  });
});

describe("the group bar: Team / Player", () => {
  it("opens on Team, with ?group= not written, and the h2 Team records", async () => {
    const { router } = openRecords();

    await findCards("team");
    expect(tabNames(groupBar())).toEqual(["Team", "Player"]);
    expect(selectedTab(groupBar())).toBe("Team");
    expect(params(router).has("group")).toBe(false);
    expect(
      screen.getByRole("heading", { level: 2, name: "Team records" }),
    ).toBeVisible();
  });

  it("Player is written as ?group=player, replaces the history entry, and shows the player cards", async () => {
    const { router } = openRecords();
    const user = userEvent.setup();
    await findCards("team");

    await user.click(tab(groupBar(), "Player"));

    await waitFor(() => expect(params(router).get("group")).toBe("player"));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(selectedTab(groupBar())).toBe("Player");
    await findCards("player");
    expect(screen.queryByRole("list", { name: /team records/i })).toBeNull();
    expect(
      screen.getByRole("heading", { level: 2, name: "Player records" }),
    ).toBeVisible();
  });

  it("Team drops ?group=", async () => {
    const { router } = openRecords("/stats/records?group=player");
    const user = userEvent.setup();
    await findCards("player");

    await user.click(tab(groupBar(), "Team"));

    await waitFor(() => expect(params(router).has("group")).toBe(false));
    expect(router.state.historyAction).toBe("REPLACE");
    await findCards("team");
  });

  it("opens on ?group=player (a reload or a shared link)", async () => {
    openRecords("/stats/records?group=player");

    await findCards("player");
    expect(selectedTab(groupBar())).toBe("Player");
  });

  it("shows Team for an unknown ?group=", async () => {
    openRecords("/stats/records?group=coaches");

    await findCards("team");
    expect(selectedTab(groupBar())).toBe("Team");
  });

  it("holds the cards in its own panel", async () => {
    openRecords("/stats/records?group=player");

    const cards = await findCards("player");
    expect(panelOf(groupBar()).contains(cards[0])).toBe(true);
  });

  it("is not on Seasonal", async () => {
    openRecords("/stats/records?view=seasonal");

    await waitFor(() => expect(selectedTab(viewBar())).toBe("Seasonal"));
    expect(queryTablistHolding("Player")).toBeNull();
  });
});

describe("the data window", () => {
  it("names the window once: Since <since>, through <through>", async () => {
    openRecords();

    await findCards("team");
    const panel = panelOf(viewBar());
    const line = `Since ${SINCE_SEASON}, through ${THROUGH_SEASON}`;
    expect(norm(panel.textContent)).toContain(line);
    expect(norm(panel.textContent).split(line)).toHaveLength(2);
  });

  it("shows no window line when the API has no window", async () => {
    openRecords("/stats/records", { summary: emptyRecordsSummary() });

    await findCards("team");
    expect(norm(panelOf(viewBar()).textContent)).not.toMatch(/\bsince\b/i);
    expect(screen.getByRole("main").textContent).not.toMatch(MISSING);
  });
});

describe("the cards", () => {
  it.each(["team", "player"] as const)(
    "lists the %s records in the API's order, one card each, titled by an h3",
    async (group) => {
      openRecords(
        group === "player" ? "/stats/records?group=player" : undefined,
      );

      const cards = await findCards(group);
      expect(
        cards.map((card) =>
          within(card).getByRole("heading", { level: 3 }).textContent?.trim(),
        ),
      ).toEqual(recordsOf(group).map((record) => record.title));
    },
  );

  it.each(RECORD_DEFINITIONS.map((record) => [record.id, record] as const))(
    "%s: exactly one interactive element, View all, named with the title, at its address",
    async (_id, record) => {
      openRecords(
        record.group === "player" ? "/stats/records?group=player" : undefined,
      );

      const card = await findCard(record.group, record.title);
      expect(card.querySelectorAll(FOCUSABLE)).toHaveLength(1);
      expect(within(card).getAllByRole("link")).toHaveLength(1);
      expect(within(card).queryAllByRole("button")).toEqual([]);

      const link = viewAll(card);
      expect(link).toHaveAttribute(
        "href",
        `/stats/records?record=${record.id}`,
      );
      expect(link.textContent).toMatch(/view all/i);
      expect(link).toHaveAccessibleName(new RegExp(record.title));
    },
  );

  it("never shows a record's rule on its card", async () => {
    openRecords();
    const cards = await findCards("team");

    for (const record of recordsOf("team")) {
      const card = cards.find(
        (item) =>
          within(item).queryByRole("heading", {
            level: 3,
            name: record.title,
          }) !== null,
      );
      expect(norm(card?.textContent)).not.toContain(record.rule);
    }
  });

  it("a team's season record: the team, the percentage with its unit, the season", async () => {
    openRecords();

    const card = await findCard(
      "team",
      recordDefinition("team-best-season").title,
    );
    const text = rowText(card);
    expect(text).toContain(WARRIORS.name);
    expect(text).toMatch(/(?<![\d.])\.890(?!\d)/);
    expect(text).not.toMatch(/0\.89/);
    expect(text).toContain("win %");
    expect(text).toContain("2015-16");
    expect(text).not.toMatch(/\bother/);
    // The holder is plain text: the card's one link is View all.
    expect(
      within(card).queryByRole("link", { name: new RegExp(WARRIORS.name) }),
    ).toBeNull();
  });

  it("a team's single-game record: the team, the value with its unit, the game's date and opponent", async () => {
    openRecords();

    const card = await findCard(
      "team",
      recordDefinition("team-most-points-game").title,
    );
    const text = rowText(card);
    expect(text).toContain(NUGGETS.name);
    expect(text).toMatch(/(?<![\d.])168(?!\d)/);
    expect(text).toContain("points");
    expect(text).toContain(formatGameDate(NUGGETS_GAME.date));
    expect(text).toContain("PHX");
  });

  it("a tie of two says 'and 1 other'", async () => {
    openRecords();

    const card = await findCard(
      "team",
      recordDefinition("team-championships").title,
    );
    const text = rowText(card);
    expect(text).toContain(CELTICS.name);
    expect(text).toMatch(/(?<![\d.])4(?!\d)/);
    expect(text).toContain("titles");
    expect(text).toMatch(/\band 1 other\b(?!s)/);
  });

  it("a tie of three says 'and 2 others'", async () => {
    openRecords("/stats/records?group=player");

    const card = await findCard(
      "player",
      recordDefinition("player-assists-game").title,
    );
    expect(rowText(card)).toMatch(/\band 2 others\b/);
  });

  it("a record alone at the top names no others", async () => {
    openRecords();

    const card = await findCard(
      "team",
      recordDefinition("team-worst-season").title,
    );
    const text = rowText(card);
    expect(text).toContain(BOBCATS.name);
    expect(text).toMatch(/(?<![\d.])\.106(?!\d)/);
    expect(text).toContain("2011-12");
    expect(text).not.toMatch(/\bother/);
  });

  it("a record with no holder says nothing qualifies yet", async () => {
    openRecords();

    const card = await findCard(
      "team",
      recordDefinition("team-largest-win").title,
    );
    expect(rowText(card)).toMatch(/qualif/i);
    expect(card.textContent).not.toMatch(MISSING);
    expect(card.querySelectorAll(FOCUSABLE)).toHaveLength(1);
  });

  it("every card says nothing qualifies on an empty database", async () => {
    openRecords("/stats/records", { summary: emptyRecordsSummary() });

    const cards = await findCards("team");
    expect(cards).toHaveLength(recordsOf("team").length);
    for (const card of cards) expect(rowText(card)).toMatch(/qualif/i);
  });

  it("a player's single-game record: first and last name, the team he played for, the value, the date and opponent", async () => {
    openRecords("/stats/records?group=player");

    const card = await findCard(
      "player",
      recordDefinition("player-points-game").title,
    );
    const text = rowText(card);
    expect(text).toContain(playerName(ADEBAYO));
    expect(text.includes(HEAT.name) || /\bMIA\b/.test(text)).toBe(true);
    expect(text).toMatch(/(?<![\d.])83(?!\d)/);
    expect(text).toContain("points");
    expect(text).toContain(formatGameDate(ADEBAYO_GAME.date));
    expect(text).toContain("WAS");
    expect(
      within(card).queryByRole("link", {
        name: new RegExp(playerName(ADEBAYO)),
      }),
    ).toBeNull();
  });

  it("a player's career record: the name and the value with its unit", async () => {
    openRecords("/stats/records?group=player");

    const card = await findCard(
      "player",
      recordDefinition("player-career-points").title,
    );
    const text = rowText(card);
    expect(text).toContain(playerName(LEBRON));
    expect(text).toMatch(/42,?184/);
    expect(text).toContain("points");
  });

  it("holds the cards' place with a status line while the summary loads", async () => {
    openRecords("/stats/records", {
      handlers: [
        http.get("*/events/records", async () => {
          await delay("infinite");
        }),
      ],
    });

    await waitFor(() =>
      expect(
        within(panelOf(viewBar())).getAllByRole("status").length,
      ).toBeGreaterThan(0),
    );
    expect(screen.queryByRole("list", { name: /team records/i })).toBeNull();
    expect(screen.getByRole("main").textContent).not.toMatch(MISSING);
  });

  it("shows an alert in place when the summary fails", async () => {
    const opened = openRecords();
    // Set before the lazy tab has loaded, so the first answer is the failure.
    opened.stubs.summary.fail();

    expect(
      await within(screen.getByRole("main")).findByRole("alert"),
    ).toBeVisible();
    expect(screen.getByRole("main").textContent).not.toMatch(MISSING);
  });
});

describe("nothing prints null, undefined or NaN", () => {
  it.each(["/stats/records", "/stats/records?group=player"])(
    "on %s",
    async (path) => {
      openRecords(path);

      await findCards(path.includes("player") ? "player" : "team");
      expect(screen.getByRole("main").textContent).not.toMatch(MISSING);
    },
  );
});
