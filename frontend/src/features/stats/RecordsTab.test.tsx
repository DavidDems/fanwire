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
 * - **The group bar.** Inside Historical, a second `SegmentedTabs` bar, Top
 *   records, Team and Player, Top records the default (`FRONTEND-030`; it
 *   was Team). Player is `?group=player` and Team `?group=team`, written
 *   explicitly; Top records is never written, and an unknown `?group=` shows
 *   Top records. It too replaces the history entry. Its panel holds the
 *   cards. `RecordsHome.test.tsx` pins Top records and the search.
 * - **The records level's heading** is an `h2`, "Top records", "Team
 *   records" or "Player records".
 * - **One data-window line**: "Since <since_season>, through
 *   <through_season>" from `GET /events/records`; with no window, no line.
 * - **The cards**: a list named by its bar ("Team records"), one list item
 *   per record, a group's first 24 in the API's order. Each card:
 *   - its title as an `h3`;
 *   - exactly one interactive element, a "View all" link whose accessible
 *     name includes the title, at `/stats/records?record=<id>`;
 *   - the holder as plain text: the team's short name (`FRONTEND-042`:
 *     "Warriors", as `teamShortName` gives it), or the player's first and
 *     last name and, for a single-game record, the team they played for; the
 *     value with its unit (a win percentage as `.890`, three places, no
 *     leading zero, as the standings show one; since EVENTS-011 a season
 *     record shows its wins and losses first, `73–9 (.890)`, and
 *     `RecordValues.test.tsx` pins the shapes); the season, or the game's date
 *     (`d MMM yyyy`, as `games/format` prints it);
 *   - a tie (`FRONTEND-042`): the card lists the top three, so a tie of two or
 *     three shows every holder and says nothing of "others";
 *     `RecordCardsTop.test.tsx` pins the entries, their lines and weights;
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

