/**
 * FRONTEND-008 — the one formatting module the game page uses for every
 * figure it shows (brief, "Number formats": nba.com style, one module with its
 * own unit tests, used everywhere on the page).
 *
 * The interface this file pins, in `features/games/format.ts`:
 *
 * - `formatMinutes(secondsPlayed: number): string` — `m:ss` from
 *   `seconds_played`: minutes unpadded and uncapped, seconds always two
 *   digits. 1624 → "27:04", 59 → "0:59", 0 → "0:00", 14400 → "240:00".
 * - `formatPercentage(value: number | null): string` — the API's fraction
 *   (0 to 1, three places) as a three-place decimal with no leading zero:
 *   0.462 → ".462", 0.4 → ".400", 0 → ".000", 1 → "1.000". `null` (nothing
 *   attempted) → an en dash, U+2013.
 * - `formatPlusMinus(value: number): string` — signed: 12 → "+12", -3 → "-3"
 *   (a hyphen-minus or U+2212 minus sign both pass), 0 → "0" (no sign).
 * - `periodHeaders(count: number): string[]` — the line-score column headers
 *   for `count` figures: Q1–Q4, then OT, 2OT, and 3OT+ for the seventh figure,
 *   which is "third overtime and later" in one figure ([[0x02-events]] Game).
 *   Never split or padded.
 */
import { describe, expect, it } from "vitest";

import {
  formatMinutes,
  formatPercentage,
  formatPlusMinus,
  periodHeaders,
} from "./format";

const EN_DASH = String.fromCodePoint(0x2013);

describe("formatMinutes", () => {
  it.each([
    [1624, "27:04"],
    [2100, "35:00"],
    [245, "4:05"],
    [59, "0:59"],
    [0, "0:00"],
    [600, "10:00"],
    [2880, "48:00"],
    [14400, "240:00"],
  ])("%i seconds is %s", (seconds, shown) => {
    expect(formatMinutes(seconds)).toBe(shown);
  });
});

describe("formatPercentage", () => {
  it.each([
    [0.462, ".462"],
    [0.615, ".615"],
    [0.4, ".400"],
    [0.5, ".500"],
    [0.333, ".333"],
    [0.05, ".050"],
    [0, ".000"],
    [1, "1.000"],
  ])("%s is %s", (value, shown) => {
    expect(formatPercentage(value)).toBe(shown);
  });

  it("shows a null percentage as an en dash", () => {
    expect(formatPercentage(null)).toBe(EN_DASH);
  });

  it("never shows a leading zero or a percent sign", () => {
    for (const value of [0.001, 0.25, 0.999]) {
      expect(formatPercentage(value)).toMatch(/^\.\d{3}$/);
    }
  });
});

describe("formatPlusMinus", () => {
  it.each([
    [12, "+12"],
    [1, "+1"],
    [0, "0"],
  ])("%i is %s", (value, shown) => {
    expect(formatPlusMinus(value)).toBe(shown);
  });

  it.each([
    [-3, "3"],
    [-15, "15"],
  ])("%i is a minus sign and %s", (value, digits) => {
    expect(formatPlusMinus(value)).toMatch(new RegExp(`^[-−]${digits}$`));
  });
});

describe("periodHeaders", () => {
  it("heads four figures Q1 to Q4", () => {
    expect(periodHeaders(4)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
  });

  it("heads a fifth figure OT", () => {
    expect(periodHeaders(5)).toEqual(["Q1", "Q2", "Q3", "Q4", "OT"]);
  });

  it("heads a sixth figure 2OT", () => {
    expect(periodHeaders(6)).toEqual(["Q1", "Q2", "Q3", "Q4", "OT", "2OT"]);
  });

  it("heads the seventh figure 3OT+, third overtime and later in one", () => {
    expect(periodHeaders(7)).toEqual([
      "Q1",
      "Q2",
      "Q3",
      "Q4",
      "OT",
      "2OT",
      "3OT+",
    ]);
  });
});
