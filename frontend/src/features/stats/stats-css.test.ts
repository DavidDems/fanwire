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
 * folder that draws tables sets `overflow-x: auto` (or `overflow: auto`):
 * `features/players`, and `components/stats-nav`, whose `ScrollTable` draws
 * every stats table since FRONTEND-019 retired the Stats page's copy of the
 * table CSS (R24).
 * Which element carries it is the behavioural tests' (`src/test/tables.ts`:
 * each table sits in its own named, focusable region), and the 360 px layout
 * is the browser checklist's.
 *
 * Not vacuous: each new folder must have at least one module file.
 *
 * FRONTEND-019 (R24, criteria 8 and 9):
 *
 * - `features/stats/Stats.module.css` keeps only `.tab`, `.controls`,
 *   `.section`, `.muted` and the team bar's `.combobox` and `.options`: no
 *   `.scroll`, `.table`, table-cell, `.name` or `.figure` rule.
 * - `components/stats-nav/StatsNav.module.css` gains `.figure` (the leaders'
 *   figures take the navigator's classes).
 * - The record cards' styles live in `components/stats-nav/`: a card is
 *   `position: relative` and its "View all" link's `::after` is stretched over
 *   it (`position: absolute`, `inset: 0` or the four offsets 0), so the whole
 *   card is the hit area; the card shows hover and focus state (a `:hover`
 *   rule and a `:focus-within` or `:has(…:focus-visible)` rule).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SRC_DIR,
  allBlocks,
  parseCss,
  selectors,
  type CssBlock,
} from "../../test/css";
import { moduleCssFiles, moduleCssViolations } from "../../test/module-css";

const NEW_FOLDERS: [string, string][] = [
  ["features/stats", join(SRC_DIR, "features", "stats")],
  ["features/players", join(SRC_DIR, "features", "players")],
];
// FRONTEND-019 changed the scroll-container check: `features/stats` draws no
// table of its own any more (R24), so the check runs over the folders whose
// stylesheets draw the tables.
const TABLE_FOLDERS: [string, string][] = [
  ["features/players", join(SRC_DIR, "features", "players")],
  ["components/stats-nav", join(SRC_DIR, "components", "stats-nav")],
];
const STATS_CSS = join(SRC_DIR, "features", "stats", "Stats.module.css");
const NAV_CSS = join(SRC_DIR, "components", "stats-nav", "StatsNav.module.css");
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
  },
);

describe.each(TABLE_FOLDERS)(
  "the tables drawn under src/%s",
  (_label, directory) => {
    it("get a horizontal scroll container", () => {
      const files = moduleCssFiles(directory);
      expect(files.length).toBeGreaterThan(0);
      expect(scrolls(files), "no rule sets overflow-x: auto").toBe(true);
    });
  },
);

/** Every class a stylesheet's rules name, at any depth. */
function classesOf(file: string): Set<string> {
  const found = new Set<string>();
  for (const block of allBlocks(parseCss(readFileSync(file, "utf8")))) {
    for (const selector of selectors(block))
      for (const match of selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g))
        found.add(match[1]);
  }
  return found;
}

describe("R24: the Stats page's copy of the table CSS is retired (FRONTEND-019)", () => {
  it("Stats.module.css keeps only its tab, controls, section, muted and team-bar classes", () => {
    expect(existsSync(STATS_CSS)).toBe(true);
    const classes = [...classesOf(STATS_CSS)].sort();

    expect(classes).toEqual(
      ["combobox", "controls", "muted", "options", "section", "tab"].sort(),
    );
  });

  it("Stats.module.css has no table, table-cell or scroll rule", () => {
    const blocks = allBlocks(parseCss(readFileSync(STATS_CSS, "utf8")));
    const offenders = blocks
      .flatMap((block) => selectors(block))
      .filter((selector) =>
        /\b(table|caption|thead|tbody|tr|th|td|abbr|scroll|name|figure)\b/.test(
          selector,
        ),
      );

    expect(offenders).toEqual([]);
    expect(scrolls([STATS_CSS])).toBe(false);
  });

  it("the navigator's stylesheet has .figure, for the leaders' figures", () => {
    expect(classesOf(NAV_CSS).has("figure")).toBe(true);
  });
});

describe("the record cards' styles live in components/stats-nav (FRONTEND-019)", () => {
  const files = moduleCssFiles(join(SRC_DIR, "components", "stats-nav"));
  const blocks = files.flatMap((file) =>
    allBlocks(parseCss(readFileSync(file, "utf8"))),
  );

  function value(block: CssBlock, property: string): string | undefined {
    return block.declarations.find((d) => d.property === property)?.value;
  }

  it("stretches a link's ::after over its card", () => {
    const stretched = blocks.filter(
      (block) =>
        selectors(block).some((selector) => /::?after\b/.test(selector)) &&
        value(block, "position") === "absolute" &&
        (/^0(px)?$/.test(value(block, "inset") ?? "") ||
          ["top", "right", "bottom", "left"].every((side) =>
            /^0(px)?$/.test(value(block, side) ?? ""),
          )),
    );

    expect(stretched.length, "no ::after rule covers the card").toBeGreaterThan(0);
    expect(
      blocks.some((block) => value(block, "position") === "relative"),
      "no card is position: relative",
    ).toBe(true);
  });

  it("gives the whole card a hover and a focus state", () => {
    const all = blocks.flatMap((block) => selectors(block));

    expect(all.some((selector) => /:hover\b/.test(selector))).toBe(true);
    expect(
      all.some((selector) =>
        /:focus-within\b|:has\([^)]*:focus-visible/.test(selector),
      ),
    ).toBe(true);
  });
});

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
