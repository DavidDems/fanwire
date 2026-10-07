/**
 * FRONTEND-007 acceptance criteria 3 and 9, pinned structurally — what the
 * code *is*, which a behavioural test cannot fully see.
 *
 * - **Built from the shared components** (criterion 9): the search sources,
 *   between them, import `Card`, `Button`, `InlineAlert`, `StatusLine` and
 *   `EmptyState` from `components/ui/`, and `GameScore` for the game rows
 *   (criterion 10). A hand-rolled `<p role="alert">` renders the same role,
 *   which is why this is read from disk.
 * - **Posts render through `PostNode`, not a search renderer** (criterion 3):
 *   a source imports `PostNode` from `../feed/PostNode`, nothing in this
 *   folder reads a post's text or like data itself, and the only things taken
 *   from `features/feed` are `PostNode` and `api` (the cache's root key, which
 *   `LikeButton`'s optimistic patch walks). Any other sibling feature is never
 *   imported ([[0x00-architecture]] Connection rule).
 *
 * The lexical check is deliberately modest and comment-stripped: stripping can
 * only hide a match, never invent one. Every sweep is guarded against passing
 * vacuously, the way `features/feed/feed-isolation.test.ts` does it.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR } from "../../test/css";

const SEARCH_DIR = join(SRC_DIR, "features", "search");

/** The modules this unit's interface names. */
const MODULES = ["SearchPage.tsx", "SearchBar.tsx", "GameFilter.tsx"] as const;

const SHARED = [
  "Card",
  "Button",
  "InlineAlert",
  "StatusLine",
  "EmptyState",
  "GameScore",
] as const;

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"];

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension)))
      found.push(full);
  }
  return found;
}

function isTest(file: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/.test(file);
}

/** This unit's shipped modules, tests excluded. */
function searchSources(): string[] {
  return sourceFiles(SEARCH_DIR).filter((file) => !isTest(file));
}

function posix(file: string): string {
  return relative(SRC_DIR, file).split(sep).join("/");
}

function read(file: string): string {
  return readFileSync(file, "utf8");
}

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

interface ImportStatement {
  specifier: string;
  /** The named and default bindings, as written (`A as B` → `A`). */
  names: string[];
}

/** Every static `import … from "…"` in a source, with what it binds. */
function importStatements(source: string): ImportStatement[] {
  const found: ImportStatement[] = [];
  const pattern =
    /\bimport\s+(?:type\s+)?([\s\S]*?)\s+from\s*["']([^"']+)["']/g;
  for (const match of withoutComments(source).matchAll(pattern)) {
    const clause = match[1];
    const names: string[] = [];
    const braces = /\{([\s\S]*)\}/.exec(clause);
    if (braces !== null) {
      for (const part of braces[1].split(",")) {
        const name = part
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0]
          .trim();
        if (name !== "") names.push(name);
      }
    }
    const outside = clause
      .replace(/\{[\s\S]*\}/, "")
      .replace(/,/g, " ")
      .trim();
    if (outside !== "" && !outside.startsWith("*"))
      names.push(outside.split(/\s+/)[0]);
    found.push({ specifier: match[2], names });
  }
  // Side-effect and dynamic imports carry no bindings but are still imports.
  for (const match of withoutComments(source).matchAll(
    /\bimport\s*\(?\s*["']([^"']+)["']/g,
  )) {
    found.push({ specifier: match[1], names: [] });
  }
  return found;
}

/** The last path segment of a specifier, extension dropped. */
function moduleName(specifier: string): string {
  const last = specifier.split("/").pop() ?? specifier;
  return last.replace(/\.[cm]?[jt]sx?$/, "");
}

describe("the search unit's modules exist where its interface names them", () => {
  it.each(MODULES)("has %s", (module) => {
    expect(
      existsSync(join(SEARCH_DIR, module)),
      `${module} must live in features/search/`,
    ).toBe(true);
  });

  it("reads source it actually found", () => {
    const sources = searchSources();

    expect(
      sources.length,
      "features/search has no modules to check",
    ).toBeGreaterThan(0);
    for (const file of sources) {
      expect(
        withoutComments(read(file)).trim().length,
        `${posix(file)} is empty`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("built from the shared components (criterion 9)", () => {
  it.each(SHARED)("imports %s from components/ui", (component) => {
    const importers = searchSources().filter((file) =>
      importStatements(read(file)).some(
        ({ specifier, names }) =>
          /(^|\/)components\/ui\//.test(specifier) &&
          moduleName(specifier) === component &&
          names.includes(component),
      ),
    );

    expect(
      importers.map(posix),
      `no search source imports ${component}`,
    ).not.toEqual([]);
  });
});

describe("posts render through the feed's PostNode (criterion 3)", () => {
  it("imports PostNode from ../feed/PostNode", () => {
    const importers = searchSources().filter((file) =>
      importStatements(read(file)).some(
        ({ specifier, names }) =>
          /^\.\.\/feed\/PostNode(\.tsx?)?$/.test(specifier) &&
          names.includes("PostNode"),
      ),
    );

    expect(importers.map(posix)).not.toEqual([]);
  });

  it("takes nothing from features/feed but PostNode and api", () => {
    const offenders: string[] = [];
    for (const file of searchSources()) {
      for (const { specifier } of importStatements(read(file))) {
        const fromFeed = /(^|\/)feed\//.test(specifier);
        if (fromFeed && !["PostNode", "api"].includes(moduleName(specifier))) {
          offenders.push(`${posix(file)} imports ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("imports no other sibling feature", () => {
    const sibling = /(^|\/)(features\/)?(compose|profile|notifications)(\/|$)/;
    const offenders: string[] = [];
    for (const file of searchSources()) {
      for (const { specifier } of importStatements(read(file))) {
        if (sibling.test(specifier))
          offenders.push(`${posix(file)} imports ${specifier}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("renders no post itself: no search source reads a post's text or like data", () => {
    // A property read, not a call: `.text(` (a response body) is not a post,
    // and a CSS module's own `styles.text` class is not one either.
    const POST_FIELDS =
      /(?<!\bstyles)\.(text|like_count|liked_by_viewer|live_scores)\b(?!\s*\()/;
    const offenders = searchSources()
      .filter((file) => POST_FIELDS.test(withoutComments(read(file))))
      .map(posix);

    expect(
      offenders,
      "a post result is PostNode's to render, not this unit's",
    ).toEqual([]);
  });

  it("parsed imports out of the sources it checked", () => {
    // Guards the absences above: a regex that parsed nothing would pass them.
    const sources = searchSources();

    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      if (!file.endsWith(".tsx")) continue;
      expect(
        importStatements(read(file)).length,
        `no imports parsed out of ${posix(file)}`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("no raw HTML", () => {
  it("never sets inner HTML from a search source", () => {
    const needle = ["dangerously", "Set", "Inner", "HTML"].join("");
    const offenders = searchSources()
      .filter((file) => read(file).includes(needle))
      .map(posix);

    expect(offenders).toEqual([]);
  });
});
