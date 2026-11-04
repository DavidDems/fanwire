/**
 * EVENTS-011: a record shows the figure a fan quotes, by its `value_kind`.
 *
 * The interface this file pins, on the record cards (`RecordsLevel`) and a
 * record's list (`RecordLevel`), through the real route table:
 *
 * - **win_loss** (the two season records): the wins and losses joined by an
 *   en dash, `73–9`, then the win percentage in parentheses, `(.890)`, in an
 *   element of its own whose colour is the muted text colour. The list's
 *   value column is headed "Record", and the note that the list ranks the
 *   exact percentage stays under the table.
 * - **made_total** (`player-threes-game`): the made count, `12`, then the
 *   percentage, `(57.1%)`, muted the same way; a null `pct` (nothing
 *   attempted) shows the count alone.
 * - **count**: the value alone, as before.
 * - **shot_pct** (`FRONTEND-030`, `player-three-pct-season`): the
 *   percentage, one place, `45.4%`, then the made and attempted counts,
 *   `(402/886)`, muted the same way, on the card and in the list.
 * - **average** (`FRONTEND-030`, `player-ppg-season`): one decimal, `31.0`,
 *   and on the card its unit, `31.0 points per game`.
 * - A `made_total` season record (`player-threes-season`) keeps EVENTS-011's
 *   form: `402`, then a muted `(45.4%)`.
 * - **One phrase to a screen reader.** The accessible text of a win_loss
 *   cell is exactly "73 wins, 9 losses, .890", and a card reads the same
 *   phrase, never the dash and the parenthesis apart.
 * - **The muted colour** is `--color-text-muted`, read from the rule of the
 *   parenthesis's own class, and keeps at least 4.5:1 on the card's surface
 *   (`--color-surface`) and its hover surface (`--color-surface-muted`) in
 *   both themes (`accessibility.md`; jsdom computes no CSS, so the rule is
 *   read from the stylesheet, `verification.md` §2a).
 */
