/**
 * UI-010 and accessibility.md A20: forced-colors mode (Windows High Contrast)
 * removes every box-shadow, so a meaning a shadow carries has to be carried
 * again by a border, an outline or a text decoration there.
 *
 * - The soft-filled controls' bottom rule is an inset shadow (base.css), so in
 *   forced colors they get a real bottom border, and the invalid ring (also a
 *   shadow) becomes an outline.
 * - SegmentedTabs' selected pill is a fill, which forced colors replaces, so
 *   the selected tab needs a cue that is not a colour.
 * - FloatingButton is a fill and a shadow, so it needs an edge.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type CssBlock,
  SRC_DIR,
  allBlocks,
  isAtRule,
  mediaBlocks,
  normaliseValue,
  parseCss,
  selectors,
} from "../test/css";

const FORCED = /forced-colors\s*:\s*active/i;

function forcedRules(file: string): CssBlock[] {
  const blocks = parseCss(
    readFileSync(join(SRC_DIR, ...file.split("/")), "utf8"),
  );
  return mediaBlocks(blocks, FORCED)
    .flatMap((media) => allBlocks(media.children))
    .filter((block) => !isAtRule(block));
}

function value(rule: CssBlock, property: RegExp): string[] {
  return rule.declarations
    .filter((declaration) => property.test(declaration.property))
    .map((declaration) => normaliseValue(declaration.value));
}

/** A drawn line: a non-zero width and a solid style in the same shorthand. */
const SOLID_LINE =
  /(^|\s)(?!0(px)?\b)\d*\.?\d+(px|rem|em)?\s+solid\b|\bsolid\s+(?!0(px)?\b)\d*\.?\d+(px|rem|em)\b/;

describe("forced colors keeps what the shadows and fills carry (A20)", () => {
  describe("styles/base.css", () => {
    const rules = () => forcedRules("styles/base.css");

    it.each([
      ["input", /^input:not\(/],
      ["select", /^select$/],
      ["textarea", /^textarea$/],
    ])("%s gets a solid bottom border", (_kind, target) => {
      const ok = rules().some(
        (rule) =>
          selectors(rule).some((selector) => target.test(selector)) &&
          value(rule, /^border(-bottom|-block-end)?$/).some((v) =>
            SOLID_LINE.test(v),
          ),
      );
      expect(ok).toBe(true);
    });

    it('an invalid control ([aria-invalid="true"]) gets a solid outline', () => {
      const ok = rules().some(
        (rule) =>
          selectors(rule).some((selector) =>
            /\[aria-invalid=(["']?)true\1\]/.test(selector),
          ) && value(rule, /^outline$/).some((v) => SOLID_LINE.test(v)),
      );
      expect(ok).toBe(true);
    });
  });

  it("SegmentedTabs underlines or edges the selected tab", () => {
    const ok = forcedRules("components/ui/SegmentedTabs.module.css").some(
      (rule) =>
        selectors(rule).some((selector) =>
          /\[aria-selected=(["']?)true\1\]/.test(selector),
        ) &&
        (value(rule, /^text-decoration(-line)?$/).some((v) =>
          v.includes("underline"),
        ) ||
          value(rule, /^(border|outline)$/).some((v) => SOLID_LINE.test(v))),
    );
    expect(ok).toBe(true);
  });

  it("FloatingButton gets a solid edge", () => {
    const ok = forcedRules("components/ui/FloatingButton.module.css").some(
      (rule) => value(rule, /^border$/).some((v) => SOLID_LINE.test(v)),
    );
    expect(ok).toBe(true);
  });

  it("the line matcher reads a width and solid in either order, never a zero", () => {
    expect(SOLID_LINE.test("1px solid var(--color-border-strong)")).toBe(true);
    expect(SOLID_LINE.test("solid 2px")).toBe(true);
    expect(SOLID_LINE.test("0 solid red")).toBe(false);
    expect(SOLID_LINE.test("none")).toBe(false);
  });
});
