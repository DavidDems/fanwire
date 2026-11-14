/**
 * FRONTEND-042: each Historical record card shows the record's top three
 * (`top`, EVENTS-016, from the one holders read), the holder in semibold,
 * each entry in at most two lines; and a record's own list sets its rank-1
 * names in semibold too.
 *
 * The interface this file pins, through the real route table:
 *
 * - **The card** keeps its `h3` title and its category line, and lists the
 *   holder's `top` entries in the API's order as a list (`ol` or `ul`), one
 *   list item per entry.
 * - **An entry is two lines.** Line 1 holds the team icon (a team record's
 *   team; a player's single-game record: the team they played for), the
 *   name (a team's short name, `teamShortName`: "Warriors"; a player's full
 *   name, with no team name beside it) and the value (`RecordValue`); line 2,
 *   an element of its own after line 1, holds the season or the game's date,
 *   at `--font-size-sm` in `--color-text-muted`. "Line 1" is read as the
 *   innermost element holding the icon, the name and the value: it must not
 *   hold line 2.
 * - **Line 1 does not wrap**: an element from the name up to line 1 sets
 *   `text-overflow: ellipsis` and `overflow: hidden` (or `clip`) and resolves
 *   `white-space: nowrap`; the full name stays in the DOM.
 * - **Weight.** The holder's name and value resolve to
 *   `--font-weight-semibold`, and so does every entry whose value equals the
 *   holder's (a tie: also a holder); every other entry's name and value
 *   resolve to `--font-weight-regular`. Two entries tied with each other
 *   below the holder stay regular.
 * - **More holders than shown.** When `tied_count` is more than the entries
 *   shown, a muted line says how many more ("2 more", whatever surrounds the
 *   number); otherwise no such line, and never "and N others".
 * - **Fewer than three** shows what there is; no holder shows "Nothing
 *   qualifies yet." and no entries.
 * - **Loading.** While the holders load, a card holds three entries' place:
 *   three placeholder rows (`Skeleton` line bars: one per entry, or one per
 *   line, so 3 or 6).
 * - **A record's list** (`RecordLevel`): a rank-1 row's name resolves to
 *   semibold, every other row's to regular.
 * - **Requests unchanged**: one holders read for the page of cards, and no
 *   record list read while on the cards.
 *
 * jsdom computes no CSS, so weights, sizes and colours are resolved from the
 * stylesheets by `test/record-cards.ts` (`verification.md` §2a).
 */
import { screen, waitFor, within } from "@testing-library/react";
import { delay, http } from "msw";
import { beforeAll, describe, expect, it } from "vitest";

import iconStyles from "../../components/ui/TeamIcon.module.css";
import skeletonStyles from "../../components/ui/Skeleton.module.css";
import { formatGameDate, teamShortName } from "../games/format";
import {
  ADEBAYO,
  ADEBAYO_GAME,
  HALIBURTON,
  HARDEN,
  HEAT,
  NUGGETS_GAME,
  RONDO,
  WARRIORS,
  playerName,
  recordDefinition,
  testRecordsSummary,
} from "../../test/records";
import {
  REGULAR,
  SEMIBOLD,
  chain,
  commonAncestor,
  holding,
  ownStyle,
  styleOf,
  textNode,
  textNodeContaining,
} from "../../test/record-cards";
import { findRecordCard, norm, openRecords } from "../../test/records-screen";
import { CELTICS, NUGGETS, SUNS } from "../../test/stats";
import { bodyRows } from "../../test/tables";

// As the other records files: warm the lazy Records chunk outside any test.
beforeAll(async () => {
  await import("./RecordsTab");
}, 30_000);

const short = (name: string) => teamShortName(name);

/** A card's entries: the list items of the one list inside it. */
function entriesOf(card: HTMLElement): HTMLElement[] {
  const lists = within(card).queryAllByRole("list");
  expect(lists, "the card holds no list of entries").toHaveLength(1);
  const [list] = lists;
  return within(list)
    .queryAllByRole("listitem")
    .filter((item) => item.parentElement === list);
}

/** A card once its holders have landed (its list of entries is shown). */
async function landedCard(id: string): Promise<HTMLElement> {
  const card = await findRecordCard(id);
  await waitFor(() =>
    expect(
      within(card).queryAllByRole("list").length +
        (/qualif/i.test(norm(card.textContent)) ? 1 : 0),
      `${id}'s card shows no list of its top entries: ${norm(card.textContent)}`,
    ).toBeGreaterThan(0),
  );
  return (await findRecordCard(id)) as HTMLElement;
}

function iconsIn(root: Element): Element[] {
  return Array.from(root.querySelectorAll(`.${iconStyles.icon}`));
}

