/**
 * FRONTEND-007 acceptance criterion 11, pinned statically: every
 * `*.module.css` under `src/features/search/` is read from disk, because jsdom
 * applies no styles (`wiki/CodeContext/FrontendUI/verification.md` §1, §2a).
 *
 * No hex, `rgb()`, `hsl()` or named colour, no px font size, and no
 * `outline: none` / `outline: 0` without a `:focus-visible` rule in the same
 * file. The scanner is the shared one in `src/test/module-css.ts`.
 *
 * Not vacuous: the two sections' spacing, the accounts list and the
 * dropdowns' row are this unit's own layout, so at least one module file must
 * be there to check.
 *
 * The shared classes the behavioural tests assert are confirmed on disk here
 * too: on Vitest 4 a CSS module import returns a class name for any key,
 * defined or not, so `toHaveClass(styles.x)` proves nothing unless `.x` exists.
 */
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR, readSrcFile } from "../../test/css";
import { moduleCssFiles, moduleCssViolations } from "../../test/module-css";

const SEARCH_DIR = join(SRC_DIR, "features", "search");

describe("every *.module.css under src/features/search", () => {
  const files = moduleCssFiles(SEARCH_DIR);
  const names = files.map((file) =>
    relative(SEARCH_DIR, file).split(sep).join("/"),
  );

  it("has module CSS to check (not vacuously green)", () => {
    expect(files.length, `no *.module.css under ${SEARCH_DIR}`).toBeGreaterThan(
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
});

/** Shared module → the classes the search tests read off it. */
const SHARED_CLASSES: [string, string[]][] = [
  ["components/ui/Button.module.css", ["button", "secondary"]],
  ["components/ui/GameScore.module.css", ["score", "row"]],
];

describe.each(SHARED_CLASSES)("%s", (path, classNames) => {
  it.each(classNames)("defines .%s", (className) => {
    expect(readSrcFile(path)).toMatch(new RegExp(`\\.${className}(?![\\w-])`));
  });
});
