/**
 * FRONTEND-004 acceptance criterion 2, pinned structurally; since FRONTEND-013
 * (criteria 9 and 10) the three colleagues are the text box, the attachment
 * picker (`AttachmentPicker.tsx`) and the media widget, and the mention
 * dropdown is gone from the tree.
 *
 * "The text box, the mention autocomplete and the media widget exchange state
 * only through `ComposeMediator`" is not something a behavioural test can see: a
 * media widget that imports the text box directly and pokes at it still renders
 * and still passes every rendering test. So this reads the three component
 * sources from disk and asserts that none of them can reach either of the other
 * two, which is the same shape — and for the same reason — as
 * `src/auth/sdk-isolation.test.ts` and `src/test/env-usage.test.ts`: a rule
 * nobody has to remember beats a rule written in the wiki.
 *
 * The brief is explicit that this test is worth more than a test of the
 * mediator's own methods, so it is deliberately unambiguous: the check is on the
 * import specifiers themselves, it is symmetric across all six ordered pairs,
 * and it is guarded against passing vacuously if the walk finds nothing.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function findSrcDir(): string {
  // Vitest's `import.meta.url` is not a `file:` URL, so the tree is located from
  // the working directory: `frontend` locally, `/app` in the test container.
  for (const candidate of [
    join(process.cwd(), "src"),
    join(process.cwd(), "frontend", "src"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`cannot locate frontend/src from ${process.cwd()}`);
}

const COMPOSE_DIR = join(findSrcDir(), "features", "compose");

/** The three colleagues. Each name is also what its module is imported as. */
const COLLEAGUES = ["ComposeTextBox", "StatsPicker", "MediaWidget"] as const;

type Colleague = (typeof COLLEAGUES)[number];

function sourceOf(colleague: Colleague): string {
  return readFileSync(join(COMPOSE_DIR, `${colleague}.tsx`), "utf8");
}

/** Every module specifier the file imports from, in source order. */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  // `import ... from "x"`, `import "x"`, and `import("x")`.
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }

  return specifiers;
}

/** The last path segment of a specifier, extension dropped. */
function moduleName(specifier: string): string {
  const last = specifier.split("/").pop() ?? specifier;
  return last.replace(/\.[cm]?[jt]sx?$/, "");
}

describe("the three compose colleagues exist where the mediator expects them", () => {
  it.each(COLLEAGUES)("has %s.tsx", (colleague) => {
    expect(
      existsSync(join(COMPOSE_DIR, `${colleague}.tsx`)),
      `${colleague}.tsx must live in features/compose/`,
    ).toBe(true);
  });
});

describe("no two of the three compose components import each other", () => {
  it.each(COLLEAGUES)("%s imports neither of the other two", (colleague) => {
    const others = COLLEAGUES.filter((other) => other !== colleague);
    const imported = importSpecifiers(sourceOf(colleague)).map(moduleName);

    const offenders = others.filter((other) => imported.includes(other));

    expect(
      offenders,
      `${colleague} must reach ${others.join(" and ")} through ComposeMediator, never directly`,
    ).toEqual([]);
  });

  it("checks specifiers it actually found, not an empty list", () => {
    // Guards every assertion above: a regex that matched nothing would make
    // "imports neither of the other two" vacuously true for all three.
    for (const colleague of COLLEAGUES) {
      const imported = importSpecifiers(sourceOf(colleague));

      expect(
        imported.length,
        `no imports were parsed out of ${colleague}.tsx`,
      ).toBeGreaterThan(0);
      expect(
        imported.some((specifier) => specifier.startsWith(".")),
        `no relative import was parsed out of ${colleague}.tsx`,
      ).toBe(true);
    }
  });
});

describe("the three compose colleagues all depend on the mediator", () => {
  it.each(COLLEAGUES)("%s imports ComposeMediator", (colleague) => {
    // The positive half: "they do not import each other" is also satisfied by
    // three components that share no state at all, which is not the criterion.
    const imported = importSpecifiers(sourceOf(colleague)).map(moduleName);

    expect(
      imported,
      `${colleague} exchanges state through ComposeMediator, so it imports it`,
    ).toContain("ComposeMediator");
  });
});

describe("the #/$ mention dropdown is gone (FRONTEND-013 criterion 9)", () => {
  it.each([
    "MentionAutocomplete.tsx",
    "MentionAutocomplete.module.css",
    "mentions.ts",
  ])("%s no longer exists", (file) => {
    expect(
      existsSync(join(COMPOSE_DIR, file)),
      `${file} is still in features/compose/`,
    ).toBe(false);
  });

  it("is imported by nothing in features/compose/", () => {
    const sources = readdirSync(COMPOSE_DIR).filter(
      (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file),
    );
    expect(sources.length, "no sources were found to check").toBeGreaterThan(0);

    const offenders = sources.filter((file) =>
      importSpecifiers(readFileSync(join(COMPOSE_DIR, file), "utf8"))
        .map(moduleName)
        .some((name) => name === "MentionAutocomplete" || name === "mentions"),
    );

    expect(offenders).toEqual([]);
  });

  it("leaves no mention-inserted route in the mediator", () => {
    const mediator = readFileSync(
      join(COMPOSE_DIR, "ComposeMediator.ts"),
      "utf8",
    );

    expect(mediator).not.toMatch(/mention-inserted/);
  });
});