interface Shape {
  name: string;
  value: string;
  when: string;
  icon?: string;
}

/** An entry's two lines: icon, name and value on line 1; `when` on line 2. */
function expectTwoLines(entry: HTMLElement, shape: Shape): void {
  const name = textNode(entry, shape.name);
  const value = textNode(entry, shape.value);
  const when = textNodeContaining(entry, shape.when);
  expect(
    name,
    `no name "${shape.name}" in ${norm(entry.textContent)}`,
  ).not.toBeNull();
  expect(
    value,
    `no value "${shape.value}" in ${norm(entry.textContent)}`,
  ).not.toBeNull();
  expect(
    when,
    `no "${shape.when}" in ${norm(entry.textContent)}`,
  ).not.toBeNull();

  const parts: Node[] = [name as Text, value as Text];
  const icons = iconsIn(entry);
  if (shape.icon === undefined) {
    expect(icons, "an entry with no team has no icon").toEqual([]);
  } else {
    expect(icons, "one team icon per entry").toHaveLength(1);
    expect(norm(icons[0].textContent)).toBe(shape.icon);
    expect(icons[0]).toHaveAttribute("aria-hidden", "true");
    parts.push(icons[0]);
  }

  const line1 = commonAncestor(...parts);
  expect(
    line1.contains(when as Text),
    `line 1 (${norm(line1.textContent)}) also holds "${shape.when}"`,
  ).toBe(false);
  expect(
    line1.compareDocumentPosition(when as Text) &
      Node.DOCUMENT_POSITION_FOLLOWING,
    "line 2 comes after line 1",
  ).toBeTruthy();

  const line2 = (when as Text).parentElement as HTMLElement;
  expect(line2.contains(name as Text)).toBe(false);
  expect(styleOf(line2, "font-size")).toBe("var(--font-size-sm)");
  expect(styleOf(line2, "color")).toBe("var(--color-text-muted)");
}

/** The resolved font-weight of the element holding `text` in `root`. */
function weightOf(root: Element, text: string): string | undefined {
  return styleOf(holding(root, text), "font-weight");
}

function expectWeight(
  root: Element,
  text: string,
  weight: "semibold" | "regular",
): void {
  const resolved = weightOf(root, text);
  expect(
    weight === "semibold" ? SEMIBOLD : REGULAR,
    `"${text}" resolves to font-weight ${resolved}, not ${weight}`,
  ).toContain(resolved ?? "normal");
}

// --------------------------------------------------------- the top three

describe("a card's top three", () => {
  it("keeps its title and category, and lists the top three in order: Best regular season", async () => {
    openRecords();

    const card = await landedCard("team-best-season");
    expect(
      within(card).getByRole("heading", { level: 3 }).textContent?.trim(),
    ).toBe(recordDefinition("team-best-season").title);
    expect(norm(card.textContent)).toMatch(/franchise|season/i);

    const entries = entriesOf(card);
    expect(entries).toHaveLength(3);
    expectTwoLines(entries[0], {
      name: "Warriors",
      value: "73–9",
      when: "2015-16",
      icon: WARRIORS.abbreviation,
    });
    expectTwoLines(entries[1], {
      name: short(CELTICS.name),
      value: "69–13",
      when: "2023-24",
      icon: CELTICS.abbreviation,
    });
    expectTwoLines(entries[2], {
      name: short(NUGGETS.name),
      value: "53–10",
      when: "2008-09",
      icon: NUGGETS.abbreviation,
    });
    // Short names: no city.
    expect(norm(card.textContent)).not.toContain("Golden State");
    expect(norm(card.textContent)).not.toContain(CELTICS.name);
  });

  it("a player's single-game record: the full name, the team he played for as its icon, the game's date on line 2", async () => {
    openRecords("/stats/records?group=player");

    const card = await landedCard("player-points-game");
    const entries = entriesOf(card);
    expect(entries).toHaveLength(3);
    expectTwoLines(entries[0], {
      name: playerName(ADEBAYO),
      value: "83",
      when: formatGameDate(ADEBAYO_GAME.date),
      icon: HEAT.abbreviation,
    });
    // The player's name alone: the team is the icon, not a name beside it.
    expect(norm(entries[0].textContent)).not.toContain(HEAT.name);
    expect(textNode(entries[0], playerName(ADEBAYO))?.textContent?.trim()).toBe(
      playerName(ADEBAYO),
    );
    expectTwoLines(entries[1], {
      name: "Test Scorer 1",
      value: "81",
      when: "30 Jan 2025",
      icon: CELTICS.abbreviation,
    });
    expectTwoLines(entries[2], {
      name: "Test Scorer 2",
      value: "81",
      when: "23 Jan 2025",
      icon: NUGGETS.abbreviation,
    });
  });

  it("a player's career record: the name and the value, no icon (no team)", async () => {
    openRecords();

    const card = await landedCard("player-career-points");
    const entries = entriesOf(card);
    expect(entries).toHaveLength(2);
    expect(iconsIn(card)).toEqual([]);
    expect(norm(entries[0].textContent)).toContain("LeBron James");
    expect(norm(entries[0].textContent)).toMatch(/42,184/);
    expect(norm(entries[1].textContent)).toContain(playerName(HARDEN));
  });

  it("line 1 does not wrap: it is cut with an ellipsis, the full name still in the DOM", async () => {
    openRecords("/stats/records?group=player");

    const card = await landedCard("player-points-game");
    const shown: [string, string][] = [
      [playerName(ADEBAYO), "83"],
      ["Test Scorer 1", "81"],
      ["Test Scorer 2", "81"],
    ];
    const entries = entriesOf(card);
    expect(entries).toHaveLength(3);
    entries.forEach((entry, index) => {
      const [text, figure] = shown[index];
      const name = holding(entry, text);
      const line1 = commonAncestor(name, holding(entry, figure));
      const clipped = chain(name, line1).find(
        (element) =>
          ownStyle(element, "text-overflow") === "ellipsis" &&
          ["hidden", "clip"].includes(
            ownStyle(element, "overflow") ??
              ownStyle(element, "overflow-x") ??
              "",
          ) &&
          styleOf(element, "white-space") === "nowrap",
      );
      expect(
        clipped,
        `nothing from the name to line 1 is nowrap, overflow hidden and text-overflow ellipsis (${norm(entry.textContent)})`,
      ).toBeDefined();
    });
    // The whole name is there for assistive technology.
    expect(norm(card.textContent)).toContain(playerName(ADEBAYO));
  });
});

