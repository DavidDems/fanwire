/**
 * FRONTEND-031: the team icon palette and the mapping, as data.
 *
 * The contract is `.ai/tasks/FRONTEND-031/brief.md`'s three tables, copied
 * here (the brief is not in the test container): the eight inner colours and
 * the five outer colours, each with its key and name in the brief's order,
 * and each of the thirty abbreviations' inner and outer key.
 *
 * The interface this file pins (`src/lib/teamColors.ts`):
 *
 * ```ts
 * // In the brief's order; USERS-005's avatar picker reads both, so they stay
 * // exported and ordered. Each entry may carry more, but has these two.
 * export const INNER_COLORS: readonly { key: string; name: string }[];
 * export const OUTER_COLORS: readonly { key: string; name: string }[];
 * // One row per team, data rather than branching: abbreviation -> its keys.
 * export const TEAM_COLORS: Readonly<Record<string, { inner: string; outer: string }>>;
 * ```
 *
 * No hex is here or in `teamColors.ts`: the values are tokens in
 * `styles/tokens.css` (`styles/tokens.test.ts` pins them).
 */
import { describe, expect, it } from "vitest";

import { INNER_COLORS, OUTER_COLORS, TEAM_COLORS } from "./teamColors";

/** The brief's inner table: key, name. */
const INNER: [string, string][] = [
  ["gold", "Gold"],
  ["orange", "Orange"],
  ["red", "Red"],
  ["green", "Green"],
  ["sky", "Sky Blue"],
  ["lavender", "Lavender"],
  ["silver", "Silver"],
  ["teal", "Teal"],
];

/** The brief's outer table: key, name. */
const OUTER: [string, string][] = [
  ["blue", "Blue"],
  ["crimson", "Crimson"],
  ["black", "Black"],
  ["purple", "Purple"],
  ["forest", "Forest Green"],
];

/** The brief's mapping: team, inner, outer. */
const MAPPING: [string, string, string][] = [
  ["ATL", "red", "black"],
  ["BKN", "silver", "black"],
  ["BOS", "green", "forest"],
  ["CHA", "teal", "purple"],
  ["CHI", "red", "black"],
  ["CLE", "gold", "crimson"],
  ["DAL", "sky", "blue"],
  ["DEN", "gold", "blue"],
  ["DET", "sky", "crimson"],
  ["GSW", "gold", "blue"],
  ["HOU", "silver", "crimson"],
  ["IND", "gold", "blue"],
  ["LAC", "red", "blue"],
  ["LAL", "gold", "purple"],
  ["MEM", "sky", "blue"],
  ["MIA", "red", "black"],
  ["MIL", "silver", "forest"],
  ["MIN", "green", "blue"],
  ["NOP", "gold", "blue"],
  ["NYK", "orange", "blue"],
  ["OKC", "sky", "blue"],
  ["ORL", "sky", "black"],
  ["PHI", "red", "blue"],
  ["PHX", "orange", "purple"],
  ["POR", "red", "black"],
  ["SAC", "lavender", "black"],
  ["SAS", "silver", "black"],
  ["TOR", "red", "black"],
  ["UTA", "gold", "black"],
  ["WAS", "red", "blue"],
];

describe("the palette (brief: The palette)", () => {
  it("has the eight inner colours, keys and names in the brief's order", () => {
    expect(INNER_COLORS.map(({ key, name }) => [key, name])).toEqual(INNER);
  });

  it("has the five outer colours, keys and names in the brief's order", () => {
    expect(OUTER_COLORS.map(({ key, name }) => [key, name])).toEqual(OUTER);
  });

  it("uses no outer key as an inner key", () => {
    const inner = new Set(INNER_COLORS.map(({ key }) => key));
    expect(OUTER_COLORS.filter(({ key }) => inner.has(key))).toEqual([]);
  });

  it("repeats no key within a list", () => {
    for (const list of [INNER_COLORS, OUTER_COLORS]) {
      const keys = list.map(({ key }) => key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe("the mapping (brief: The mapping)", () => {
  it("names exactly the thirty teams", () => {
    expect(Object.keys(TEAM_COLORS).sort()).toEqual(
      MAPPING.map(([team]) => team).sort(),
    );
  });

  it.each(MAPPING)("maps %s to inner %s, outer %s", (team, inner, outer) => {
    expect(TEAM_COLORS[team]).toEqual({ inner, outer });
  });

  it("takes every inner key from INNER_COLORS and every outer from OUTER_COLORS", () => {
    const inner = new Set(INNER_COLORS.map(({ key }) => key));
    const outer = new Set(OUTER_COLORS.map(({ key }) => key));
    for (const [team, keys] of Object.entries(TEAM_COLORS)) {
      expect(inner.has(keys.inner), `${team} inner ${keys.inner}`).toBe(true);
      expect(outer.has(keys.outer), `${team} outer ${keys.outer}`).toBe(true);
      expect(inner.has(keys.outer), `${team} outer is an inner key`).toBe(
        false,
      );
    }
  });

  it("has 18 distinct pairs across the 30, as the brief says", () => {
    const pairs = new Set(
      Object.values(TEAM_COLORS).map(({ inner, outer }) => `${inner}/${outer}`),
    );
    expect(pairs.size).toBe(18);
  });
});
