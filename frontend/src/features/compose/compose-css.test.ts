/**
 * UI-006 acceptance criteria 5 and 6, pinned statically: jsdom applies no
 * styles (`wiki/CodeContext/FrontendUI/verification.md` §1, §2a), so the CSS
 * is read from disk.
 *
 * - The suggestions panel and its `MentionAutocomplete.module.css` are gone
 *   with the dropdown (FRONTEND-013).
 * - Every `*.module.css` under `src/features/compose/` passes the shared
 *   raw-value scanner in `src/test/module-css.ts`, and there is at least one.
 * - The shared classes `compose-style.test.tsx` asserts really exist as rules:
 *   on Vitest 4 a CSS-module import returns a class name even for a class the
 *   file never defines, so those assertions need this beside them.
 *
 * Each control gets its own module CSS and no control imports another; that
 * second half is `component-isolation.test.ts`, deliberately not repeated here.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SRC_DIR,
  allBlocks,
  parseCss,
  readSrcFile,
  selectors,
} from "../../test/css";
import {
  lastCompoundClasses,
  moduleCssFiles,
  moduleCssViolations,
} from "../../test/module-css";

const COMPOSE_DIR = join(SRC_DIR, "features", "compose");
const SUGGESTIONS_CSS = join(COMPOSE_DIR, "MentionAutocomplete.module.css");

describe("the suggestions panel's CSS is gone (FRONTEND-013 criterion 9)", () => {
  it("MentionAutocomplete.module.css no longer exists", () => {
    expect(existsSync(SUGGESTIONS_CSS), `${SUGGESTIONS_CSS} still exists`).toBe(
      false,
    );
  });
});

describe("every *.module.css under src/features/compose (criterion 6)", () => {
  const files = moduleCssFiles(COMPOSE_DIR);
  const names = files.map((file) =>
    relative(COMPOSE_DIR, file).split(sep).join("/"),
  );

  it("has module CSS to check (not vacuously green)", () => {
    expect(
      files.length,
      `no *.module.css under ${COMPOSE_DIR}`,
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

describe("the shared classes the style tests assert exist on disk", () => {
  /** True when some style rule's selector ends in a compound carrying `.name`. */
  function defines(relativePath: string, name: string): boolean {
    return allBlocks(parseCss(readSrcFile(relativePath))).some((block) =>
      selectors(block).some((selector) =>
        lastCompoundClasses(selector).includes(name),
      ),
    );
  }

  it.each([
    ["components/ui/Card.module.css", "card"],
    ["components/ui/Button.module.css", "button"],
    ["components/ui/Button.module.css", "primary"],
    ["components/ui/Button.module.css", "secondary"],
    ["components/ui/Button.module.css", "ghost"],
    ["components/ui/message.module.css", "message"],
    ["components/ui/message.module.css", "danger"],
    ["components/ui/message.module.css", "neutral"],
  ])("%s defines .%s", (file, name) => {
    expect(defines(file, name)).toBe(true);
  });
});
