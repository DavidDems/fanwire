/**
 * A deliberately small CSS reader for static tests (`verification.md` §2a).
 *
 * jsdom computes no CSS, so the styling contract is asserted on the files
 * themselves. This is not a general CSS parser and does not try to be: it
 * strips comments, splits a stylesheet into nested `{}` blocks, and reads the
 * `property: value` declarations of each block. That is enough for the global
 * token and base stylesheets, and it adds no dependency.
 *
 * Contrast is WCAG 2.1 relative luminance and is **never rounded**: 4.499 is a
 * fail (`tokens.md`, "Ratios are not rounded").
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Vitest's `import.meta.url` is not a `file:` URL, so the tree is located from
 * the working directory: `frontend` locally, `/app` in the test container.
 */
export function findSrcDir(): string {
  for (const candidate of [
    join(process.cwd(), "src"),
    join(process.cwd(), "frontend", "src"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`cannot locate frontend/src from ${process.cwd()}`);
}

export const SRC_DIR = findSrcDir();

/** Reads a file under `src/`, failing with a readable message if it is missing. */
export function readSrcFile(relativePath: string): string {
  const full = join(SRC_DIR, ...relativePath.split("/"));
  if (!existsSync(full)) {
    throw new Error(`src/${relativePath} does not exist`);
  }
  return readFileSync(full, "utf8");
}

export interface Declaration {
  property: string;
  value: string;
}

export interface CssBlock {
  /** The selector list or at-rule prelude, comments removed, whitespace collapsed. */
  prelude: string;
  /** Declarations directly inside this block (not inside nested blocks). */
  declarations: Declaration[];
  /** Nested blocks: rules inside an `@media`, or CSS-nesting children. */
  children: CssBlock[];
}

export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function parseDeclarations(text: string): Declaration[] {
  const declarations: Declaration[] = [];
  for (const raw of text.split(";")) {
    const colon = raw.indexOf(":");
    if (colon === -1) continue;
    const property = collapse(raw.slice(0, colon));
    const value = collapse(raw.slice(colon + 1));
    if (property === "" || /[{}]/.test(property)) continue;
    declarations.push({
      property: property.startsWith("--") ? property : property.toLowerCase(),
      value,
    });
  }
  return declarations;
}

/**
 * Splits `css` into its top-level blocks, recursing into each. Text between
 * blocks that is not a prelude (stray declarations at this level) is read as
 * declarations of the enclosing block.
 */
function parseLevel(css: string): {
  declarations: Declaration[];
  children: CssBlock[];
} {
  const children: CssBlock[] = [];
  let loose = "";
  let index = 0;

  while (index < css.length) {
    const open = css.indexOf("{", index);
    if (open === -1) {
      loose += css.slice(index);
      break;
    }

    // The prelude starts after the last `;` or `}` before the brace.
    const before = css.slice(index, open);
    const cut = Math.max(before.lastIndexOf(";"), before.lastIndexOf("}"));
    loose += before.slice(0, cut + 1);
    const prelude = collapse(before.slice(cut + 1));

    let depth = 1;
    let cursor = open + 1;
    while (cursor < css.length && depth > 0) {
      const character = css[cursor];
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      cursor += 1;
    }
    if (depth !== 0) throw new Error(`unbalanced braces after "${prelude}"`);

    const inner = parseLevel(css.slice(open + 1, cursor - 1));
    children.push({
      prelude,
      declarations: inner.declarations,
      children: inner.children,
    });
    index = cursor;
  }

  return { declarations: parseDeclarations(loose), children };
}

export function parseCss(css: string): CssBlock[] {
  return parseLevel(stripComments(css)).children;
}

/** Every block at every depth, outermost first. */
export function allBlocks(blocks: CssBlock[]): CssBlock[] {
  return blocks.flatMap((block) => [block, ...allBlocks(block.children)]);
}

export function isAtRule(block: CssBlock): boolean {
  return block.prelude.startsWith("@");
}

/**
 * The comma-separated selectors of a style rule, each trimmed. Commas inside
 * parentheses (`:is(a, button)`) do not split.
 */
export function selectors(block: CssBlock): string[] {
  if (isAtRule(block)) return [];
  const found: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of block.prelude) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      found.push(collapse(current));
      current = "";
      continue;
    }
    current += character;
  }
  found.push(collapse(current));
  return found;
}