// ------------------------------------------------------------- the weight

describe("the holder in semibold", () => {
  it("Best regular season: the Warriors' name and 73–9 semibold, the 2nd and 3rd regular", async () => {
    openRecords();

    const entries = entriesOf(await landedCard("team-best-season"));
    expectWeight(entries[0], "Warriors", "semibold");
    expectWeight(entries[0], "73–9", "semibold");
    expectWeight(entries[1], short(CELTICS.name), "regular");
    expectWeight(entries[1], "69–13", "regular");
    expectWeight(entries[2], short(NUGGETS.name), "regular");
    expectWeight(entries[2], "53–10", "regular");
  });

  it("a tie of two at the top: both holders semibold, the third regular", async () => {
    openRecords();

    const entries = entriesOf(await landedCard("team-championships"));
    expect(entries).toHaveLength(3);
    expectWeight(entries[0], short(CELTICS.name), "semibold");
    expectWeight(entries[1], "Warriors", "semibold");
    expectWeight(entries[2], short(NUGGETS.name), "regular");
  });

  it("a tie of three at the top: all three names and values semibold", async () => {
    openRecords("/stats/records?group=player");

    const entries = entriesOf(await landedCard("player-assists-game"));
    expect(entries).toHaveLength(3);
    [RONDO, HALIBURTON, HARDEN].forEach((player, index) => {
      expectWeight(entries[index], playerName(player), "semibold");
      expectWeight(entries[index], "25", "semibold");
    });
  });

  it("two entries tied with each other below the holder stay regular", async () => {
    openRecords("/stats/records?group=player");

    const entries = entriesOf(await landedCard("player-points-game"));
    expectWeight(entries[0], playerName(ADEBAYO), "semibold");
    expectWeight(entries[0], "83", "semibold");
    for (const [index, name] of [
      [1, "Test Scorer 1"],
      [2, "Test Scorer 2"],
    ] as const) {
      expectWeight(entries[index], name, "regular");
      expectWeight(entries[index], "81", "regular");
    }
  });
});

