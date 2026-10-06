/**
 * UI-002 criteria 2, 8 (no animation) and 10, pinned statically: the module
 * CSS under `src/components/ui/` is read from disk, because jsdom computes no
 * styles (`wiki/CodeContext/FrontendUI/verification.md` §1, §2a).
 *
 * - Every `*.module.css`: no hex, rgb()/hsl() (or other raw colour function)
 *   and no named colour — only `var(--color-…)` (accessibility.md A2); no px
 *   font sizes (A9); no `outline: none` / `outline: 0` unless the same file has
 *   a `:focus-visible` rule (A3).
 * - Button's `.md` rule sets `min-height: var(--target-min)` (A6).
 * - Skeleton has no `animation` and no `@keyframes` (A8: no shimmer at all).
 *
 * The scanners are tested against inline fixtures first, so a scanner that
 * matched nothing could not make the real checks vacuously green.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

function findSrcDir(): string {
  for (const candidate of [
    join(process.cwd(), "src"),
    join(process.cwd(), "frontend", "src"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`cannot locate frontend/src from ${process.cwd()}`);
}

const UI_DIR = join(findSrcDir(), "components", "ui");

function moduleCssFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) found.push(...moduleCssFiles(full));
    else if (entry.endsWith(".module.css")) found.push(full);
  }
  return found;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

interface Declaration {
  property: string;
  value: string;
}

/** Declarations inside rule bodies: `prop: value` preceded by `{` or `;`. */
function declarations(css: string): Declaration[] {
  const found: Declaration[] = [];
  const pattern = /[{;]\s*(-{0,2}[a-zA-Z][a-zA-Z0-9-]*)\s*:\s*([^;{}]*)/g;
  for (const match of stripComments(css).matchAll(pattern)) {
    found.push({ property: match[1].toLowerCase(), value: match[2].trim() });
  }
  return found;
}

/** Innermost rules: selector text and body. */
function rules(css: string): { selector: string; body: string }[] {
  const found: { selector: string; body: string }[] = [];
  for (const match of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    found.push({ selector: match[1].trim(), body: match[2] });
  }
  return found;
}

/** CSS <named-color> keywords (CSS Color 4), excluding `transparent` and `currentColor`. */
const NAMED_COLOURS = [
  "aliceblue",
  "antiquewhite",
  "aqua",
  "aquamarine",
  "azure",
  "beige",
  "bisque",
  "black",
  "blanchedalmond",
  "blue",
  "blueviolet",
  "brown",
  "burlywood",
  "cadetblue",
  "chartreuse",
  "chocolate",
  "coral",
  "cornflowerblue",
  "cornsilk",
  "crimson",
  "cyan",
  "darkblue",
  "darkcyan",
  "darkgoldenrod",
  "darkgray",
  "darkgreen",
  "darkgrey",
  "darkkhaki",
  "darkmagenta",
  "darkolivegreen",
  "darkorange",
  "darkorchid",
  "darkred",
  "darksalmon",
  "darkseagreen",
  "darkslateblue",
  "darkslategray",
  "darkslategrey",
  "darkturquoise",
  "darkviolet",
  "deeppink",
  "deepskyblue",
  "dimgray",
  "dimgrey",
  "dodgerblue",
  "firebrick",
  "floralwhite",
  "forestgreen",
  "fuchsia",
  "gainsboro",
  "ghostwhite",
  "gold",
  "goldenrod",
  "gray",
  "green",
  "greenyellow",
  "grey",
  "honeydew",
  "hotpink",
  "indianred",
  "indigo",
  "ivory",
  "khaki",
  "lavender",
  "lavenderblush",
  "lawngreen",
  "lemonchiffon",
  "lightblue",
  "lightcoral",
  "lightcyan",
  "lightgoldenrodyellow",
  "lightgray",
  "lightgreen",
  "lightgrey",
  "lightpink",
  "lightsalmon",
  "lightseagreen",
  "lightskyblue",
  "lightslategray",
  "lightslategrey",
  "lightsteelblue",
  "lightyellow",
  "lime",
  "limegreen",
  "linen",
  "magenta",
  "maroon",
  "mediumaquamarine",
  "mediumblue",
  "mediumorchid",
  "mediumpurple",
  "mediumseagreen",
  "mediumslateblue",
  "mediumspringgreen",
  "mediumturquoise",
  "mediumvioletred",
  "midnightblue",
  "mintcream",
  "mistyrose",
  "moccasin",
  "navajowhite",
  "navy",
  "oldlace",
  "olive",
  "olivedrab",
  "orange",
  "orangered",
  "orchid",
  "palegoldenrod",
  "palegreen",
  "paleturquoise",
  "palevioletred",
  "papayawhip",
  "peachpuff",
  "peru",
  "pink",
  "plum",
  "powderblue",
  "purple",
  "rebeccapurple",
  "red",
  "rosybrown",
  "royalblue",
  "saddlebrown",
  "salmon",
  "sandybrown",
  "seagreen",
  "seashell",
  "sienna",
  "silver",
  "skyblue",
  "slateblue",
  "slategray",
  "slategrey",
  "snow",
  "springgreen",
  "steelblue",
  "tan",
  "teal",
  "thistle",
  "tomato",
  "turquoise",
  "violet",
  "wheat",
  "white",
  "whitesmoke",
  "yellow",
  "yellowgreen",
];

const NAMED_COLOUR = new RegExp(
  `(?<![\\w-])(${NAMED_COLOURS.join("|")})(?![\\w-])`,
  "i",
);
const HEX = /#[0-9a-fA-F]{3,8}(?![\w-])/;
const COLOUR_FUNCTION =
  /(?<![\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/i;
const PX_FONT_SIZE = /(?<![\w.-])\d*\.?\d+px\b/i;
const OUTLINE_REMOVED = /^(none|0(px)?)(\s|$)/i;

/**
 * Remove each `var(--name` so custom-property names never read as colours,
 * while a fallback value (`var(--x, teal)`) is still scanned.
 */
function withoutVars(value: string): string {
  return value.replace(/var\(\s*--[\w-]+\s*,?/g, " ");
}

function violations(css: string): string[] {
  const problems: string[] = [];
  for (const { property, value } of declarations(css)) {
    const bare = withoutVars(value);
    if (HEX.test(bare)) problems.push(`${property}: ${value} — hex colour`);
    if (COLOUR_FUNCTION.test(bare))
      problems.push(`${property}: ${value} — raw colour function`);
    const named = NAMED_COLOUR.exec(bare);
    if (named)
      problems.push(`${property}: ${value} — named colour ${named[1]}`);
    if (
      (property === "font-size" || property === "font") &&
      PX_FONT_SIZE.test(bare)
    ) {
      problems.push(`${property}: ${value} — px font size`);
    }
  }
  const outlineRemoved = declarations(css).some(
    ({ property, value }) =>
      property === "outline" && OUTLINE_REMOVED.test(value),
  );
  if (outlineRemoved && !/:focus-visible\b/.test(stripComments(css))) {
    problems.push(
      "outline removed with no :focus-visible rule in the same file",
    );
  }
  return problems;
}

describe("the scanner itself", () => {
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
  ])("flags %s", (css, problem) => {
    expect(violations(css).join("\n")).toContain(problem);
  });

  it.each([
    ".a { color: var(--color-text); background: var(--color-surface-muted); }",
    ".a { border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); }",
    ".a { color: currentColor; background: transparent; fill: inherit; }",
    ".a { font-size: var(--font-size-sm); padding: var(--space-2) var(--space-4); }",
    ".a { font-size: 0.875rem; min-height: 32px; }",
    ".a { outline: none; } .a:focus-visible { outline: var(--focus-ring); }",
    ".a:hover:not(:disabled) { background: var(--color-action-hover); }",
    "/* color: red; #fff */ .a { color: var(--color-text); }",
  ])("passes %s", (css) => {
    expect(violations(css)).toEqual([]);
  });
});

describe("every *.module.css under src/components/ui", () => {
  const files = moduleCssFiles(UI_DIR);

  it("has module CSS to check (not vacuously green)", () => {
    expect(
      files.length,
      `no *.module.css found under ${UI_DIR}`,
    ).toBeGreaterThan(0);
    expect(
      files.map((file) => relative(UI_DIR, file).split(sep).join("/")),
    ).toContain("Button.module.css");
  });

  it("uses only var(--color-…), rem font sizes and a visible focus", () => {
    const problems = files.flatMap((file) =>
      violations(readFileSync(file, "utf8")).map(
        (problem) => `${relative(UI_DIR, file)}: ${problem}`,
      ),
    );

    expect(problems).toEqual([]);
  });
});

describe("Button.module.css", () => {
  const FILE = join(UI_DIR, "Button.module.css");

  it("sets the md size's min-height with var(--target-min)", () => {
    expect(existsSync(FILE), `${FILE} must exist`).toBe(true);

    const mdRules = rules(readFileSync(FILE, "utf8")).filter(({ selector }) =>
      /\.md(?![\w-])/.test(selector),
    );
    expect(mdRules.length, "no .md rule in Button.module.css").toBeGreaterThan(
      0,
    );
    expect(
      mdRules.some(({ body }) =>
        /(^|[;\s])min-height\s*:\s*var\(\s*--target-min\s*\)/.test(body),
      ),
      ".md must set min-height: var(--target-min)",
    ).toBe(true);
  });
});

describe("Skeleton.module.css", () => {
  const FILE = join(UI_DIR, "Skeleton.module.css");

  it("exists", () => {
    expect(existsSync(FILE), `${FILE} must exist`).toBe(true);
  });

  it("uses no animation and defines no @keyframes", () => {
    const css = stripComments(
      existsSync(FILE) ? readFileSync(FILE, "utf8") : "",
    );

    expect(css).not.toMatch(/@keyframes/i);
    expect(
      declarations(css).filter(({ property }) =>
        property.startsWith("animation"),
      ),
    ).toEqual([]);
  });
});
