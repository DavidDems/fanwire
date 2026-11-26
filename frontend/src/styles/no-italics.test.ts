/**
 * FRONTEND-059: no italics in the UI (`typography.md` §2, "No italics in the
 * UI"). No stylesheet under src sets italic or oblique, through `font-style`
 * or the `font` shorthand.
 *
 * Static over every `.css` file under src, as `base.test.ts`'s src-wide
 * sweeps are: jsdom applies no CSS, so this reads the files. Comments are
 * stripped first, so a comment that says italic is not a finding.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR, stripComments } from "../test/css";

const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "coverage", ".vite"]);

const FONT_STYLE = /font-style\s*:\s*(italic|oblique)/i;
const FONT_SHORTHAND = /\bfont\s*:[^;}]*\b(italic|oblique)\b/i;

function setsItalic(css: string): boolean {
  const code = stripComments(css);
  return FONT_STYLE.test(code) || FONT_SHORTHAND.test(code);
}

function cssFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory())
      return SKIP_DIRECTORIES.has(entry) ? [] : cssFiles(full);
    return entry.endsWith(".css") ? [full] : [];
  });
}

function srcRelative(file: string): string {
  return relative(SRC_DIR, file).split(sep).join("/");
}

describe("no italics in any CSS file under src (typography.md section 2)", () => {
  it.each([
    [".a { font-style: italic; }"],
    [".a { font-style: oblique 10deg; }"],
    [".a { font: italic 600 1rem sans-serif; }"],
  ])("the scan flags %s", (css) => {
    expect(setsItalic(css)).toBe(true);
  });

  it.each([
    [".a { font-style: normal; }"],
    ["/* this line was italic once */ .a { color: red; }"],
  ])("the scan passes %s", (css) => {
    expect(setsItalic(css)).toBe(false);
  });

  it("scans the real stylesheets (not vacuously green)", () => {
    const files = cssFiles(SRC_DIR).map(srcRelative);
    expect(files).toContain("styles/base.css");
    expect(files).toContain("styles/tokens.css");
    expect(files).toContain("features/feed/PostNode.module.css");
    expect(files).toContain("features/feed/previews/Previews.module.css");
  });

  it("finds none", () => {
    const offenders = cssFiles(SRC_DIR)
      .filter((file) => setsItalic(readFileSync(file, "utf8")))
      .map(srcRelative);
    expect(offenders).toEqual([]);
  });
});
