/**
 * UI-005 acceptance criterion 8, pinned statically: every `*.module.css` under
 * `src/features/feed/` is read from disk, because jsdom applies no styles
 * (`wiki/CodeContext/FrontendUI/verification.md` §1, §2a).
 *
 * No hex, `rgb()`, `hsl()` or named colour, no px font size, and no
 * `outline: none` / `outline: 0` without a `:focus-visible` rule in the same
 * file. The scanner is the shared one in `src/test/module-css.ts`, pinned
 * against fixtures in its own test.
 *
 * Not vacuous: the stream's spacing, the thread's indent and left rule
 * (`layout.md` §3–§4) and the post's header row are the feed's own layout, so
 * at least one module file must be there to check.
 *
 * The shared classes `feed-style.test.tsx` asserts are also confirmed here: on
 * Vitest 4 a CSS module import returns a class name for any key, defined or
 * not, so a `toHaveClass(styles.x)` proves nothing unless `.x` is on disk.
 */
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR, readSrcFile } from "../../test/css";
import { moduleCssFiles, moduleCssViolations } from "../../test/module-css";

const FEED_DIR = join(SRC_DIR, "features", "feed");

describe("every *.module.css under src/features/feed", () => {
  const files = moduleCssFiles(FEED_DIR);
  const names = files.map((file) =>
    relative(FEED_DIR, file).split(sep).join("/"),
  );

  it("has module CSS to check (not vacuously green)", () => {
    expect(files.length, `no *.module.css under ${FEED_DIR}`).toBeGreaterThan(
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

/** Shared module → the classes `feed-style.test.tsx` reads off it. */
const SHARED_CLASSES: [string, string[]][] = [
  ["components/ui/Card.module.css", ["card"]],
  ["components/ui/Button.module.css", ["button", "secondary"]],
  ["components/ui/message.module.css", ["message", "neutral", "danger"]],
  ["components/ui/Skeleton.module.css", ["post"]],
  ["components/ui/EmptyState.module.css", ["empty", "message"]],
  ["components/ui/GameScore.module.css", ["score"]],
];

describe.each(SHARED_CLASSES)("%s", (path, classNames) => {
  it.each(classNames)("defines .%s", (className) => {
    expect(readSrcFile(path)).toMatch(new RegExp(`\\.${className}(?![\\w-])`));
  });
});
