/**
 * The raw-value scanner for `*.module.css` files (`accessibility.md` A2, A3,
 * A9; `verification.md` §2a "No raw values in modules (every unit)").
 *
 * Every styling unit owes the same three checks on the module CSS it adds: no
 * hex, `rgb()`/`hsl()` (or other raw colour function) and no named colour, only
 * `var(--color-…)`; no px font sizes; and no `outline: none` / `outline: 0`
 * unless the same file has a `:focus-visible` rule. This is the shared copy, so
 * a later unit points it at its own folder instead of writing a fourth one.
 *
 * `module-css.test.ts` pins it against inline fixtures, so a scanner that
 * matched nothing could never make a real check vacuously green.
 *
 * It also holds the two small readers the shell's layout test needs: which
 * top-level rules pin something to the bottom of the viewport, and the class
 * names a selector's last compound carries.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { isAtRule, selectors, stripComments, type CssBlock } from "./css";

/** Every `*.module.css` under `directory`, recursively; `[]` if it does not exist. */
export function moduleCssFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) found.push(...moduleCssFiles(full));
    else if (entry.endsWith(".module.css")) found.push(full);
  }
  return found;
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

/** Every raw-value problem in one stylesheet, as readable lines; `[]` when clean. */
export function moduleCssViolations(css: string): string[] {
  const problems: string[] = [];
  const found = declarations(css);
  for (const { property, value } of found) {
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
  const outlineRemoved = found.some(
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

/** The last declared value of `property` directly in `block`, or `undefined`. */
export function declared(
  block: CssBlock,
  property: string,
): string | undefined {
  const matches = block.declarations.filter((d) => d.property === property);
  return matches.length === 0
    ? undefined
    : matches[matches.length - 1].value.trim().toLowerCase();
}

const ZERO = /^0(px|rem|em)?$/;

/** True when `block` declares `position: fixed` and `bottom: 0` directly. */
export function isFixedToBottom(block: CssBlock): boolean {
  const bottom = declared(block, "bottom");
  return (
    declared(block, "position") === "fixed" &&
    bottom !== undefined &&
    ZERO.test(bottom)
  );
}

/**
 * Top-level style rules (outside every at-rule) that are fixed to the bottom
 * of the viewport — the phone layout of the primary nav, which is the default
 * because the shell is mobile-first.
 */
export function topLevelFixedBottomRules(blocks: CssBlock[]): CssBlock[] {
  return blocks.filter((block) => !isAtRule(block) && isFixedToBottom(block));
}

/** The class names in the last compound of `selector`: `.header .nav.open` → nav, open. */
export function lastCompoundClasses(selector: string): string[] {
  const compounds = selector.trim().split(/\s*[\s>+~]\s*/);
  const last = compounds[compounds.length - 1] ?? "";
  return [...last.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]);
}

/** Every selector of a style rule, for matching one rule against another. */
export function selectorSet(block: CssBlock): Set<string> {
  return new Set(selectors(block));
}
