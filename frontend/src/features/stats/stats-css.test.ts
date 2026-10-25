/**
 * FRONTEND-009 criterion 12, and the static half of 13, pinned from disk,
 * because jsdom applies no styles (`verification.md` §1, §2a).
 *
 * Every `*.module.css` this unit adds or changes — everything under
 * `features/stats/` and `features/players/`, `components/ui/Tabs.module.css`,
 * and the stylesheets of the two folders it changes, `features/games/` and
 * `features/search/` — has no hex, `rgb()`, `hsl()` or named colour, no px
 * font size, and no `outline: none` / `outline: 0` without a `:focus-visible`
 * rule in the same file. The scanner is the shared one in
 * `src/test/module-css.ts`.
 *
 * The new pages' tables scroll inside their own containers: some rule in each
 * new folder's stylesheets sets `overflow-x: auto` (or `overflow: auto`).
 * Which element carries it is the behavioural tests' (`src/test/tables.ts`:
 * each table sits in its own named, focusable region), and the 360 px layout
 * is the browser checklist's.
 *
 * Not vacuous: each new folder must have at least one module file.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR, allBlocks, parseCss } from "../../test/css";
import { moduleCssFiles, moduleCssViolations } from "../../test/module-css";

const NEW_FOLDERS: [string, string][] = [
  ["features/stats", join(SRC_DIR, "features", "stats")],
  ["features/players", join(SRC_DIR, "features", "players")],
];
const CHANGED_FOLDERS: [string, string][] = [
  ["features/games", join(SRC_DIR, "features", "games")],
  ["features/search", join(SRC_DIR, "features", "search")],
  // FRONTEND-018: the shared navigator's stylesheets, held to the same rules.
  ["components/stats-nav", join(SRC_DIR, "components", "stats-nav")],
];
const TABS_CSS = join(SRC_DIR, "components", "ui", "Tabs.module.css");

function name(file: string): string {
  return relative(SRC_DIR, file).split(sep).join("/");
}

function scrolls(files: string[]): boolean {
  return files.some((file) =>
    allBlocks(parseCss(readFileSync(file, "utf8"))).some((block) =>
      block.declarations.some(
        ({ property, value }) =>
          (property === "overflow-x" || property === "overflow") &&
          /^auto\b/i.test(value.trim()),
      ),
    ),
  );
}

describe.each(NEW_FOLDERS)(
  "every *.module.css under src/%s",
  (_label, directory) => {
    const files = moduleCssFiles(directory);

    it("has module CSS to check (not vacuously green)", () => {
      expect(
        files.length,
        `no *.module.css under ${directory}`,
      ).toBeGreaterThan(0);
    });

    it("gives its tables a horizontal scroll container", () => {
      expect(scrolls(files), "no rule sets overflow-x: auto").toBe(true);
    });
  },
);

describe("every *.module.css this unit adds or changes", () => {
  const files = [
    ...[...NEW_FOLDERS, ...CHANGED_FOLDERS].flatMap(([, directory]) =>
      moduleCssFiles(directory),
    ),
    ...(existsSync(TABS_CSS) ? [TABS_CSS] : []),
  ];

  it("includes Tabs.module.css", () => {
    expect(
      existsSync(TABS_CSS),
      "src/components/ui/Tabs.module.css must exist",
    ).toBe(true);
  });

  it("uses only var(--color-…), no px font sizes, and a visible focus", () => {
    const problems = files.flatMap((file) =>
      moduleCssViolations(readFileSync(file, "utf8")).map(
        (problem) => `${name(file)}: ${problem}`,
      ),
    );

    expect(files.length).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});
