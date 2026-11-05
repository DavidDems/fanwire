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
import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { lengthInRem, shorthandParts } from "../test/compose-modal";
import {
  SRC_DIR,
  isAtRule,
  parseCss,
  readSrcFile,
  selectors,
  type CssBlock,
} from "../test/css";
import { declared, lastCompoundClasses } from "../test/module-css";

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

/**
 * FRONTEND-032: the Invite button sits immediately left of the +, on its
 * baseline and fixed like it: either fixed itself (`InviteButton.module.css`,
 * the same `bottom` as the + and a `right` offset past the + plus a gap) or
 * in one fixed flex container with the + (in `InviteButton.module.css` or the
 * shell's module, with a `gap`). Whichever it is, the rule is a top-level
 * `position: fixed` rule other than the bottom nav's (`bottom: 0`).
 *
 * Pinned here: its bottom edge is the +'s at each width, so it clears the
 * bottom nav on phones exactly as the + does; its right offset (when it has
 * one) puts it wholly left of the +, with room between; and `main`'s bottom
 * padding reaches past its top edge as well as the +'s. Its height is taken as
 * the larger of what its rules declare and the +'s 3.5rem, since the two share
 * a baseline and the taller one sets the line.
 */
const INVITE_CSS = "components/ui/InviteButton.module.css";

/** The class names on top-level fixed rules not pinned to the very bottom. */
function floatingClasses(blocks: CssBlock[]): string[] {
  return blocks
    .filter(
      (block) =>
        !isAtRule(block) &&
        (declared(block, "position") ?? "").trim() === "fixed" &&
        declared(block, "bottom") !== undefined &&
        lengthInRem(declared(block, "bottom") ?? "") !== 0,
    )
    .flatMap((block) => selectors(block).flatMap(lastCompoundClasses));
}

interface Placed {
  file: string;
  className: string;
  rules: { phone: CssBlock[]; wide: CssBlock[] };
}

/** The Invite's fixed rule (or its container's), wherever it lives. */
function inviteRules(): Placed[] {
  const found: Placed[] = [];
  for (const file of [INVITE_CSS, "routes/AppLayout.module.css"]) {
    if (!existsSync(join(SRC_DIR, ...file.split("/")))) continue;
    const blocks = parseCss(readSrcFile(file));
    for (const className of new Set(floatingClasses(blocks))) {
      found.push({ file, className, rules: rulesFor(blocks, className) });
    }
  }
  return found;
}

/** The last value `rules` declare for any of `properties`, in rem. */
function lastLength(rules: CssBlock[], properties: string[]): number | null {
  let found: number | null = null;
  for (const rule of rules) {
    for (const { property, value } of rule.declarations) {
      if (properties.includes(property)) found = lengthInRem(value);
    }
  }
  return found;
}

function inviteBottom(placed: Placed, wide: boolean): number | null {
  const phone = lastLength(placed.rules.phone, ["bottom", "inset-block-end"]);
  if (!wide) return phone;
  return lastLength(placed.rules.wide, ["bottom", "inset-block-end"]) ?? phone;
}

function inviteHeight(placed: Placed, wide: boolean): number {
  const rules = wide
    ? [...placed.rules.phone, ...placed.rules.wide]
    : placed.rules.phone;
  const own = lastLength(rules, ["height", "min-height", "block-size"]) ?? 0;
  return Math.max(own, fabHeight);
}

function composeBottom(wide: boolean): number {
  const phone = floatingTop(fab.phone, null) - fabHeight;
  return wide ? floatingTop(fab.wide, phone) - fabHeight : phone;
}

function composeRight(wide: boolean): number | null {
  const phone = lastLength(fab.phone, ["right", "inset-inline-end"]);
  if (!wide) return phone;
  return lastLength(fab.wide, ["right", "inset-inline-end"]) ?? phone;
}

describe("the Invite button beside the + (FRONTEND-032)", () => {
  it("has a fixed rule of its own, or of a container it shares with the +", () => {
    const placed = inviteRules();

    expect(
      placed.map(({ file, className }) => `${file} .${className}`),
      `a top-level position: fixed rule (not the nav's) in ${INVITE_CSS} or the shell's module`,
    ).not.toEqual([]);
  });

  it.each([
    ["on phones", false],
    ["from 40em", true],
  ] as const)("%s, sits on the +'s baseline", (_label, wide) => {
    const placed = inviteRules();
    expect(placed).not.toEqual([]);

    for (const rule of placed) {
      const bottom = inviteBottom(rule, wide);
      expect(bottom, `.${rule.className}'s bottom`).not.toBeNull();
      expect(bottom ?? 0).toBeCloseTo(composeBottom(wide), 5);
    }
  });

  it("on phones, clears the bottom nav as the + does (and keeps the safe area)", () => {
    const placed = inviteRules();
    expect(placed).not.toEqual([]);

    for (const rule of placed) {
      // The nav is under var(--space-8) tall, plus the safe area.
      expect(inviteBottom(rule, false) ?? 0).toBeGreaterThanOrEqual(
        lengthInRem("var(--space-8)") ?? Infinity,
      );
      const bottom = rule.rules.phone
        .map((block) => declared(block, "bottom") ?? "")
        .join(" ");
      expect(bottom).toMatch(/env\(\s*safe-area-inset-bottom/);
    }
  });

  it.each([
    ["on phones", false],
    ["from 40em", true],
  ] as const)(
    "%s, sits wholly left of the +, with room between",
    (_label, wide) => {
      const placed = inviteRules();
      expect(placed).not.toEqual([]);

      for (const rule of placed) {
        const all = wide
          ? [...rule.rules.phone, ...rule.rules.wide]
          : rule.rules.phone;
        const right = lastLength(all, ["right", "inset-inline-end"]);
        const plusRight = composeRight(wide);
        expect(plusRight, "the +'s right offset").not.toBeNull();
        if (right !== null && right > (plusRight ?? 0)) {
          // Positioned itself: past the + and a gap.
          expect(right).toBeGreaterThan((plusRight ?? 0) + fabHeight);
        } else {
          // A container holding both: they are spaced by its gap.
          const gap = lastLength(all, ["gap", "column-gap"]);
          expect(
            gap,
            `.${rule.className} is neither offset past the + nor a container with a gap`,
          ).not.toBeNull();
          expect(gap ?? 0).toBeGreaterThan(0);
        }
      }
    },
  );

  it("main's bottom padding clears the Invite button as well as the +, at each width", () => {
    const placed = inviteRules();
    expect(placed).not.toEqual([]);
    const phonePadding = bottomPadding(shell.phone) ?? 0;
    const widePadding = bottomPadding([...shell.phone, ...shell.wide]) ?? 0;

    for (const rule of placed) {
      const phoneTop =
        (inviteBottom(rule, false) ?? Infinity) + inviteHeight(rule, false);
      const wideTop =
        (inviteBottom(rule, true) ?? Infinity) + inviteHeight(rule, true);

      expect(
        phonePadding,
        "phone: main's bottom padding",
      ).toBeGreaterThanOrEqual(phoneTop);
      expect(widePadding, "40em: main's bottom padding").toBeGreaterThanOrEqual(
        wideTop,
      );
    }
    // And the + still, as above.
    expect(phonePadding).toBeGreaterThanOrEqual(floatingTop(fab.phone, null));
  });
});
