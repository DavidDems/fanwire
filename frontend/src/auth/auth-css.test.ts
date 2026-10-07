/**
 * UI-004 acceptance criterion 6, and the static half of criteria 1 and 5
 * (`wiki/CodeContext/FrontendUI/verification.md` §1, §2a).
 *
 * Every `*.module.css` this unit adds — any under `src/auth/`, and
 * `src/components/FormField.module.css` — has no hex, `rgb()`, `hsl()` or
 * named colour, no px font size, and no `outline: none` / `outline: 0`
 * without a `:focus-visible` rule in the same file. The scanner is the shared
 * one in `src/test/module-css.ts`.
 *
 * Not vacuous: `FormField.module.css` must exist and `FormField.tsx` must
 * import it, and some module under `src/auth/` must hold the narrow card's
 * `max-width: 25rem` (`layout.md` §3) and be imported by an auth component.
 * On Vitest 4 a module import returns a class name whether or not the rule
 * exists, so the class assertions in `auth-pages-style.test.tsx` need this
 * read from disk beside them.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SRC_DIR,
  allBlocks,
  isAtRule,
  parseCss,
  readSrcFile,
} from "../test/css";
import {
  declared,
  moduleCssFiles,
  moduleCssViolations,
} from "../test/module-css";

const AUTH_DIR = join(SRC_DIR, "auth");
const FORM_FIELD_CSS = "components/FormField.module.css";
const NARROW_CARD_WIDTH = "25rem";

/** `src/`-relative, forward-slashed, for readable failure messages. */
function srcRelative(file: string): string {
  return relative(SRC_DIR, file).split(sep).join("/");
}

/** Every non-test `.tsx` under `directory`, recursively. */
function componentFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) found.push(...componentFiles(full));
    else if (entry.endsWith(".tsx") && !/\.test\.tsx$/.test(entry))
      found.push(full);
  }
  return found;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Auth modules with a style rule that sets `max-width: 25rem`. */
function narrowCardModules(): string[] {
  return moduleCssFiles(AUTH_DIR).filter((file) =>
    allBlocks(parseCss(readFileSync(file, "utf8"))).some(
      (block) =>
        !isAtRule(block) && declared(block, "max-width") === NARROW_CARD_WIDTH,
    ),
  );
}

describe("FormField's CSS module (criterion 5, static half)", () => {
  it("exists as src/components/FormField.module.css and FormField imports it", () => {
    expect(() => readSrcFile(FORM_FIELD_CSS)).not.toThrow();
    expect(readSrcFile("components/FormField.tsx")).toMatch(
      /import\s+\w+\s+from\s+["']\.\/FormField\.module\.css["']/,
    );
  });
});

describe("the narrow form card (criterion 1, static half)", () => {
  it("has a rule under src/auth/ setting max-width: 25rem", () => {
    expect(
      narrowCardModules().map(srcRelative),
      `no *.module.css under src/auth/ has a rule with max-width: ${NARROW_CARD_WIDTH}`,
    ).not.toEqual([]);
  });

  it("is imported by an auth component", () => {
    const modules = narrowCardModules();
    expect(modules, "no narrow-card module to look for").not.toEqual([]);

    const importers = componentFiles(AUTH_DIR).filter((component) => {
      const source = readFileSync(component, "utf8");
      return modules.some((module) =>
        new RegExp(
          `from\\s+["'][^"']*/${escapeRegExp(basename(module))}["']`,
        ).test(source),
      );
    });

    expect(importers.map(srcRelative)).not.toEqual([]);
  });
});

describe("every *.module.css this unit adds (criterion 6)", () => {
  const files = [
    ...moduleCssFiles(AUTH_DIR),
    join(SRC_DIR, ...FORM_FIELD_CSS.split("/")),
  ];

  it("has module CSS to check (not vacuously green)", () => {
    expect(
      moduleCssFiles(AUTH_DIR).length,
      "no *.module.css under src/auth/",
    ).toBeGreaterThan(0);
    expect(() => readSrcFile(FORM_FIELD_CSS)).not.toThrow();
  });

  it("uses only var(--color-…), no px font sizes, and a visible focus", () => {
    const problems = files.flatMap((file) => {
      let css: string;
      try {
        css = readFileSync(file, "utf8");
      } catch {
        return [`${srcRelative(file)}: does not exist`];
      }
      return moduleCssViolations(css).map(
        (problem) => `${srcRelative(file)}: ${problem}`,
      );
    });

    expect(problems).toEqual([]);
  });
});