describe("more holders than the card shows", () => {
  it("says how many more in a muted line when tied_count is past the three shown", async () => {
    const summary = testRecordsSummary();
    const records = summary.records.map((record) =>
      record.id === "player-assists-game" && record.holder !== null
        ? { ...record, holder: { ...record.holder, tied_count: 5 } }
        : record,
    );
    openRecords("/stats/records?group=player", {
      summary: { ...summary, records },
    });

    const card = await landedCard("player-assists-game");
    expect(entriesOf(card)).toHaveLength(3);
    const lines = Array.from(card.querySelectorAll<HTMLElement>("*")).filter(
      (element) => /(?<!\d)2 more\b/i.test(norm(element.textContent)),
    );
    const line = lines.find(
      (element) =>
        !lines.some((other) => other !== element && element.contains(other)),
    );
    expect(line, `no "2 more" line in ${norm(card.textContent)}`).toBeDefined();
    expect(styleOf(line as HTMLElement, "font-size")).toBe(
      "var(--font-size-sm)",
    );
    expect(styleOf(line as HTMLElement, "color")).toBe(
      "var(--color-text-muted)",
    );
    expect(norm(card.textContent)).not.toMatch(/\bothers?\b/);
  });

  it.each([
    ["team-championships", "/stats/records"],
    ["player-assists-game", "/stats/records?group=player"],
    ["team-best-season", "/stats/records"],
  ])(
    "%s: every holder is shown, so no 'more' line and no 'and N others'",
    async (id, path) => {
      openRecords(path);

      const card = await landedCard(id);
      expect(entriesOf(card).length).toBeGreaterThan(0);
      expect(norm(card.textContent)).not.toMatch(/\bmore\b/i);
      expect(norm(card.textContent)).not.toMatch(/\bothers?\b/);
    },
  );
});

describe("fewer than three, none, and loading", () => {
  it("two entries show two: the most points in a game", async () => {
    openRecords();

    const entries = entriesOf(await landedCard("team-most-points-game"));
    expect(entries).toHaveLength(2);
    expectTwoLines(entries[0], {
      name: short(NUGGETS.name),
      value: "168",
      when: formatGameDate(NUGGETS_GAME.date),
      icon: NUGGETS.abbreviation,
    });
    expect(norm(entries[1].textContent)).toContain(short(SUNS.name));
  });

  it("one entry shows one: the most rebounds in a game", async () => {
    openRecords("/stats/records?group=player");

    const entries = entriesOf(await landedCard("player-rebounds-game"));
    expect(entries).toHaveLength(1);
    expect(norm(entries[0].textContent)).toContain("Nikola Jokic");
  });

  it("no holder says 'Nothing qualifies yet.' and lists nothing", async () => {
    openRecords();

    const card = await landedCard("team-largest-win");
    expect(within(card).getByText("Nothing qualifies yet.")).toBeVisible();
    expect(within(card).queryAllByRole("listitem")).toEqual([]);
  });

  it("holds three entries' place while the holders load", async () => {
    openRecords("/stats/records", {
      handlers: [
        http.get("*/events/records/holders", async () => {
          await delay("infinite");
        }),
      ],
    });

    const card = await findRecordCard("team-best-season");
    const bars = card.querySelectorAll(`.${skeletonStyles.bar}`);
    expect(
      [3, 6],
      `the loading card shows ${bars.length} placeholder rows`,
    ).toContain(bars.length);
    for (const bar of Array.from(bars))
      expect(bar.closest("[aria-hidden='true']")).not.toBeNull();
  });
});

// --------------------------------------------------------- a record's list

describe("a record's own list: rank-1 names in semibold", () => {
  it.each([
    [
      "team-championships",
      [CELTICS.name, WARRIORS.name, NUGGETS.name],
      [1, 1, 3],
    ],
    [
      "player-points-game",
      [playerName(ADEBAYO), "Test Scorer 1", "Test Scorer 2"],
      [1, 2, 2],
    ],
    [
      "player-assists-game",
      [playerName(RONDO), playerName(HALIBURTON), playerName(HARDEN)],
      [1, 1, 1],
    ],
  ] as const)("%s", async (id, names, ranks) => {
    openRecords(`/stats/records?record=${id}`);

    await screen.findByRole("heading", {
      level: 2,
      name: recordDefinition(id).title,
    });
    const table = (await within(screen.getByRole("main")).findByRole(
      "table",
    )) as HTMLTableElement;
    const rows = bodyRows(table);
    names.forEach((name, index) => {
      const header = rows[index].querySelector("th") as HTMLElement;
      expect(norm(rows[index].cells[0].textContent)).toBe(String(ranks[index]));
      expectWeight(header, name, ranks[index] === 1 ? "semibold" : "regular");
    });
  });
});

// ------------------------------------------------------------ the requests

describe("requests unchanged", () => {
  it("one holders read for the page of cards, and no record's list read", async () => {
    const { stubs } = openRecords();

    // Every card's holders are on screen (the last featured card's too)
    // before counting: the read is done, and any per-card read would be too.
    const first = await findRecordCard("team-best-season");
    await waitFor(() => expect(norm(first.textContent)).toContain("73–9"));
    const last = await findRecordCard("team-largest-win");
    await waitFor(() => expect(norm(last.textContent)).toMatch(/qualif/i));
    expect(stubs.holders.requests).toHaveLength(1);
    expect(stubs.list.requests).toHaveLength(0);
  });
});
