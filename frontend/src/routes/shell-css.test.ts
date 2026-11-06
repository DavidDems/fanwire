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
  selectors,
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

/** FRONTEND-039: the sidebar widths and breakpoints are pinned by name. */
describe("the sidebar's widths and breakpoints (FRONTEND-035)", () => {
  const FROM_LABEL = /^@media\b.*\(\s*min-width\s*:\s*53\.75em\s*\)/i;
  const FROM_RAIL = /^@media\b.*\(\s*min-width\s*:\s*76\.0625em\s*\)/i;

  it("pins the sidebar, rail and desktop restoration breakpoints", () => {
    const media = allBlocks(shellBlocks()).filter((block) =>
      /^@media\b/i.test(block.prelude),
    );
    expect(media.some(isFrom40em), "a (min-width: 40em) query").toBe(true);
    expect(
      media.some((block) => FROM_LABEL.test(block.prelude)),
      "a (min-width: 53.75em) label query",
    ).toBe(true);
    expect(
      media.some((block) => FROM_RAIL.test(block.prelude)),
      "a (min-width: 76.0625em) rail query",
    ).toBe(true);
    const desktop = allBlocks(shellBlocks())
      .filter(
        (block) =>
          isAtRule(block) &&
          /\(\s*min-width\s*:\s*78em\s*\)/i.test(block.prelude),
      )
      .flatMap((media) => allBlocks(media.children))
      .filter((block) => !isAtRule(block));
    expect(
      desktop.some(
        (block) =>
          selectorSet(block).has(".body") &&
          block.declarations.some(
            ({ property, value }) =>
              property === "justify-content" && value === "center",
          ),
      ),
      "78em restores the centred desktop group",
    ).toBe(true);
    expect(
      desktop.some(
        (block) =>
          selectorSet(block).has(".nav") &&
          block.declarations.some(
            ({ property, value }) =>
              property === "width" && /--sidebar-width-compact/.test(value),
          ),
      ),
      "78em keeps the labelled sidebar instead of restoring icon-only nav",
    ).toBe(false);
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

  it("keeps the labelled layout inset and bounds main by the space left beside the sidebar", () => {
    const labelled = allBlocks(shellBlocks())
      .filter((block) => isAtRule(block) && FROM_LABEL.test(block.prelude))
      .flatMap((media) => allBlocks(media.children))
      .filter((block) => !isAtRule(block));
    const body = labelled.filter((block) => selectorSet(block).has(".body"));
    const main = labelled.filter((block) => selectorSet(block).has(".main"));
    expect(
      body.some((block) =>
        block.declarations.some(
          ({ property, value }) =>
            [
              "padding",
              "padding-inline",
              "padding-left",
              "margin-inline",
            ].includes(property) && /var\(\s*--space-4\s*\)/.test(value),
        ),
      ),
      "the labelled shell group has a space-4 edge allowance",
    ).toBe(true);
    expect(
      main.some((block) =>
        block.declarations.some(
          ({ property, value }) =>
            property === "min-width" &&
            /min\(\s*36rem\s*,\s*calc\(\s*100%\s*-\s*var\(\s*--sidebar-width\s*\)\s*-\s*var\(\s*--space-5\s*\)\s*\)\s*\)/.test(
              value,
            ),
        ),
      ),
      "main uses a 36rem minimum, bounded by available width at enlarged text",
    ).toBe(true);
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

/**
 * FRONTEND-036: the home page's right rail, as source. jsdom lays nothing
 * out, so what is pinned is what the modules must say by name; whether it
 * looks right (and that nothing overflows at 320 to 1920 px) is the browser
 * rows'.
 *
 * - `main` on `/` is widened, from 76.0625em only, to the feed's `--content-max`
 *   plus `--space-5` plus the rail's `--rail-width`, by a rule in the shell's
 *   module (where `main`'s other widths are). Which routes' `main` it reaches
 *   is `home-rail.test.tsx`'s, which renders them. `.main` itself keeps
 *   `--content-max` (above), so every other route keeps its width.
 * - The rail is `--rail-width` wide, sticky at the header's height (the
 *   sidebar's own `top`), and scrolls on its own when taller than the
 *   viewport: a height or max-height under `100vh`/`dvh`/`svh` and an `auto`
 *   overflow. These rules may sit in `routes/HomeView.module.css` or a
 *   `features/search/*.module.css`, wherever the rail's markup is.
 * - A post row's text is clamped to three lines.
 */
describe("the home page's rail (FRONTEND-036)", () => {
  const FROM_76EM = /^@media\b.*\(\s*min-width\s*:\s*76\.0625em\s*\)/i;
  const RAIL_SOURCES = (): string[] => [
    "routes/HomeView.module.css",
    ...moduleCssFiles(join(SRC_DIR, "features", "search")).map((file) =>
      relative(SRC_DIR, file).split(sep).join("/"),
    ),
  ];

  function railRules(): { file: string; rule: CssBlock }[] {
    return RAIL_SOURCES().flatMap((file) =>
      allBlocks(parseCss(readSrcFile(file)))
        .filter((block) => !isAtRule(block))
        .map((rule) => ({ file, rule })),
    );
  }

  function compact(value: string | undefined): string {
    return (value ?? "").replace(/\s+/g, "");
  }

  /** The shell's rules inside a (min-width: 76.0625em) query, at any depth. */
  function shellRulesFrom76em(): CssBlock[] {
    return allBlocks(shellBlocks())
      .filter((block) => isAtRule(block) && FROM_76EM.test(block.prelude))
      .flatMap((media) => allBlocks(media.children))
      .filter((block) => !isAtRule(block));
  }

  it("widens main from 76.0625em to --content-max + --space-5 + --rail-width", () => {
    const widened = shellRulesFrom76em().filter((rule) => {
      const value = compact(
        declared(rule, "max-width") ?? declared(rule, "max-inline-size"),
      );
      return (
        value.includes("var(--content-max)") &&
        value.includes("var(--space-5)") &&
        value.includes("var(--rail-width)")
      );
    });

    expect(
      widened.map((rule) => rule.prelude),
      "no rule under @media (min-width: 76.0625em) in AppLayout.module.css widens main by the rail",
    ).not.toEqual([]);
    for (const rule of widened) {
      expect(
        rule.prelude,
        "the widening is for main, not every route's column",
      ).toMatch(/\.main\b/);
      expect(selectors(rule)).not.toContain(".main");
    }
  });

  it("keeps the other columns as they were", () => {
    const main = shellBlocks().find(
      (block) => !isAtRule(block) && selectorSet(block).has(".main"),
    );
    expect(declared(main as CssBlock, "max-width")).toBe("var(--content-max)");
    for (const rule of shellRulesFrom76em()) {
      if (!selectorSet(rule).has(".main")) continue;
      expect(
        declared(rule, "max-width"),
        "@media (min-width: 76.0625em) must not widen every route's .main",
      ).toBeUndefined();
    }
  });

  it("sets the rail's width by --rail-width, never as a number", () => {
    const sized = railRules().filter(({ rule }) =>
      rule.declarations.some(
        ({ property, value }) =>
          /^(width|inline-size|flex|flex-basis|max-width|min-width)$/.test(
            property,
          ) && /var\(\s*--rail-width\s*\)/.test(value),
      ),
    );
    expect(
      sized.map(({ file, rule }) => `${file}: ${rule.prelude}`),
      "no rail rule sizes it by var(--rail-width)",
    ).not.toEqual([]);

    const numbers = railRules().filter(({ rule }) =>
      rule.declarations.some(({ value }) => /(?<![\d.])18rem\b/.test(value)),
    );
    expect(numbers.map(({ rule }) => rule.prelude)).toEqual([]);
  });

  it("makes the rail sticky at the header's height, as the sidebar is", () => {
    const sidebarTop = allBlocks(shellBlocks())
      .filter((block) => !isAtRule(block) && selectorSet(block).has(".nav"))
      .map((rule) => declared(rule, "top"))
      .filter(
        (top): top is string => top !== undefined && /target-min/.test(top),
      )
      .pop();
    expect(sidebarTop, "the sidebar's sticky top").toBeDefined();

    const sticky = railRules().filter(
      ({ rule }) => declared(rule, "position") === "sticky",
    );
    expect(
      sticky.map(({ rule }) => rule.prelude),
      "no rail rule is position: sticky",
    ).not.toEqual([]);
    expect(
      sticky.some(
        ({ rule }) => compact(declared(rule, "top")) === compact(sidebarTop),
      ),
      `a sticky rail rule's top is the sidebar's: ${sidebarTop ?? ""}`,
    ).toBe(true);
  });

  it("scrolls the rail on its own when it is taller than the viewport", () => {
    const VIEWPORT_TALL = /\b100(vh|dvh|svh|lvh)\b/;
    const scrolls = railRules().filter(({ rule }) => {
      if (declared(rule, "position") !== "sticky") return false;
      const height = [
        "max-height",
        "height",
        "max-block-size",
        "block-size",
      ].some((property) => VIEWPORT_TALL.test(declared(rule, property) ?? ""));
      const overflow = [
        declared(rule, "overflow-y"),
        declared(rule, "overflow"),
        declared(rule, "overflow-block"),
      ].some((value) => value !== undefined && /\bauto\b/.test(value));
      return height && overflow;
    });

    expect(
      scrolls.map(({ rule }) => rule.prelude),
      "the sticky rail needs a viewport-bounded height and overflow auto",
    ).not.toEqual([]);
  });

  it("clamps a post row's text to three lines", () => {
    const clamped = railRules().filter(({ rule }) =>
      ["-webkit-line-clamp", "line-clamp"].some(
        (property) => declared(rule, property) === "3",
      ),
    );

    expect(
      clamped.map(({ rule }) => rule.prelude),
      "no rule clamps to three lines",
    ).not.toEqual([]);
  });

  it("uses no max-width media query in the rail's modules", () => {
    const media = RAIL_SOURCES().flatMap((file) =>
      allBlocks(parseCss(readSrcFile(file)))
        .filter((block) => /^@media\b/i.test(block.prelude))
        .map((block) => block.prelude),
    );

    expect(media.filter((prelude) => MAX_WIDTH.test(prelude))).toEqual([]);
  });
});