import { formatGameDate, teamShortName } from "../games/format";
import {
  ADEBAYO,
  ADEBAYO_GAME,
  BOBCATS,
  HALIBURTON,
  HARDEN,
  HEAT,
  LEBRON,
  NUGGETS_GAME,
  FEATURED_IDS,
  PAGE_SIZE,
  RONDO,
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
  cardId,
  findCard,
  findCards,
  findRecordCard,
  groupBar,
  norm,
  openRecords,
  panelOf,
  params,
  queryCardList,
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

    await findCards("top");
    expect(tabNames(viewBar())).toEqual(["Historical", "Seasonal"]);
    expect(selectedTab(viewBar())).toBe("Historical");
    expect(params(router).has("view")).toBe(false);
  });

  it("shows Historical for an unknown ?view=", async () => {
    openRecords("/stats/records?view=sideways");

    await findCards("top");
    expect(selectedTab(viewBar())).toBe("Historical");
  });

  it("holds the group bar and the cards in its panel", async () => {
    openRecords();

    const cards = await findCards("top");
    const panel = panelOf(viewBar());
    expect(panel.contains(groupBar())).toBe(true);
    expect(panel.contains(cards[0])).toBe(true);
    expect(viewBar().contains(groupBar())).toBe(false);
  });

  it("Seasonal is written as ?view=seasonal and replaces the history entry", async () => {
    const { router } = openRecords();
    const user = userEvent.setup();
    await findCards("top");

    await user.click(tab(viewBar(), "Seasonal"));

    await waitFor(() => expect(params(router).get("view")).toBe("seasonal"));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(selectedTab(viewBar())).toBe("Seasonal");
    expect(queryCardList()).toBeNull();
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
    // Back on Historical, on its default, Top records.
    await findCards("top");
    expect(selectedTab(groupBar())).toBe("Top records");
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
    await findCards("top");
  });

  it("moves between its tabs with the arrow keys (one tab stop)", async () => {
    const { router } = openRecords();
    const user = userEvent.setup();
    await findCards("top");

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

describe("the group bar: Top records / Team / Player", () => {
  it("keeps focus on the selected group tab while using the arrow keys", async () => {
    openRecords();
    const user = userEvent.setup();
    await findCards("top");
    tab(groupBar(), "Top records").focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(tab(groupBar(), "Team")).toHaveFocus());
    expect(selectedTab(groupBar())).toBe("Team");
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(tab(groupBar(), "Player")).toHaveFocus());
    expect(selectedTab(groupBar())).toBe("Player");
    await user.keyboard("{ArrowLeft}");
    await waitFor(() => expect(tab(groupBar(), "Team")).toHaveFocus());
    expect(selectedTab(groupBar())).toBe("Team");
  });

  it("opens on Top records, with ?group= not written, and the h2 Top records", async () => {
    const { router } = openRecords();

    await findCards("top");
    expect(tabNames(groupBar())).toEqual(["Top records", "Team", "Player"]);
    expect(selectedTab(groupBar())).toBe("Top records");
    expect(params(router).has("group")).toBe(false);
    expect(
      screen.getByRole("heading", { level: 2, name: "Top records" }),
    ).toBeVisible();
  });

  it("Player is written as ?group=player, replaces the history entry, and shows the player cards", async () => {
    const { router } = openRecords();
    const user = userEvent.setup();
    await findCards("top");

    await user.click(tab(groupBar(), "Player"));

    await waitFor(() => expect(params(router).get("group")).toBe("player"));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(selectedTab(groupBar())).toBe("Player");
    await findCards("player");
    expect(screen.queryByRole("list", { name: /^top records$/i })).toBeNull();
    expect(
      screen.getByRole("heading", { level: 2, name: "Player records" }),
    ).toBeVisible();
  });

  it("Team writes ?group=team, explicitly (it is no longer the default)", async () => {
    const { router } = openRecords("/stats/records?group=player");
    const user = userEvent.setup();
    await findCards("player");

    await user.click(tab(groupBar(), "Team"));

    await waitFor(() => expect(params(router).get("group")).toBe("team"));
    expect(router.state.historyAction).toBe("REPLACE");
    await findCards("team");
    expect(
      screen.getByRole("heading", { level: 2, name: "Team records" }),
    ).toBeVisible();
  });

  it("opens on ?group=player (a reload or a shared link)", async () => {
    openRecords("/stats/records?group=player");

    await findCards("player");
    expect(selectedTab(groupBar())).toBe("Player");
  });

  it("shows Top records for an unknown ?group=", async () => {
    openRecords("/stats/records?group=coaches");

    await findCards("top");
    expect(selectedTab(groupBar())).toBe("Top records");
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

    await findCards("top");
    const panel = panelOf(viewBar());
    const line = `Since ${SINCE_SEASON}, through ${THROUGH_SEASON}`;
    expect(norm(panel.textContent)).toContain(line);
    expect(norm(panel.textContent).split(line)).toHaveLength(2);
  });

  it("shows no window line when the API has no window", async () => {
    openRecords("/stats/records", { summary: emptyRecordsSummary() });

    await findCards("top");
    expect(norm(panelOf(viewBar()).textContent)).not.toMatch(/\bsince\b/i);
    expect(screen.getByRole("main").textContent).not.toMatch(MISSING);
  });
});

