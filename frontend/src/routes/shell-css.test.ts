/**
 * UI-003 acceptance criteria 8 and 9, pinned statically: the shell's CSS
 * module is read from disk, because jsdom applies no media queries and
 * computes no styles (`wiki/CodeContext/FrontendUI/verification.md` §1, §2a).
 *
 * Criterion 8 — `src/routes/AppLayout.module.css`, imported by `AppLayout.tsx`:
 * - the primary nav is `position: fixed; bottom: 0` by default, outside every
 *   media query (mobile-first, `layout.md` §2);
 * - the same rule is no longer fixed under `@media (min-width: 40em)`, which
 *   is where it becomes the sticky left sidebar (`FRONTEND-035`; it sat
 *   inline in the header before);
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

  it("stops fixing it from 40em, where it becomes the sidebar", () => {
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

/**
 * FRONTEND-027: what the measurements chose (the PR body has the numbers). These
 * pin the choice against a regression and prove nothing about how it looks; the
 * browser rows do that.
 *
 * Measured: at 345 px of content "Your profile" (61 px, 63 px as the current
 * page) wrapped in a 61 px cell, which made the bar 69.8 px tall against a 64 px
 * padding. No inline padding on a phone cell keeps it on one line (a 55.4 px bar)
 * down to 330 px of content. Under that it can still wrap, so the padding covers
 * the two-line bar too. With Sign out and a 17 px scrollbar at 640 px, the
 * 28 px cursive wordmark (105 px wide) wraps "Your profile"; at 18 px (68 px
 * wide) the header holds one line, so the wordmark shrinks from 40em until 44em.
 * It is never hidden: there is no symbol beside it any more.
 *
 * FRONTEND-035 changed what this block pins. The bar shows icons only, its
 * labels visually hidden, so no label wraps a cell any more and the cell's
 * padding and the 55 px figure are no longer pinned; the nav and Sign out left
 * the header, so neither is the header's 18 px wordmark from 40em to 44em, nor
 * Sign out's place at its right edge (the header's two ends are resolved per
 * width in `sidebar-nav.test.tsx`). The 28 px wordmark on phones and from 44em,
 * and the scroll padding that clears the bar, still hold.
 */
describe("the bottom bar and the header's room", () => {
  function topLevelRule(selector: string): CssBlock {
    const rule = shellBlocks().find(
      (block) => !isAtRule(block) && selectorSet(block).has(selector),
    );
    if (rule === undefined) throw new Error(`no top-level ${selector} rule`);
    return rule;
  }

  function ruleInMedia(condition: RegExp, selector: string): CssBlock {
    const media = shellBlocks().find(
      (block) => isAtRule(block) && condition.test(block.prelude),
    );
    if (media === undefined) throw new Error(`no ${String(condition)} query`);
    const rule = media.children.find((block) => block.prelude === selector);
    if (rule === undefined) throw new Error(`no ${selector} in that query`);
    return rule;
  }

  it("sizes scroll-padding-bottom for the bar's two-line height, and 0 from 40em", () => {
    // Whitespace out: Prettier breaks a calc this long over three lines.
    expect(
      declared(topLevelRule(":global(html)"), "scroll-padding-bottom")?.replace(
        /\s+/g,
        "",
      ),
    ).toBe("calc(var(--space-8)+var(--space-2)+env(safe-area-inset-bottom))");
    expect(
      declared(
        ruleInMedia(FROM_40EM, ":global(html)"),
        "scroll-padding-bottom",
      ),
    ).toBe("0");
  });

  it("does not call the bar under space-8 tall in the comment at the top", () => {
    const comment = readSrcFile(SHELL_CSS).split("*/")[0];

    expect(comment).not.toMatch(/under\s+space-8\s+tall/);
  });

  it("never hides the wordmark", () => {
    const rules = shellBlocks().flatMap((block) =>
      isAtRule(block) ? block.children : [block],
    );
    for (const rule of rules.filter((r) => selectorSet(r).has(".wordmark"))) {
      expect(declared(rule, "position")).not.toBe("absolute");
      expect(declared(rule, "clip")).toBeUndefined();
    }
  });

  it("draws the wordmark 28 px tall on phones, and 28 px in every query from 44em up", () => {
    expect(declared(topLevelRule(".wordmark img"), "height")).toBe("1.75rem");
    const wide = shellBlocks().filter((block) => {
      const em = /\(\s*min-width\s*:\s*([\d.]+)em\s*\)/i.exec(block.prelude);
      return isAtRule(block) && em !== null && Number(em[1]) >= 44;
    });
    for (const media of wide) {
      for (const rule of media.children) {
        if (!selectorSet(rule).has(".wordmark img")) continue;
        expect(declared(rule, "height"), media.prelude).toBe("1.75rem");
      }
    }
  });
});

/**
 * FRONTEND-030: the content column. `.main` keeps `--content-max` (the
 * reading width every route has), and the shell's module has one more rule,
 * for the records home, that sets `--content-max-wide`. Which routes carry it
 * is `AppLayout.test.tsx`'s, which renders them.
 */
describe("the content column (FRONTEND-030)", () => {
  function maxWidths(): { selector: string; value: string }[] {
    return allBlocks(shellBlocks())
      .filter((block) => !isAtRule(block))
      .flatMap((block) => {
        const value = declared(block, "max-width");
        return value === undefined
          ? []
          : [...selectorSet(block)].map((selector) => ({ selector, value }));
      });
  }

  it("keeps .main at var(--content-max)", () => {
    const main = shellBlocks().find(
      (block) => !isAtRule(block) && selectorSet(block).has(".main"),
    );
    expect(main, "no top-level .main rule").toBeDefined();
    expect(declared(main as CssBlock, "max-width")).toBe("var(--content-max)");
  });

  it("has a rule that widens main to var(--content-max-wide)", () => {
    const wide = maxWidths().filter(
      ({ value }) => value === "var(--content-max-wide)",
    );
    expect(wide, "no rule sets max-width: var(--content-max-wide)").not.toEqual(
      [],
    );
    // A width of its own, never a number written into the module.
    expect(
      maxWidths().filter(({ value }) => /\d+(rem|em|px)/.test(value)),
    ).toEqual([]);
  });
});

/**
 * FRONTEND-035: the sidebar's widths and breakpoints, as source. What each
 * element gets at each width is resolved against the rendered shell in
 * `sidebar-nav.test.tsx`; this pins only what the module must say by name.
 */
describe("the sidebar's widths and breakpoints (FRONTEND-035)", () => {
  const FROM_78EM = /^@media\b.*78em/i;

  it("has a 40em query and a 78em query", () => {
    const media = allBlocks(shellBlocks()).filter((block) =>
      /^@media\b/i.test(block.prelude),
    );
    expect(media.some(isFrom40em), "a (min-width: 40em) query").toBe(true);
    expect(
      media.some((block) => FROM_78EM.test(block.prelude)),
      "a 78em query",
    ).toBe(true);
  });

  it("names the sidebar's widths by token, never as numbers", () => {
    const css = readSrcFile(SHELL_CSS);
    expect(css).toMatch(/var\(\s*--sidebar-width-compact\s*\)/);
    expect(css).toMatch(/var\(\s*--sidebar-width\s*\)/);
    const values = allBlocks(shellBlocks())
      .flatMap((block) => block.declarations)
      .map(({ value }) => value);
    expect(
      values.filter((value) => /(?<![\d.])(4\.5|12)rem\b/.test(value)),
    ).toEqual([]);
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
