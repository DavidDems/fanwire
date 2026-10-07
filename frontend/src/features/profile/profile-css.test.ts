/**
 * UI-008 acceptance criterion 5, pinned statically: every `*.module.css` under
 * `src/features/profile/` is read from disk, because jsdom applies no styles
 * (`wiki/CodeContext/FrontendUI/verification.md` §1, §2a).
 *
 * No hex, `rgb()`, `hsl()` or named colour, no px font size, and no
 * `outline: none` / `outline: 0` without a `:focus-visible` rule in the same
 * file. The scanner is the shared one in `src/test/module-css.ts`, pinned
 * against fixtures in its own test.
 *
 * Not vacuous: the header card needs layout CSS of its own (the name and
 * counts beside the avatar, the Follow control wrapping under the name on
 * phones, `layout.md` §3), so at least one module file must be there to check.
 */
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR } from "../../test/css";
import { moduleCssFiles, moduleCssViolations } from "../../test/module-css";

const PROFILE_DIR = join(SRC_DIR, "features", "profile");

describe("every *.module.css under src/features/profile", () => {
  const files = moduleCssFiles(PROFILE_DIR);
  const names = files.map((file) =>
    relative(PROFILE_DIR, file).split(sep).join("/"),
  );

  it("has module CSS to check (not vacuously green)", () => {
    expect(
      files.length,
      `no *.module.css under ${PROFILE_DIR}`,
    ).toBeGreaterThan(0);
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
