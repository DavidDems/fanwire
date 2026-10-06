/**
 * UI-001: the global stylesheets are imported once, from the entry point,
 * tokens first so base.css can refer to them. Read statically: importing
 * main.tsx would mount the app.
 */
import { describe, expect, it } from "vitest";

import { readSrcFile } from "../test/css";

function importLine(specifier: string): RegExp {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`^\\s*import\\s+(["'])${escaped}\\1\\s*;?\\s*$`, "gm");
}

describe("main.tsx imports the global stylesheets", () => {
  const TOKENS = "./styles/tokens.css";
  const BASE = "./styles/base.css";

  it.each([TOKENS, BASE])("imports %s exactly once", (specifier) => {
    const matches = readSrcFile("main.tsx").match(importLine(specifier)) ?? [];
    expect(
      matches.length,
      `main.tsx should contain \`import "${specifier}";\` once`,
    ).toBe(1);
  });

  it("imports tokens.css before base.css", () => {
    const source = readSrcFile("main.tsx");
    const tokens = source.search(importLine(TOKENS));
    const base = source.search(importLine(BASE));
    expect(tokens, "tokens.css import").toBeGreaterThanOrEqual(0);
    expect(base, "base.css import").toBeGreaterThanOrEqual(0);
    expect(tokens).toBeLessThan(base);
  });
});
