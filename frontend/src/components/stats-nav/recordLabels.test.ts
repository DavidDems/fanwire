/**
 * EVENTS-011: how a record's value is shown is decided by its `value_kind`,
 * never guessed from its unit. `isRate` (a `%` in the unit) is gone, and no
 * records view reads a unit to choose a format.
 *
 * The rendering itself is pinned through the screen in
 * `features/stats/RecordValues.test.tsx`; this pins that the guess is gone.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR } from "../../test/css";
import * as labels from "./recordLabels";

const FOLDERS = [
  join(SRC_DIR, "components", "stats-nav"),
  join(SRC_DIR, "features", "stats"),
];

function sources(): [string, string][] {
  return FOLDERS.flatMap((folder) =>
    readdirSync(folder)
      .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
      .map((name): [string, string] => [
        name,
        readFileSync(join(folder, name), "utf8"),
      ]),
  );
}

describe("the value's format comes from value_kind", () => {
  it("recordLabels no longer exports isRate", () => {
    expect(Object.keys(labels)).not.toContain("isRate");
  });

  it("no records view guesses a kind from the unit", () => {
    const offenders = sources()
      .filter(
        ([, text]) =>
          /\bisRate\b/.test(text) ||
          /unit\??\.includes\(\s*["'`]%["'`]\s*\)/.test(text),
      )
      .map(([name]) => name);

    expect(offenders).toEqual([]);
  });

  it("the records views switch on value_kind", () => {
    const readers = sources()
      .filter(([, text]) => /\bvalue_kind\b/.test(text))
      .map(([name]) => name);

    expect(readers.length).toBeGreaterThan(0);
  });
});
