/**
 * Pins the small CSS reader the static styling tests rely on, so a reader bug
 * can't make a stylesheet assertion pass vacuously, and so ordinary
 * formatting (comments, case, short hex, nested at-rules) never fails a
 * correct stylesheet.
 */
import { describe, expect, it } from "vitest";

import {
  DARK_SCHEME,
  REDUCED_MOTION,
  allBlocks,
  mediaRootCustomProperties,
  normaliseHex,
  normaliseValue,
  parseCss,
  resolveToken,
  rootCustomProperties,
  selectors,
} from "./css";

const SAMPLE = `
/* Brand */
:root {
  --color-ink: #022B3A; /* uppercase */
  --color-sky:#BDF;
  --color-text: var( --color-ink );
  --color-link: var(--missing, #1f7a8c);
  color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
  /* only text is redeclared */
  :root {
    --color-text: var(--color-sky);
  }
}

@media (prefers-reduced-motion:reduce) {
  :root { --duration-fast: 0ms; }
}

:is(a, button):focus-visible, .x { outline: 2px solid var(--color-focus) }
`;

describe("the CSS reader", () => {
  const blocks = parseCss(SAMPLE);
  const light = rootCustomProperties(blocks);
  const dark = mediaRootCustomProperties(blocks, DARK_SCHEME);

  it("reads :root custom properties, ignoring comments and whitespace", () => {
    expect(light.get("--color-ink")).toBe("#022B3A");
    expect(light.get("--color-sky")).toBe("#BDF");
    expect(light.has("color-scheme")).toBe(false);
  });

  it("does not mix at-rule :root blocks into the top-level :root", () => {
    expect(light.has("--duration-fast")).toBe(false);
    expect(
      mediaRootCustomProperties(blocks, REDUCED_MOTION).get("--duration-fast"),
    ).toBe("0ms");
  });

  it("resolves var() per theme, falling back to :root for what dark does not redeclare", () => {
    expect(normaliseHex(resolveToken("--color-text", light, null))).toBe(
      "#022b3a",
    );
    expect(normaliseHex(resolveToken("--color-text", light, dark))).toBe(
      "#bbddff",
    );
    expect(normaliseHex(resolveToken("--color-ink", light, dark))).toBe(
      "#022b3a",
    );
  });

  it("uses a var() fallback only when the reference is undeclared", () => {
    expect(resolveToken("--color-link", light, null)).toBe("#1f7a8c");
  });

  it("throws on an undeclared token rather than passing silently", () => {
    expect(() => resolveToken("--color-nope", light, dark)).toThrow(
      /not declared/,
    );
  });

  it("splits selector lists at top-level commas only", () => {
    const rule = allBlocks(blocks).find((block) =>
      block.prelude.includes("focus-visible"),
    );
    expect(rule && selectors(rule)).toEqual([
      ":is(a, button):focus-visible",
      ".x",
    ]);
  });

  it("normalises values for comparison", () => {
    expect(
      normaliseValue(
        "0 1px 2px rgb( 2 43 58/0.08 ),0 1px 3px rgb(2 43 58 / 0.06)",
      ),
    ).toBe(
      normaliseValue(
        "0 1px 2px rgb(2 43 58 / 0.08), 0 1px 3px rgb(2 43 58 / 0.06)",
      ),
    );
  });
});
