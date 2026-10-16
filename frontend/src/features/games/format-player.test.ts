/**
 * FRONTEND-009 — the two figures the stats and player pages add to the game
 * page's formatting module (brief, "Number formats reuse the game page's
 * formatting module from FRONTEND-008").
 *
 * The module stays `features/games/format.ts`; `features/stats/` and
 * `features/players/` import it (`games-isolation.test.ts` allows exactly that
 * one module across the feature boundary). The additions this file pins:
 *
 * - `formatHeight(inches: number): string` — feet and inches with an ASCII
 *   apostrophe and quote: 81 → `6'9"`, 72 → `6'0"`, 84 → `7'0"`,
 *   79 → `6'7"`.
 * - `formatAverage(value: number | null): string` — a per-game average to one
 *   place, as the API rounds it: 27.1 → "27.1", 9 → "9.0", 0.5 → "0.5",
 *   0 → "0.0". `null` (no game played) → an en dash, U+2013, as a null
 *   percentage is.
 */
import { describe, expect, it } from "vitest";

import { formatAverage, formatHeight } from "./format";

const EN_DASH = String.fromCodePoint(0x2013);

describe("formatHeight", () => {
  it.each([
    [81, `6'9"`],
    [72, `6'0"`],
    [84, `7'0"`],
    [79, `6'7"`],
    [69, `5'9"`],
  ])("%i inches is %s", (inches, expected) => {
    expect(formatHeight(inches)).toBe(expected);
  });
});

describe("formatAverage", () => {
  it.each([
    [27.1, "27.1"],
    [9, "9.0"],
    [0.5, "0.5"],
    [0, "0.0"],
    [33.9, "33.9"],
  ])("%s is %s", (value, expected) => {
    expect(formatAverage(value)).toBe(expected);
  });

  it("is an en dash for null", () => {
    expect(formatAverage(null)).toBe(EN_DASH);
  });
});
