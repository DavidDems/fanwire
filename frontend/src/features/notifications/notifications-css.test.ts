/**
 * UI-007 acceptance criterion 5, and the static halves of criteria 1–3
 * (`wiki/CodeContext/FrontendUI/verification.md` §1, §2a).
 *
 * jsdom applies no styles, so the stylesheets are read from disk:
 *
 * - Every `*.module.css` under `src/features/notifications/` has no hex,
 *   `rgb()`, `hsl()` or named colour, no px font size, and no `outline: none` /
 *   `outline: 0` without a `:focus-visible` rule in the same file (the shared
 *   scanner in `src/test/module-css.ts`). Not vacuous: the dividers need CSS
 *   of their own, so at least one module must be there.
 * - One of them draws a divider *between* rows: a rule that targets a row
 *   relative to a sibling (`+`, `~`, `:not(:first-child)`,
 *   `:not(:last-child)`, …) with a top or bottom border in
 *   `var(--color-border…)`. The selector is otherwise the implementation's.
 * - On Vitest 4 `styles.anything` is a hashed name even for a class no rule
 *   defines, so every shared class `notifications-style.test.tsx` asserts is
 *   confirmed to exist in its stylesheet here.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR, allBlocks, isAtRule, parseCss, readSrcFile, selectors } from "../../test/css";
import { moduleCssFiles, moduleCssViolations } from "../../test/module-css";

const NOTIFICATIONS_DIR = join(SRC_DIR, "features", "notifications");

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
    else if (entry.endsWith(".tsx") && !/\.test\.tsx$/.test(entry)) found.push(full);
  }
  return found;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A selector that reaches a row by its relation to a sibling row. */
const BETWEEN_ROWS =
  /[+~]|:not\(\s*:(first|last)-(child|of-type)\s*\)|:nth-(child|of-type)\(\s*n\s*\+\s*2\s*\)/;
const DIVIDER_PROPERTY = /^border-(top|bottom|block-start|block-end)$/;

/** Notifications modules with a rule drawing a border-token divider between rows. */
function dividerModules(): string[] {
  return moduleCssFiles(NOTIFICATIONS_DIR).filter((file) =>
    allBlocks(parseCss(readFileSync(file, "utf8"))).some(
      (block) =>
        !isAtRule(block) &&
        selectors(block).some((selector) => BETWEEN_ROWS.test(selector)) &&
        block.declarations.some(
          ({ property, value }) =>
            DIVIDER_PROPERTY.test(property) && value.includes("var(--color-border"),
        ),
    ),
  );
}

/** True when some style rule in `css` has a selector using `.className`. */
function definesClass(css: string, className: string): boolean {
  const pattern = new RegExp(`\\.${escapeRegExp(className)}(?![\\w-])`);
  return allBlocks(parseCss(css)).some(
    (block) => !isAtRule(block) && selectors(block).some((selector) => pattern.test(selector)),
  );
}

describe("every *.module.css under src/features/notifications (criterion 5)", () => {
  const files = moduleCssFiles(NOTIFICATIONS_DIR);

  it("has module CSS to check (not vacuously green)", () => {
    expect(files.length, `no *.module.css under ${srcRelative(NOTIFICATIONS_DIR)}`).toBeGreaterThan(
      0,
    );
  });

  it("uses only var(--color-…), no px font sizes, and a visible focus", () => {
    const problems = files.flatMap((file) =>
      moduleCssViolations(readFileSync(file, "utf8")).map(
        (problem) => `${srcRelative(file)}: ${problem}`,
      ),
    );

    expect(problems).toEqual([]);
  });
});

describe("the dividers between rows (criterion 1, static half)", () => {
  it("has a rule drawing a var(--color-border…) border between sibling rows", () => {
    expect(
      dividerModules().map(srcRelative),
      "no *.module.css under src/features/notifications has a between-rows border rule",
    ).not.toEqual([]);
  });

  it("is imported by a notifications component", () => {
    const modules = dividerModules();
    expect(modules, "no divider module to look for").not.toEqual([]);

    const importers = componentFiles(NOTIFICATIONS_DIR).filter((component) => {
      const source = readFileSync(component, "utf8");
      return modules.some((module) =>
        new RegExp(`from\\s+["'][^"']*/${escapeRegExp(basename(module))}["']`).test(source),
      );
    });

    expect(importers.map(srcRelative)).not.toEqual([]);
  });
});

describe("the shared classes the style tests assert exist on disk", () => {
  const cases: [string, string[]][] = [
    ["components/ui/Card.module.css", ["card"]],
    ["components/ui/Button.module.css", ["button", "ghost", "sm"]],
    ["components/ui/message.module.css", ["message", "danger", "neutral"]],
    ["components/ui/EmptyState.module.css", ["empty", "message"]],
  ];

  it.each(cases)("%s defines %j", (file, classNames) => {
    const css = readSrcFile(file);
    const missing = classNames.filter((className) => !definesClass(css, className));
    expect(missing).toEqual([]);
  });
});
