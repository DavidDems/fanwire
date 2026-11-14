/**
 * FRONTEND-044, the Schedule page's stylesheets, read from disk because jsdom
 * applies no styles (`verification.md` §1 and `verification.md` §2a).
 *
 * - Every `*.module.css` under `src/features/schedule/` passes the shared
 *   scanner (`test/module-css.ts`): colours only through `var(--color-…)`, no
 *   px font sizes, a visible focus. Not vacuous: the cells' side-by-side
 *   layout is this unit's own, so there is module CSS to check.
 * - **Reduced motion: no animated slide** (`accessibility.md` A8). A move
 *   between days may be animated only in a way that reduced motion turns off:
 *   every `transition` or `animation` outside a
 *   `@media (prefers-reduced-motion: no-preference)` block times itself with
 *   the duration tokens (`var(--duration-…)`, `0ms` under
 *   `prefers-reduced-motion: reduce` in `base.css`), never a literal duration,
 *   and nothing sets `scroll-behavior: smooth` outside such a block.
 *   No transition at all passes too. How it looks is a browser row.
 */
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR, parseCss, type CssBlock } from "../../test/css";
import { moduleCssFiles, moduleCssViolations } from "../../test/module-css";

const SCHEDULE_DIR = join(SRC_DIR, "features", "schedule");
const NO_PREFERENCE = /prefers-reduced-motion\s*:\s*no-preference/i;
const MOTION =
  /^(transition|transition-duration|animation|animation-duration)$/;
/** A literal time other than zero: `200ms`, `.3s`, `1s`. */
const LITERAL_TIME = /(?<![\w.-])(?!0+(?:\.0+)?m?s\b)\d*\.?\d+m?s\b/i;

interface Found {
  file: string;
  prelude: string;
  property: string;
  value: string;
}

/** Every declaration outside a `prefers-reduced-motion: no-preference` block. */
function unguarded(blocks: CssBlock[], file: string): Found[] {
  return blocks.flatMap((block) => {
    if (/^@media\b/i.test(block.prelude) && NO_PREFERENCE.test(block.prelude))
      return [];
    return [
      ...block.declarations.map(({ property, value }) => ({
        file,
        prelude: block.prelude,
        property,
        value,
      })),
      ...unguarded(block.children, file),
    ];
  });
}

describe("every *.module.css under src/features/schedule", () => {
  const files = moduleCssFiles(SCHEDULE_DIR);
  const names = files.map((file) =>
    relative(SCHEDULE_DIR, file).split(sep).join("/"),
  );
  const declarations = files.flatMap((file, index) =>
    unguarded(parseCss(readFileSync(file, "utf8")), names[index]),
  );

  it("has module CSS to check (not vacuously green)", () => {
    expect(
      files.length,
      `no *.module.css under ${SCHEDULE_DIR}`,
    ).toBeGreaterThan(0);
  });

  it("uses only var(--color-…), no px font sizes, and a visible focus", () => {
    const problems = files.flatMap((file, index) =>
      moduleCssViolations(readFileSync(file, "utf8")).map(
        (problem) => `${names[index]}: ${problem}`,
      ),
    );

    expect(problems).toEqual([]);
  });

  it("animates nothing that reduced motion does not stop: durations are tokens", () => {
    const literal = declarations.filter(
      ({ property, value }) =>
        MOTION.test(property) && LITERAL_TIME.test(value),
    );

    expect(
      literal.map(
        (d) => `${d.file} ${d.prelude} { ${d.property}: ${d.value} }`,
      ),
    ).toEqual([]);
  });

  it("scrolls without smooth scrolling outside a no-preference block", () => {
    const smooth = declarations.filter(
      ({ property, value }) =>
        property === "scroll-behavior" && /smooth/i.test(value),
    );

    expect(
      smooth.map((d) => `${d.file} ${d.prelude} { ${d.property}: ${d.value} }`),
    ).toEqual([]);
  });
});
