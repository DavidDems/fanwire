/**
 * UI-003 acceptance criteria 8 and 9, pinned statically: the shell's CSS
 * module is read from disk, because jsdom applies no media queries and
 * computes no styles (`wiki/CodeContext/FrontendUI/verification.md` §1, §2a).
 *
 * Criterion 8 — `src/routes/AppLayout.module.css`, imported by `AppLayout.tsx`:
 * - the primary nav is `position: fixed; bottom: 0` by default, outside every
 *   media query (mobile-first, `layout.md` §2);
 * - the same rule is no longer fixed under `@media (min-width: 40em)`, which
 *   is where it sits inline in the header;
 * - there is no `max-width` media query (or the range form `width <`) anywhere.
 *
 * Criterion 9 — every `*.module.css` under `src/routes/`: no hex, `rgb()`,
 * `hsl()` or named colour, no px font size, and no `outline: none` /
 * `outline: 0` without a `:focus-visible` rule in the same file. The scanner
 * is `src/test/module-css.ts`, pinned against fixtures in its own test.
 *
 * That the fixed rule's class is the one the rendered `<nav>` carries is in
 * `AppLayout.test.tsx`: it needs a render, and this file reads files only.
 */
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SRC_DIR,
  allBlocks,
  isAtRule,
  parseCss,
  readSrcFile,
  type CssBlock,
} from "../test/css";
import {
  declared,
  moduleCssFiles,
  moduleCssViolations,
  selectorSet,
  topLevelFixedBottomRules,
} from "../test/module-css";

const ROUTES_DIR = join(SRC_DIR, "routes");
const SHELL_CSS = "routes/AppLayout.module.css";
const FROM_40EM = /^@media\b.*\(\s*min-width\s*:\s*40em\s*\)/i;
const MAX_WIDTH = /max-width|\bwidth\s*<|>\s*=?\s*width\b/i;

function shellBlocks(): CssBlock[] {
  return parseCss(readSrcFile(SHELL_CSS));
}

/** Is `block` the 40em media query? */
function isFrom40em(block: CssBlock): boolean {
  return isAtRule(block) && FROM_40EM.test(block.prelude);
}

/**
 * Every place the 40em layout can override `fixed`'s `position`:
 * a rule with the same selector inside a top-level 40em query, or a 40em
 * query nested inside the fixed rule itself (CSS nesting).
 */
function positionsFrom40em(fixed: CssBlock, blocks: CssBlock[]): string[] {
  const own = selectorSet(fixed);
  const values: string[] = [];

  for (const media of blocks.filter(isFrom40em)) {
    for (const rule of allBlocks(media.children)) {
      if (isAtRule(rule)) continue;
      if (![...selectorSet(rule)].some((selector) => own.has(selector)))
        continue;
      const position = declared(rule, "position");
      if (position !== undefined) values.push(position);
    }
  }

  for (const nested of fixed.children.filter(isFrom40em)) {
    const position = declared(nested, "position");
    if (position !== undefined) values.push(position);
  }

  return values;
}

describe("the shell's CSS module (criterion 8)", () => {
  it("exists as src/routes/AppLayout.module.css and AppLayout imports it", () => {
    expect(() => readSrcFile(SHELL_CSS)).not.toThrow();
    expect(readSrcFile("routes/AppLayout.tsx")).toMatch(
      /import\s+\w+\s+from\s+["']\.\/AppLayout\.module\.css["']/,
    );
  });

  it("fixes the nav to the bottom by default, outside any media query", () => {
    const fixed = topLevelFixedBottomRules(shellBlocks());

    expect(
      fixed.map((rule) => rule.prelude),
      "no top-level rule with position: fixed and bottom: 0",
    ).not.toEqual([]);
  });

  it("stops fixing it from 40em, where it sits in the header", () => {
    const blocks = shellBlocks();
    const fixed = topLevelFixedBottomRules(blocks);
    expect(fixed, "no top-level fixed-to-bottom rule").not.toEqual([]);
    expect(
      blocks.some(isFrom40em) ||
        fixed.some((rule) => rule.children.some(isFrom40em)),
      "no @media (min-width: 40em) block",
    ).toBe(true);

    const overridden = fixed.filter((rule) => {
      const positions = positionsFrom40em(rule, blocks);
      return (
        positions.length > 0 && positions[positions.length - 1] !== "fixed"
      );
    });

    expect(
      overridden.map((rule) => rule.prelude),
      "the fixed-to-bottom rule must set a position other than fixed under @media (min-width: 40em)",
    ).not.toEqual([]);
  });

  it("uses no max-width media query", () => {
    const media = allBlocks(shellBlocks())
      .filter((block) => /^@media\b/i.test(block.prelude))
      .map((block) => block.prelude);

    expect(media.filter((prelude) => MAX_WIDTH.test(prelude))).toEqual([]);
  });
});

describe("every *.module.css under src/routes (criterion 9)", () => {
  const files = moduleCssFiles(ROUTES_DIR);
  const names = files.map((file) =>
    relative(ROUTES_DIR, file).split(sep).join("/"),
  );

  it("has module CSS to check (not vacuously green)", () => {
    expect(files.length, `no *.module.css under ${ROUTES_DIR}`).toBeGreaterThan(
      0,
    );
    expect(names).toContain("AppLayout.module.css");
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
