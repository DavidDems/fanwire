/**
 * FRONTEND-020 — `main` gains bottom padding so the last card's controls
 * ("More options" included) scroll fully clear of the floating +, pinned
 * statically (jsdom applies no styles), as `shell-css.test.ts` pins the shell.
 *
 * The + is UI-010's `FloatingButton`: 3.5rem round, its bottom edge
 * `var(--space-8) + var(--space-4) + env(safe-area-inset-bottom)` above the
 * viewport's on phones (clear of the bottom bar) and `var(--space-5)` from
 * 40em. So its top edge is that offset plus its height above the viewport's
 * bottom, and `main`'s bottom padding must reach at least as high, at each
 * width, for the last card to scroll out from under it. Lengths are read from
 * the two CSS modules with the tokens resolved and `env()` taken as 0.
 */
import { describe, expect, it } from "vitest";

import { lengthInRem, shorthandParts } from "../test/compose-modal";
import {
  isAtRule,
  parseCss,
  readSrcFile,
  selectors,
  type CssBlock,
} from "../test/css";
import { declared } from "../test/module-css";

const FROM_40EM = /^@media\b.*\(\s*min-width\s*:\s*40em\s*\)/i;

function rulesFor(
  blocks: CssBlock[],
  className: string,
): { phone: CssBlock[]; wide: CssBlock[] } {
  const matches = (block: CssBlock) =>
    !isAtRule(block) && selectors(block).includes(`.${className}`);
  return {
    phone: blocks.filter(matches),
    wide: blocks
      .filter((block) => isAtRule(block) && FROM_40EM.test(block.prelude))
      .flatMap((media) => media.children.filter(matches)),
  };
}

/** The last bottom padding `rules` declare, longhand or shorthand, in rem. */
function bottomPadding(rules: CssBlock[]): number | null {
  let found: number | null = null;
  for (const rule of rules) {
    for (const { property, value } of rule.declarations) {
      if (property === "padding-bottom" || property === "padding-block-end") {
        found = lengthInRem(value);
      } else if (property === "padding" || property === "padding-block") {
        const parts = shorthandParts(value);
        const bottom =
          property === "padding-block"
            ? (parts[1] ?? parts[0])
            : parts.length >= 3
              ? parts[2]
              : parts[0];
        found = lengthInRem(bottom);
      }
    }
  }
  return found;
}

/** Where the +'s top edge sits above the viewport's bottom, in rem. */
function floatingTop(rules: CssBlock[], fallback: number | null): number {
  let bottom = fallback;
  let height: number | null = null;
  for (const rule of rules) {
    const b = declared(rule, "bottom");
    if (b !== undefined) bottom = lengthInRem(b);
    const h = declared(rule, "height");
    if (h !== undefined) height = lengthInRem(h);
  }
  if (bottom === null) throw new Error("the + has no bottom offset");
  return bottom + (height ?? 0);
}

const shell = rulesFor(
  parseCss(readSrcFile("routes/AppLayout.module.css")),
  "main",
);
const fab = rulesFor(
  parseCss(readSrcFile("components/ui/FloatingButton.module.css")),
  "floating",
);
const fabHeight = (() => {
  for (const rule of fab.phone) {
    const h = declared(rule, "height");
    if (h !== undefined) return lengthInRem(h) ?? 0;
  }
  return 0;
})();

describe("the readers see the real rules (not vacuously green)", () => {
  it("finds main's rules and the +'s", () => {
    expect(shell.phone.length).toBeGreaterThan(0);
    expect(shell.wide.length).toBeGreaterThan(0);
    expect(fab.phone.length).toBeGreaterThan(0);
    expect(fabHeight).toBe(3.5);
  });
});

describe("main's bottom padding clears the floating +", () => {
  it("on phones, above the bottom bar", () => {
    const phoneTop = floatingTop(fab.phone, null);
    const padding = bottomPadding(shell.phone);

    expect(padding, "main's phone bottom padding").not.toBeNull();
    expect(padding ?? 0).toBeGreaterThanOrEqual(phoneTop);
  });

  it("from 40em, where the + sits in the corner", () => {
    const phoneBottom = floatingTop(fab.phone, null) - fabHeight;
    const wideTop =
      floatingTop(fab.wide, phoneBottom) +
      (fab.wide.some((rule) => declared(rule, "height") !== undefined)
        ? 0
        : fabHeight);
    const padding = bottomPadding([...shell.phone, ...shell.wide]);

    expect(padding, "main's bottom padding from 40em").not.toBeNull();
    expect(padding ?? 0).toBeGreaterThanOrEqual(wideTop);
  });

  it("keeps the safe area in the phone padding", () => {
    const declaredPadding = shell.phone
      .flatMap((rule) => rule.declarations)
      .filter(({ property }) => /^padding/.test(property))
      .map(({ value }) => value)
      .join(" ");

    expect(declaredPadding).toMatch(/env\(\s*safe-area-inset-bottom/);
  });
});
