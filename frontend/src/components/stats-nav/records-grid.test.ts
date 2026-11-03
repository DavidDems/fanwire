/**
 * FRONTEND-030: the record cards' grid, pinned from disk, because jsdom
 * applies no media queries and computes no styles (`verification.md` §1,
 * §2a). The measurements at 320, 360, 800 and 1280 CSS px, with and without
 * a classic scrollbar, are the browser rows'.
 *
 * `StatsNav.module.css`'s `.cards` (the list every records bar shows) is:
 *
 * - one column by default, outside every media query: no
 *   `grid-template-columns` of more than one track;
 * - two equal columns from `@media (min-width: 40rem)`;
 * - three equal columns from `@media (min-width: 64rem)`;
 * - each column `minmax(0, 1fr)`, so a long title wraps inside its card
 *   rather than widening the grid past the column;
 * - and no max-width query anywhere in the file (mobile first).
 *
 * The rule moved with the cards (the brief's trap): it is FRONTEND-019's
 * two-column rule, grown by one breakpoint, not a second rule elsewhere.
 */
import { describe, expect, it } from "vitest";

import {
  allBlocks,
  isAtRule,
  parseCss,
  readSrcFile,
  selectors,
  type CssBlock,
} from "../../test/css";
import { declared } from "../../test/module-css";

const NAV_CSS = "components/stats-nav/StatsNav.module.css";

function blocks(): CssBlock[] {
  return parseCss(readSrcFile(NAV_CSS));
}

function isCards(block: CssBlock): boolean {
  return !isAtRule(block) && selectors(block).includes(".cards");
}

/** The `.cards` rules directly inside `@media (min-width: <width>)`. */
function cardsFrom(width: string): CssBlock[] {
  const condition = new RegExp(
    `^@media\\b.*\\(\\s*min-width\\s*:\\s*${width.replace(".", "\\.")}\\s*\\)`,
    "i",
  );
  return blocks()
    .filter((block) => isAtRule(block) && condition.test(block.prelude))
    .flatMap((media) => media.children.filter(isCards));
}

/** A grid-template-columns value with whitespace collapsed. */
function columns(block: CssBlock): string | undefined {
  return declared(block, "grid-template-columns")?.replace(/\s+/g, " ");
}

describe("the record cards' grid (FRONTEND-030)", () => {
  it("is a grid of one column by default", () => {
    const top = blocks().filter(isCards);
    expect(top.length, "no top-level .cards rule").toBeGreaterThan(0);
    expect(top.some((block) => declared(block, "display") === "grid")).toBe(
      true,
    );
    for (const block of top) {
      const value = columns(block);
      expect(
        value === undefined || /^(minmax\(0, 1fr\)|1fr|100%)$/.test(value),
        `top-level .cards sets grid-template-columns: ${value}`,
      ).toBe(true);
    }
  });

  it("has two equal columns from 40rem", () => {
    const rules = cardsFrom("40rem");
    expect(rules.length, "no .cards rule under (min-width: 40rem)").toBe(1);
    expect(columns(rules[0])).toBe("repeat(2, minmax(0, 1fr))");
  });

  it("has three equal columns from 64rem", () => {
    const rules = cardsFrom("64rem");
    expect(rules.length, "no .cards rule under (min-width: 64rem)").toBe(1);
    expect(columns(rules[0])).toBe("repeat(3, minmax(0, 1fr))");
  });

  it("sets its columns nowhere else", () => {
    const setting = allBlocks(blocks()).filter(
      (block) =>
        !isAtRule(block) &&
        selectors(block).some((selector) => /\.cards\b/.test(selector)) &&
        declared(block, "grid-template-columns") !== undefined,
    );
    // The default (if any), 40rem and 64rem.
    expect(setting.length).toBeLessThanOrEqual(3);
    expect(cardsFrom("40em")).toEqual([]);
    expect(cardsFrom("64em")).toEqual([]);
  });

  it("uses no max-width media query", () => {
    const media = allBlocks(blocks())
      .filter((block) => /^@media\b/i.test(block.prelude))
      .map((block) => block.prelude);

    expect(
      media.filter((prelude) =>
        /max-width|\bwidth\s*<|>\s*=?\s*width\b/i.test(prelude),
      ),
    ).toEqual([]);
  });
});
