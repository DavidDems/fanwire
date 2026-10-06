/**
 * Pins the shared module-CSS scanner and layout readers in `module-css.ts`
 * against inline fixtures, so a scanner that matched nothing can never make a
 * real stylesheet check (`routes/shell-css.test.ts`) vacuously green.
 */
import { describe, expect, it } from "vitest";

import { parseCss } from "./css";
import {
  isFixedToBottom,
  lastCompoundClasses,
  moduleCssViolations,
  topLevelFixedBottomRules,
} from "./module-css";

describe("moduleCssViolations", () => {
  it.each([
    [".a { color: #fff; }", "hex"],
    [".a { color: #1F7A8C; }", "hex"],
    [".a { background: rgb(2 43 58); }", "raw colour function"],
    [".a { background: rgba(0, 0, 0, 0.5); }", "raw colour function"],
    [".a { color: hsl(200 50% 50%); }", "raw colour function"],
    [".a { border: 1px solid black; }", "named colour"],
    [".a { color: White; }", "named colour"],
    [".a { border-color: var(--color-border, teal); }", "named colour"],
    [".a { font-size: 14px; }", "px font size"],
    [".a { font: 600 12px/1.2 sans-serif; }", "px font size"],
    [".a { outline: none; }", "outline removed"],
    [".a { outline: 0; }", "outline removed"],
    [".a { --icon-colour: blue; }", "named colour"],
    ["@media (min-width: 40em) { .a { color: red; } }", "named colour"],
  ])("flags %s", (css, problem) => {
    expect(moduleCssViolations(css).join("\n")).toContain(problem);
  });

  it.each([
    ".a { color: var(--color-text); background: var(--color-surface-muted); }",
    ".a { border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); }",
    ".a { color: currentColor; background: transparent; fill: inherit; }",
    ".a { font-size: var(--font-size-sm); padding: var(--space-2) var(--space-4); }",
    ".a { font-size: 0.875rem; min-height: 32px; }",
    ".a { outline: none; } .a:focus-visible { outline: var(--focus-ring); }",
    ".a[aria-current='page'] { font-weight: 600; }",
    "/* color: red; #fff */ .a { color: var(--color-text); }",
  ])("passes %s", (css) => {
    expect(moduleCssViolations(css)).toEqual([]);
  });
});

describe("the fixed-to-bottom reader", () => {
  it("finds a top-level rule fixed to the bottom", () => {
    const blocks = parseCss(
      ".nav { position: fixed; inset-inline: 0; bottom: 0; }",
    );
    expect(topLevelFixedBottomRules(blocks).map((b) => b.prelude)).toEqual([
      ".nav",
    ]);
  });

  it("accepts a unit on the zero", () => {
    expect(
      isFixedToBottom(parseCss(".n { position: fixed; bottom: 0px; }")[0]),
    ).toBe(true);
  });

  it("ignores a rule that is only fixed inside a media query", () => {
    const blocks = parseCss(
      "@media (min-width: 40em) { .nav { position: fixed; bottom: 0; } }",
    );
    expect(topLevelFixedBottomRules(blocks)).toEqual([]);
  });

  it("ignores a fixed rule not at the bottom, and a bottom rule not fixed", () => {
    const blocks = parseCss(
      ".a { position: fixed; top: 0; } .b { position: absolute; bottom: 0; }",
    );
    expect(topLevelFixedBottomRules(blocks)).toEqual([]);
  });
});

describe("lastCompoundClasses", () => {
  it.each([
    [".nav", ["nav"]],
    [".header .nav", ["nav"]],
    [".header > .nav.open", ["nav", "open"]],
    ["nav.primary", ["primary"]],
    ["nav", []],
  ])("%s -> %j", (selector, classes) => {
    expect(lastCompoundClasses(selector)).toEqual(classes);
  });
});