import { screen, waitFor, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import {
  BOBCATS,
  WARRIORS,
  madeEntry,
  recordDefinition,
  testRecordList,
  testRecordsSummary,
  type RecordListOut,
} from "../../test/records";
import {
  MISSING,
  accessibleText,
  elementWithText,
  findCard,
  findRecordCard,
  norm,
  openRecords,
} from "../../test/records-screen";
import {
  DARK_SCHEME,
  allBlocks,
  contrastRatio,
  mediaRootCustomProperties,
  normaliseHex,
  parseCss,
  readSrcFile,
  resolveToken,
  resolveValue,
  rootCustomProperties,
  selectors,
} from "../../test/css";
import { bodyRows, columnHeaders } from "../../test/tables";

// As RecordLevel.test.tsx: warm the lazy Records chunk outside any test.
beforeAll(async () => {
  await import("./RecordsTab");
}, 30_000);

const EN_DASH = "–";

// ------------------------------------------------------------ the colour

/** Every module stylesheet a records view can take a class from. */
const MODULES = import.meta.glob<{ default: Record<string, string> }>(
  ["../../components/**/*.module.css", "./*.module.css"],
  { eager: true },
);

interface ClassRule {
  file: string;
  name: string;
}

/**
 * The module class (file and source name) behind each class of `element`.
 * Vitest does not process CSS here: a module's default export answers any
 * name with `_<name>_<hash of the file>` and lists no keys, so the name is
 * read back from the generated class, and the file is the module that gives
 * that name exactly that class.
 */
function moduleClasses(element: Element): ClassRule[] {
  const found: ClassRule[] = [];
  for (const generated of Array.from(element.classList)) {
    const name = /^_(.+)_[0-9a-z]+$/i.exec(generated)?.[1] ?? generated;
    for (const [path, module] of Object.entries(MODULES)) {
      if (module.default?.[name] === generated)
        found.push({ file: path, name });
    }
  }
  return found;
}

/** `src/`-relative path of a glob key from this folder. */
function srcPath(globKey: string): string {
  return globKey.startsWith("./")
    ? `features/stats/${globKey.slice(2)}`
    : globKey.replace(/^\.\.\/\.\.\//, "");
}

function themes() {
  const blocks = parseCss(readSrcFile("styles/tokens.css"));
  return {
    light: rootCustomProperties(blocks),
    dark: mediaRootCustomProperties(blocks, DARK_SCHEME),
  };
}

/**
 * The colours the element's own classes set, in each theme, as `#rrggbb`.
 * A rule counts when one of its selectors ends in the class (so `.pct`,
 * `.card .pct` and `.value > .pct`, not `.pct a`).
 */
function ownColours(element: Element): {
  light: string[];
  dark: string[];
  opacity: string[];
} {
  const { light, dark } = themes();
  const result = {
    light: [] as string[],
    dark: [] as string[],
    opacity: [] as string[],
  };
  for (const { file, name } of moduleClasses(element)) {
    const ending = new RegExp(`\\.${name}(?![\\w-])(?::[\\w-]+)*$`);
    const blocks = allBlocks(parseCss(readSrcFile(srcPath(file))));
    for (const block of blocks) {
      if (!selectors(block).some((selector) => ending.test(selector))) continue;
      for (const { property, value } of block.declarations) {
        if (property === "color") {
          result.light.push(normaliseHex(resolveValue(value, light, null)));
          result.dark.push(normaliseHex(resolveValue(value, light, dark)));
        }
        if (property === "opacity") result.opacity.push(value);
      }
    }
  }
  return result;
}

function expectMuted(element: Element | null, what: string): void {
  expect(element, `no element holds exactly ${what}`).not.toBeNull();
  const colours = ownColours(element as Element);
  const { light, dark } = themes();
  const muted = {
    light: normaliseHex(resolveToken("--color-text-muted", light, null)),
    dark: normaliseHex(resolveToken("--color-text-muted", light, dark)),
  };

  expect(
    colours.light,
    `${what}'s own class sets no colour (classes: ${(element as Element).className})`,
  ).not.toHaveLength(0);
  expect(new Set(colours.light)).toEqual(new Set([muted.light]));
  expect(new Set(colours.dark)).toEqual(new Set([muted.dark]));
  // A muted look by opacity would change the contrast measured below.
  for (const value of colours.opacity)
    expect(Number(value)).toBeGreaterThanOrEqual(1);

  for (const theme of ["light", "dark"] as const) {
    const map = theme === "dark" ? dark : null;
    for (const surface of ["--color-surface", "--color-surface-muted"]) {
      const background = normaliseHex(resolveToken(surface, light, map));
      expect(
        contrastRatio(muted[theme], background),
        `${what} on ${surface}, ${theme}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
}

// ------------------------------------------------------------- readers

function valueCells(table: HTMLTableElement): HTMLTableCellElement[] {
  return bodyRows(table).map((row) => row.cells[row.cells.length - 1]);
}

async function listShown(id: string): Promise<HTMLTableElement> {
  await screen.findByRole("heading", {
    level: 2,
    name: recordDefinition(id).title,
  });
  const main = screen.getByRole("main");
  return (await within(main).findByRole("table")) as HTMLTableElement;
}

function threesWith(entries: RecordListOut["entries"]): RecordListOut {
  return testRecordList("player-threes-game", {
    entries,
    total: entries.length,
  });
}

// ------------------------------------------------------- the reader works

describe("the colour reader", () => {
  it("reads an existing muted line's colour (a control: the rule under a list's title)", async () => {
    openRecords("/stats/records?record=team-most-points-game");

    await listShown("team-most-points-game");
    const rule = elementWithText(
      screen.getByRole("main"),
      recordDefinition("team-most-points-game").rule,
    );
    expectMuted(rule, "the rule line");
  });
});

// --------------------------------------------------------------- cards

describe("a win_loss card", () => {
  it("shows the best season as 73–9, with an en dash, then a muted (.890)", async () => {
    openRecords();

    const card = await findCard(
      "team",
      recordDefinition("team-best-season").title,
    );
    const text = norm(card.textContent);
    expect(text).toContain(WARRIORS.name);
    expect(text).toContain(`73${EN_DASH}9`);
    expect(text).not.toMatch(/73\s*-\s*9/);
    expect(text).not.toMatch(/0\.89/);
    expect(text).not.toMatch(MISSING);
    const share = elementWithText(card, "(.890)");
    expectMuted(share, "(.890)");
    // The figure first, its percentage after.
    expect(text.indexOf(`73${EN_DASH}9`)).toBeLessThan(text.indexOf("(.890)"));
  });

  it("shows the worst season as 7–59 (.106)", async () => {
    openRecords();

    const card = await findCard(
      "team",
      recordDefinition("team-worst-season").title,
    );
    const text = norm(card.textContent);
    expect(text).toContain(BOBCATS.name);
    expect(text).toContain(`7${EN_DASH}59`);
    expectMuted(elementWithText(card, "(.106)"), "(.106)");
  });

  it("reads to a screen reader as one phrase: 73 wins, 9 losses, .890", async () => {
    openRecords();

    const card = await findCard(
      "team",
      recordDefinition("team-best-season").title,
    );
    const read = accessibleText(card);
    expect(read).toContain("73 wins, 9 losses, .890");
    expect(read).not.toContain("(.890)");
    expect(read).not.toContain(`73${EN_DASH}9`);
  });
});

describe("a made_total card", () => {
  it("shows the threes holder's count, then a muted percentage", async () => {
    openRecords("/stats/records?group=player");

    const card = await findCard(
      "player",
      recordDefinition("player-threes-game").title,
    );
    const text = norm(card.textContent);
    expect(text).toMatch(/(?<![\d.])14(?![\d.])/);
    expect(text).not.toMatch(MISSING);
    expectMuted(elementWithText(card, "(58.3%)"), "(58.3%)");
  });

  it("shows the count alone when nothing was attempted", async () => {
    const summary = testRecordsSummary();
    const records = summary.records.map((record) =>
      record.id === "player-threes-game" && record.holder !== null
        ? {
            ...record,
            holder: {
              ...record.holder,
              ...madeEntry(3, 0),
              rank: 1,
              tied_count: 1,
              player: record.holder.player,
              team: record.holder.team,
              season: record.holder.season,
              game: record.holder.game,
            },
          }
        : record,
    );
    openRecords("/stats/records?group=player", {
      summary: { ...summary, records },
    });

    const card = await findCard(
      "player",
      recordDefinition("player-threes-game").title,
    );
    const text = norm(card.textContent);
    expect(text).toMatch(/(?<![\d.])3(?![\d.])/);
    expect(text).not.toContain("%");
    expect(text).not.toMatch(MISSING);
  });
});

describe("a shot_pct card (FRONTEND-030)", () => {
  it("shows the percentage, 45.4%, then a muted (402/886)", async () => {
    openRecords();

    const card = await findRecordCard("player-three-pct-season");
    await waitFor(() => expect(norm(card.textContent)).toContain("45.4%"));
    const text = norm(card.textContent);
    expect(text).not.toMatch(MISSING);
    expect(text).not.toContain("(45.4%)");
    expect(text).not.toMatch(/0\.454/);
    expectMuted(elementWithText(card, "(402/886)"), "(402/886)");
    expect(text.indexOf("45.4%")).toBeLessThan(text.indexOf("(402/886)"));
  });
});

describe("an average card (FRONTEND-030)", () => {
  it("shows one decimal and its unit: 31.0 points per game", async () => {
    openRecords();

    const card = await findRecordCard("player-ppg-season");
    await waitFor(() =>
      expect(norm(card.textContent)).toContain("31.0 points per game"),
    );
    expect(norm(card.textContent)).not.toMatch(MISSING);
  });
});

describe("a made_total season card (FRONTEND-030)", () => {
  it("keeps EVENTS-011's form: 402, then a muted (45.4%)", async () => {
    openRecords();

    const card = await findRecordCard("player-threes-season");
    await waitFor(() =>
      expect(norm(card.textContent)).toMatch(/(?<![\d.,])402(?![\d.,/])/),
    );
    expectMuted(elementWithText(card, "(45.4%)"), "(45.4%)");
    expect(norm(card.textContent)).not.toContain("(402/886)");
  });
});

describe("a count card", () => {
  it("shows its value alone, with no parenthesised percentage", async () => {
    openRecords();

    const card = await findCard(
      "team",
      recordDefinition("team-most-points-game").title,
    );
    const text = norm(card.textContent);
    expect(text).toMatch(/(?<![\d.])168(?!\d)/);
    expect(text).not.toMatch(/\(\.\d{3}\)|%\)/);
  });
});

// ---------------------------------------------------------------- lists

describe("a win_loss list", () => {
  it("heads its value column Record", async () => {
    openRecords("/stats/records?record=team-best-season");

    const table = await listShown("team-best-season");
    const headers = columnHeaders(table);
    expect(headers[headers.length - 1]).toBe("Record");
  });

  it("shows each season as wins–losses with the muted percentage after", async () => {
    openRecords("/stats/records?record=team-best-season");

    const table = await listShown("team-best-season");
    const cells = valueCells(table);
    const expected = [
      ["73", "9", ".890"],
      ["69", "13", ".841"],
      ["53", "10", ".841"],
      ["67", "15", ".817"],
    ];
    expect(cells).toHaveLength(expected.length);
    cells.forEach((cell, index) => {
      const [wins, losses, share] = expected[index];
      expect(norm(cell.textContent)).toContain(`${wins}${EN_DASH}${losses}`);
      expectMuted(elementWithText(cell, `(${share})`), `(${share})`);
    });
  });

  it("gives a cell the accessible text '73 wins, 9 losses, .890'", async () => {
    openRecords("/stats/records?record=team-best-season");

    const table = await listShown("team-best-season");
    const [first, second] = valueCells(table);
    expect(first).toHaveAccessibleName("73 wins, 9 losses, .890");
    expect(accessibleText(first)).toBe("73 wins, 9 losses, .890");
    expect(second).toHaveAccessibleName("69 wins, 13 losses, .841");
  });

  it("keeps the note that the list ranks the exact percentage", async () => {
    openRecords("/stats/records?record=team-worst-season");

    const table = await listShown("team-worst-season");
    expect(norm(valueCells(table)[0].textContent)).toContain(`7${EN_DASH}59`);
    const main = screen.getByRole("main");
    const note = Array.from(main.querySelectorAll("p")).find((p) =>
      /\bexact\b/i.test(p.textContent ?? ""),
    );
    expect(
      note,
      "no line says the ranks come from the exact figure",
    ).toBeDefined();
    expect(table.contains(note as Node)).toBe(false);
  });
});

describe("a made_total list", () => {
  it("shows each line's made count with its muted percentage", async () => {
    openRecords("/stats/records?record=player-threes-game");

    const table = await listShown("player-threes-game");
    const [first, second] = valueCells(table);
    expect(norm(first.textContent)).toMatch(/^14\b/);
    expectMuted(elementWithText(first, "(58.3%)"), "(58.3%)");
    expect(norm(second.textContent)).toMatch(/^12\b/);
    expectMuted(elementWithText(second, "(57.1%)"), "(57.1%)");
    const headers = columnHeaders(table);
    expect(headers[headers.length - 1]).not.toBe("Record");
  });

  it("shows the count alone where nothing was attempted (pct null)", async () => {
    const list = threesWith([
      {
        rank: 1,
        ...madeEntry(12, 21, {
          player: testRecordList("player-threes-game").entries[1].player,
        }),
      },
      {
        rank: 2,
        ...madeEntry(0, 0, {
          player: testRecordList("player-threes-game").entries[0].player,
        }),
      },
    ]);
    openRecords("/stats/records?record=player-threes-game", {
      list: (id) => (id === "player-threes-game" ? list : testRecordList(id)),
    });

    const table = await listShown("player-threes-game");
    const [, empty] = valueCells(table);
    const text = norm(empty.textContent);
    expect(text).toMatch(/^0\b/);
    expect(text).not.toContain("(");
    expect(text).not.toContain("%");
    expect(text).not.toMatch(MISSING);
  });
});

describe("a count list", () => {
  it("shows the value alone", async () => {
    openRecords("/stats/records?record=team-most-points-game");

    const table = await listShown("team-most-points-game");
    expect(valueCells(table).map((cell) => norm(cell.textContent))).toEqual([
      "168",
      "157",
    ]);
  });
});

describe("a shot_pct list (FRONTEND-030)", () => {
  it("shows each line's percentage with its muted made and attempted", async () => {
    openRecords("/stats/records?record=player-three-pct-season");

    const table = await listShown("player-three-pct-season");
    const [first, second] = valueCells(table);
    expect(norm(first.textContent)).toMatch(/^45\.4%/);
    expectMuted(elementWithText(first, "(402/886)"), "(402/886)");
    expect(norm(second.textContent)).toMatch(/^44\.4%/);
    expectMuted(elementWithText(second, "(250/563)"), "(250/563)");
  });
});

describe("an average list (FRONTEND-030)", () => {
  it("shows each line's mean to one decimal", async () => {
    openRecords("/stats/records?record=player-ppg-season");

    const table = await listShown("player-ppg-season");
    expect(
      valueCells(table).map((cell) => norm(cell.textContent).split(" ")[0]),
    ).toEqual(["31.0", "30.4"]);
  });
});