export function targetsRoot(block: CssBlock): boolean {
  return selectors(block).includes(":root");
}

/** Top-level `@media` blocks whose condition matches `condition`. */
export function mediaBlocks(blocks: CssBlock[], condition: RegExp): CssBlock[] {
  return blocks.filter(
    (block) =>
      /^@media\b/i.test(block.prelude) && condition.test(block.prelude),
  );
}

export const DARK_SCHEME = /prefers-color-scheme\s*:\s*dark/i;
export const REDUCED_MOTION = /prefers-reduced-motion\s*:\s*reduce/i;

/** Custom properties declared on `:root` rules among `blocks` (not nested in at-rules). */
export function rootCustomProperties(blocks: CssBlock[]): Map<string, string> {
  const properties = new Map<string, string>();
  for (const block of blocks.filter(targetsRoot)) {
    for (const { property, value } of block.declarations) {
      if (property.startsWith("--")) properties.set(property, value);
    }
  }
  return properties;
}

/** Custom properties declared on `:root` inside every matching top-level `@media` block. */
export function mediaRootCustomProperties(
  blocks: CssBlock[],
  condition: RegExp,
): Map<string, string> {
  const properties = new Map<string, string>();
  for (const media of mediaBlocks(blocks, condition)) {
    for (const [property, value] of rootCustomProperties(media.children)) {
      properties.set(property, value);
    }
  }
  return properties;
}

/**
 * Normalises a declared value for comparison: lowercase, one space between
 * words, none next to `,`, `(`, `)` or `/`, and `!important` kept as written.
 */
export function normaliseValue(value: string): string {
  return collapse(value.toLowerCase())
    .replace(/\s*([,()/])\s*/g, "$1")
    .replace(/,/g, ", ")
    .replace(/\//g, " / ");
}

const VAR_REFERENCE = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/;

/**
 * Resolves a custom property for a theme the way the cascade does: the dark
 * theme reads its own declaration first and falls back to `:root` for any
 * token it does not redeclare, and a `var()` inside a dark value resolves
 * against the dark theme too.
 */
export function resolveToken(
  name: string,
  light: Map<string, string>,
  dark: Map<string, string> | null,
  seen: Set<string> = new Set(),
): string {
  if (seen.has(name))
    throw new Error(`var() cycle through ${[...seen, name].join(" -> ")}`);
  const value = dark?.get(name) ?? light.get(name);
  if (value === undefined) throw new Error(`${name} is not declared`);
  return resolveValue(value, light, dark, new Set([...seen, name]));
}

export function resolveValue(
  value: string,
  light: Map<string, string>,
  dark: Map<string, string> | null,
  seen: Set<string> = new Set(),
): string {
  const reference = VAR_REFERENCE.exec(collapse(value));
  if (reference === null) return collapse(value);
  const [, name, fallback] = reference;
  if (!light.has(name) && !dark?.has(name) && fallback !== undefined) {
    return resolveValue(fallback, light, dark, seen);
  }
  return resolveToken(name, light, dark, seen);
}

/** `#rgb` or `#rrggbb` (either case) to lowercase `#rrggbb`; anything else throws. */
export function normaliseHex(value: string): string {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (match === null) throw new Error(`"${value}" is not a hex colour`);
  const digits = match[1].toLowerCase();
  return digits.length === 3
    ? `#${digits
        .split("")
        .map((digit) => digit + digit)
        .join("")}`
    : `#${digits}`;
}

/** WCAG 2.1 relative luminance of an sRGB hex colour. */
export function relativeLuminance(hex: string): number {
  const digits = normaliseHex(hex).slice(1);
  const [red, green, blue] = [0, 2, 4].map((offset) => {
    const channel = parseInt(digits.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG 2.1 contrast ratio. Unrounded, on purpose. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}