describe("the cards", () => {
  it.each(["team", "player"] as const)(
    "lists the %s records' first 24 in the API's order, one card each, titled by an h3",
    async (group) => {
      openRecords(`/stats/records?group=${group}`);

      const cards = await findCards(group);
      expect(
        cards.map((card) =>
          within(card).getByRole("heading", { level: 3 }).textContent?.trim(),
        ),
      ).toEqual(
        recordsOf(group)
          .slice(0, PAGE_SIZE)
          .map((record) => record.title),
      );
    },
  );

  it.each(FEATURED_IDS.map((id) => [id, recordDefinition(id)] as const))(
    "%s: exactly one interactive element, View all, named with the title, at its address",
    async (id, record) => {
      openRecords();

      const card = await findRecordCard(id);
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
    const cards = await findCards("top");

    for (const card of cards) {
      const record = recordDefinition(cardId(card));
      expect(norm(card.textContent)).not.toContain(record.rule);
    }
  });

  it("a team's season record: the team, the record and its percentage, the season", async () => {
    openRecords();

    const card = await findCard(
      "team",
      recordDefinition("team-best-season").title,
    );
    const text = rowText(card);
    expect(text).toContain(teamShortName(WARRIORS.name));
    expect(text).toMatch(/(?<![\d.])\.890(?!\d)/);
    expect(text).not.toMatch(/0\.89/);
    // EVENTS-011: a season reads as its record, 73–9, before the percentage.
    expect(text).toContain("73–9");
    expect(text).toContain("2015-16");
    expect(text).not.toMatch(/\bother/);
    // The holder is plain text: the card's one link is View all.
    expect(
      within(card).queryByRole("link", { name: new RegExp(WARRIORS.name) }),
    ).toBeNull();
  });

  it("a team's single-game record: the team, the value with its unit, the game's date", async () => {
    openRecords();

    const card = await findCard(
      "team",
      recordDefinition("team-most-points-game").title,
    );
    const text = rowText(card);
    expect(text).toContain(teamShortName(NUGGETS.name));
    expect(text).toMatch(/(?<![\d.])168(?!\d)/);
    expect(text).toContain("points");
    expect(text).toContain(formatGameDate(NUGGETS_GAME.date));
  });

  it("a tie of two shows both holders and names no others", async () => {
    openRecords();

    const card = await findCard(
      "team",
      recordDefinition("team-championships").title,
    );
    const text = rowText(card);
    expect(text).toContain(teamShortName(CELTICS.name));
    expect(text).toContain(teamShortName(WARRIORS.name));
    expect(text).toMatch(/(?<![\d.])4(?!\d)/);
    expect(text).toContain("titles");
    expect(text).not.toMatch(/\bothers?\b/);
  });

  it("a tie of three shows all three holders and names no others", async () => {
    openRecords("/stats/records?group=player");

    const card = await findCard(
      "player",
      recordDefinition("player-assists-game").title,
    );
    const text = rowText(card);
    expect(text).toContain(playerName(RONDO));
    expect(text).toContain(playerName(HALIBURTON));
    expect(text).toContain(playerName(HARDEN));
    expect(text).not.toMatch(/\bothers?\b/);
  });

  it("a record alone at the top names no others", async () => {
    openRecords();

    const card = await findCard(
      "team",
      recordDefinition("team-worst-season").title,
    );
    const text = rowText(card);
    expect(text).toContain(teamShortName(BOBCATS.name));
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

  it.each(["team", "player"] as const)(
    "every empty %s record card says nothing qualifies and has decorative artwork",
    async (group) => {
      openRecords(`/stats/records?group=${group}`, {
        summary: emptyRecordsSummary(),
      });

      const cards = await findCards(group);
      expect(cards).toHaveLength(PAGE_SIZE);
      for (const card of cards) {
        expect(rowText(card)).toMatch(/qualif/i);
        const artwork = card.querySelector("svg[aria-hidden='true']");
        expect(artwork).not.toBeNull();
        expect(
          artwork?.querySelectorAll(
            "a, button, input, select, textarea, [tabindex]",
          ),
        ).toHaveLength(0);
      }
    },
  );

  it("a player's single-game record: first and last name, the team he played for, the value, the date", async () => {
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
    expect(
      within(card).queryByRole("link", {
        name: new RegExp(playerName(ADEBAYO)),
      }),
    ).toBeNull();
  });

  it("a player's career record: the name and the value with its unit", async () => {
    // On Top records: the career records are past the Player tab's first 24.
    openRecords();

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
    expect(queryCardList()).toBeNull();
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

      await findCards(path.includes("player") ? "player" : "top");
      expect(screen.getByRole("main").textContent).not.toMatch(MISSING);
    },
  );
});
