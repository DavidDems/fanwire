/**
 * FRONTEND-008 acceptance criteria 8 (its static half) and 11, pinned from
 * disk, because jsdom applies no styles (`verification.md` §1, §2a).
 *
 * - Every `*.module.css` under `src/features/games/`, and `GameScore`'s
 *   stylesheet (the one shared stylesheet this unit may change): no hex,
 *   `rgb()`, `hsl()` or named colour, no px font size, and no `outline: none`
 *   / `outline: 0` without a `:focus-visible` rule in the same file. The
 *   scanner is the shared one in `src/test/module-css.ts`.
 * - The box-score tables scroll inside their own container: some rule in the
 *   games stylesheets sets `overflow-x: auto` (or `overflow: auto`). Which
 *   element carries it is shown in a browser, at 360 px (the checklist row).
 *
 * Not vacuous: the page's layout and the scroll container are this unit's
 * own, so at least one module file must be there to check.
 */
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR, allBlocks, parseCss, readSrcFile } from "../../test/css";
import { moduleCssFiles, moduleCssViolations } from "../../test/module-css";

const GAMES_DIR = join(SRC_DIR, "features", "games");
const GAME_SCORE_CSS = "components/ui/GameScore.module.css";

describe("every *.module.css under src/features/games", () => {
  const files = moduleCssFiles(GAMES_DIR);
  const names = files.map((file) =>
    relative(GAMES_DIR, file).split(sep).join("/"),
  );

  it("has module CSS to check (not vacuously green)", () => {
    expect(files.length, `no *.module.css under ${GAMES_DIR}`).toBeGreaterThan(
      0,
    );
  });

  it("uses only var(--color-…), no px font sizes, and a visible focus", () => {
    const problems = files.flatMap((file, index) =>
      moduleCssViolations(readFileSync(file, "utf8")).map(
        (problem) => `${names[index]}: ${problem}`,
      ),
    );

    expect(problems).toEqual([]);
  });

  it("gives the box-score tables a horizontal scroll container", () => {
    const scrolls = files.some((file) =>
      allBlocks(parseCss(readFileSync(file, "utf8"))).some((block) =>
        block.declarations.some(
          ({ property, value }) =>
            (property === "overflow-x" || property === "overflow") &&
            /^auto\b/i.test(value.trim()),
        ),
      ),
    );

    expect(scrolls, "no rule sets overflow-x: auto").toBe(true);
  });
});

describe(GAME_SCORE_CSS, () => {
  it("uses only var(--color-…), no px font sizes, and a visible focus", () => {
    expect(moduleCssViolations(readSrcFile(GAME_SCORE_CSS))).toEqual([]);
  });
});

describe("RecentGames rail sizing contract", () => {
  it("permits children to shrink within the rail and reserves a consistent row height", () => {
    const css = readSrcFile("features/games/RecentGames.module.css");
    expect(moduleCssViolations(css)).toEqual([]);
    const blocks = allBlocks(parseCss(css));
    expect(
      blocks.some((block) =>
        block.declarations.some(
          ({ property, value }) =>
            /^(min-width|min-inline-size)$/.test(property) &&
            /^0(?:px)?$/.test(value),
        ),
      ),
      "rail children can shrink with four-letter abbreviations and 100–100 scores",
    ).toBe(true);
    expect(
      blocks.some((block) =>
        block.declarations.some(
          ({ property, value }) =>
            /^(min-height|min-block-size|height|block-size)$/.test(property) &&
            /var\(--/.test(value),
        ),
      ),
      "loading and final rows reserve a token-based height",
    ).toBe(true);
    expect(
      blocks
        .flatMap((block) => block.declarations)
        .filter(
          ({ property, value }) =>
            /^(width|inline-size|min-width|min-inline-size)$/.test(property) &&
            /(?:100vw|100dvw)/.test(value),
        ),
      "a rail row must fit the rail rather than the viewport",
    ).toEqual([]);
  });
});
