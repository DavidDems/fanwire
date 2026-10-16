/**
 * FRONTEND-010 criterion 7, pinned structurally: the thread's reply composer is
 * compose's own, built from the same parts as `/compose`.
 *
 * `InlineComposer` lives in `features/compose/` and is made of the same
 * `ComposeMediator`, `PostBuilder`, `ComposeTextBox`, `MentionAutocomplete` and
 * `MediaWidget` as `ComposePage` — not a second text box. A look-alike that
 * rendered its own `<textarea>` would pass every behavioural test in
 * `features/thread/ThreadModal.test.tsx`, which is why this reads the source
 * from disk. It imports no other feature: `features/thread` is what puts it
 * beside the feed's `PostNode`, and compose never learns about either.
 *
 * `component-isolation.test.ts` (the three colleagues talk only through the
 * mediator) is unchanged and still applies.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR } from "../../test/css";

const FILE = join(SRC_DIR, "features", "compose", "InlineComposer.tsx");

/** The parts `ComposePage` is built from, each imported by its own module name. */
const PARTS = [
  "ComposeMediator",
  "PostBuilder",
  "ComposeTextBox",
  "MentionAutocomplete",
  "MediaWidget",
] as const;

function source(): string {
  return existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
}

function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

function importSpecifiers(text: string): string[] {
  const specifiers: string[] = [];
  for (const pattern of [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']/g,
  ]) {
    for (const match of withoutComments(text).matchAll(pattern))
      specifiers.push(match[1]);
  }
  return specifiers;
}

function moduleName(specifier: string): string {
  const last = specifier.split("/").pop() ?? specifier;
  return last.replace(/\.[cm]?[jt]sx?$/, "");
}

describe("InlineComposer", () => {
  it("lives in features/compose/ and exports InlineComposer", () => {
    expect(existsSync(FILE), "features/compose/InlineComposer.tsx").toBe(true);
    expect(withoutComments(source())).toMatch(
      /export\s+(function|const)\s+InlineComposer\b/,
    );
  });

  it.each(PARTS)("is built on %s, as ComposePage is", (part) => {
    const imported = importSpecifiers(source())
      .filter((specifier) => specifier.startsWith("./"))
      .map(moduleName);

    expect(imported).toContain(part);
  });

  it("writes no text box of its own", () => {
    expect(withoutComments(source())).not.toMatch(/<textarea\b/);
  });

  it("imports no other feature", () => {
    const offenders = importSpecifiers(source()).filter((specifier) =>
      /(^|\/)(features\/)?(feed|thread|profile|notifications|search|games|players|stats)\//.test(
        specifier,
      ),
    );

    expect(offenders).toEqual([]);
  });

  it("checks imports it actually parsed", () => {
    expect(importSpecifiers(source()).length).toBeGreaterThan(0);
  });
});
