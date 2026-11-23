/**
 * `combine` (Prompt 20, R12): the per-unit declarations of `bundle-budgets/`
 * applied to the measured base. The build itself is measured in
 * `bundle-budget.test.ts`; this pins the arithmetic, and that a declaration
 * which contradicts the base or another unit fails instead of loosening the
 * budget.
 */
import { describe, expect, it } from "vitest";

import {
  BASE,
  ENTRY_JS_RAW_HARD_MAX,
  TOLERANCE,
  combine,
  type UnitBudget,
} from "./bundle-budget";

describe("combine", () => {
  it("is the base when no unit declares anything", () => {
    const budget = combine([]);

    expect(budget.entryJsGzipMax).toBe(BASE.entryJsGzip + TOLERANCE);
    expect(budget.entryJsRawMax).toBe(BASE.entryJsRaw + TOLERANCE);
    expect(budget.entryCssGzipMax).toBe(BASE.entryCssGzip + TOLERANCE);
    expect(budget.lazyMax).toEqual(BASE.lazy);
    expect(budget.unchanged).toEqual(BASE.lazy);
  });

  it("adds each unit's entry growth, and caps the raw entry at ENTRY_JS_RAW_HARD_MAX", () => {
    const budget = combine([
      { unit: "A", entryJsGzipGrowth: 1_000, entryJsRawGrowth: 5_000 },
      { unit: "B", entryJsGzipGrowth: 100, entryJsRawGrowth: 50_000 },
    ]);

    expect(budget.entryJsGzipMax).toBe(BASE.entryJsGzip + TOLERANCE + 1_100);
    expect(budget.entryJsRawMax).toBe(ENTRY_JS_RAW_HARD_MAX);
  });

  it("refuses an entry growth over 1 kB gzip for one unit", () => {
    expect(() => combine([{ unit: "A", entryJsGzipGrowth: 1_001 }])).toThrow(
      /entry growth/,
    );
  });

  it("applies changed, added and removed chunks", () => {
    const budget = combine([
      {
        unit: "A",
        changed: { SeasonsTab: 4_000, "css:Stats.css": 1_000 },
        added: { PickerTab: 2_000 },
        removed: ["PlayersTab"],
      },
    ]);

    expect(budget.lazyMax.SeasonsTab).toBe(4_000);
    expect(budget.lazyMax["css:Stats.css"]).toBe(1_000);
    expect(budget.lazyMax.PickerTab).toBe(2_000);
    expect(budget.lazyMax).not.toHaveProperty("PlayersTab");
    expect(budget.unchanged).not.toHaveProperty("SeasonsTab");
    expect(budget.unchanged).not.toHaveProperty("PickerTab");
    expect(budget.unchanged).not.toHaveProperty("PlayersTab");
    expect(budget.unchanged.ComposePage).toBe(BASE.lazy.ComposePage);
  });

  it.each<[string, UnitBudget]>([
    ["a changed chunk not in the base", { unit: "A", changed: { Nope: 1 } }],
    ["an added chunk already in the base", { unit: "A", added: { format: 1 } }],
    ["a removed chunk not in the base", { unit: "A", removed: ["Nope"] }],
  ])("refuses %s", (_name, unit) => {
    expect(() => combine([unit])).toThrow();
  });

  it("refuses two units declaring the same chunk", () => {
    expect(() =>
      combine([
        { unit: "A", changed: { ComposePage: 6_000 } },
        { unit: "B", changed: { ComposePage: 7_000 } },
      ]),
    ).toThrow(/both declare ComposePage/);
  });
});

describe("a dependency major (FRONTEND-047, ADR 0041)", () => {
  const react19 = { name: "react 19", decision: "ADR 0041" };

  it("may grow the entry past 1 kB gzip when its file names the major and its ADR", () => {
    const budget = combine([
      {
        unit: "A",
        dependencyMajor: react19,
        entryJsGzipGrowth: 25_000,
        entryJsRawGrowth: 85_000,
      },
    ]);

    expect(budget.entryJsGzipMax).toBe(BASE.entryJsGzip + TOLERANCE + 25_000);
    expect(budget.entryJsRawMax).toBe(
      Math.min(
        BASE.entryJsRaw + TOLERANCE + 85_000,
        ENTRY_JS_RAW_HARD_MAX + 85_000,
      ),
    );
  });

  it("lifts the raw cap (ENTRY_JS_RAW_HARD_MAX) by exactly the major's raw growth, and no more", () => {
    const budget = combine([
      {
        unit: "A",
        dependencyMajor: react19,
        entryJsGzipGrowth: 2_000,
        entryJsRawGrowth: 10_000,
      },
      { unit: "B", entryJsRawGrowth: 100_000 },
    ]);

    expect(budget.entryJsRawMax).toBe(ENTRY_JS_RAW_HARD_MAX + 10_000);
  });

  it.each<[string, UnitBudget["dependencyMajor"]]>([
    ["without one", undefined],
    ["with an empty name", { name: "", decision: "ADR 0041" }],
    ["with a decision that is no ADR", { name: "react 19", decision: "0041" }],
    [
      "with an ADR that is not four digits",
      { name: "react 19", decision: "ADR 41" },
    ],
  ])("refuses an entry growth over 1 kB gzip %s", (_name, dependencyMajor) => {
    expect(() =>
      combine([{ unit: "A", entryJsGzipGrowth: 1_001, dependencyMajor }]),
    ).toThrow(/entry growth|dependency major/);
  });
});
