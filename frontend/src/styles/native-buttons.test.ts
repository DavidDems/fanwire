/**
 * Native buttons get a readable default look from base.css.
 *
 * `base.css` (UI-001) gave every `button` `color: inherit` and left the
 * background to the browser. In dark mode that is Pale Sky text on the user
 * agent's grey button face (Chrome: `#6b6b6b`, about 3.4:1), measured on the
 * live site with Playwright on 2026-10-06. Every button the feature units
 * haven't moved onto `Button` yet looked like that.
 *
 * The default is the secondary look (`components.md` §2): surface fill,
 * `--color-text` label, `--color-border-strong` edge. Each pair is in
 * `tokens.md` §5 and checked by `tokens.test.ts`. The rules sit inside
 * `:where()`, so they have no specificity and any `*.module.css` class, such
 * as `Button`'s variants, always wins whatever order the bundle puts them in.
 *
 * jsdom computes no CSS, so this reads the file (`verification.md` §2a).
 */
import { describe, expect, it } from "vitest";

import {
  type CssBlock,
  isAtRule,
  normaliseValue,
  parseCss,
  readSrcFile,
  selectors,
} from "../test/css";

function topLevelRules(): CssBlock[] {
  return parseCss(readSrcFile("styles/base.css")).filter(
    (block) => !isAtRule(block),
  );
}

function value(rule: CssBlock, property: string): string {
  const found = [...rule.declarations]
    .reverse()
    .find((declaration) => declaration.property === property);
  return normaliseValue(found?.value ?? "");
}

/** A rule styles the target only through `:where(...)`, never a bare selector. */
function zeroSpecificityRulesFor(target: RegExp, extra?: RegExp): CssBlock[] {
  return topLevelRules().filter((rule) =>
    selectors(rule).some(
      (selector) =>
        /^:where\(/.test(selector) &&
        target.test(selector) &&
        (extra === undefined ? !/:hover/.test(selector) : extra.test(selector)),
    ),
  );
}

const BUTTON = /\bbutton\b/;
const FILE_BUTTON = /::file-selector-button/;

function expectSecondaryLook(rules: CssBlock[], what: string): void {
  expect(rules.length, `a :where(...) rule for ${what}`).toBeGreaterThan(0);
  const background = rules.map(
    (rule) => value(rule, "background-color") || value(rule, "background"),
  );
  expect(background, `${what} background`).toContain("var(--color-surface)");
  expect(
    rules.map((rule) => value(rule, "color")),
    `${what} label colour`,
  ).toContain("var(--color-text)");
  expect(
    rules.some((rule) =>
      /var\(--color-border-strong\)/.test(
        value(rule, "border") + value(rule, "border-color"),
      ),
    ),
    `${what} edge uses --color-border-strong (3:1 non-text)`,
  ).toBe(true);
}

describe("native buttons have a readable default (base.css)", () => {
  it("button: surface fill, text colour, strong border, at zero specificity", () => {
    expectSecondaryLook(zeroSpecificityRulesFor(BUTTON), "button");
  });

  it("button hover fills with --color-surface-muted", () => {
    const hover = zeroSpecificityRulesFor(BUTTON, /:hover/);
    expect(
      hover.map(
        (rule) => value(rule, "background-color") || value(rule, "background"),
      ),
    ).toContain("var(--color-surface-muted)");
  });

  it("the file input's button gets the same look", () => {
    expectSecondaryLook(
      zeroSpecificityRulesFor(FILE_BUTTON),
      "::file-selector-button",
    );
  });

  it("no bare (specific) button rule sets a background a module class would have to beat", () => {
    const bare = topLevelRules()
      .filter((rule) =>
        selectors(rule).some(
          (selector) => BUTTON.test(selector) && !/^:where\(/.test(selector),
        ),
      )
      .filter(
        (rule) => value(rule, "background-color") || value(rule, "background"),
      )
      .map((rule) => rule.prelude);
    expect(bare).toEqual([]);
  });
});
