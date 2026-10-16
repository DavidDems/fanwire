/**
 * FRONTEND-010 criteria 7 and 13, pinned structurally — what the thread
 * feature *is*, which a behavioural test cannot see.
 *
 * - **The thread is assembled, not rebuilt.** `features/thread/` renders posts
 *   through the feed's `PostNode` and replies through compose's
 *   `InlineComposer`. From `features/feed` it takes only `PostNode` and `api`
 *   (the thread read and the cache keys); from `features/compose` only
 *   `InlineComposer`; and it imports no other feature at all
 *   ([[0x00-architecture]] Connection rule). The feed never imports it back —
 *   that half is `features/feed/feed-isolation.test.ts`.
 * - **The modal is the shared `Dialog`** from `components/ui/`, not a dialog of
 *   its own.
 *
 * Same shape as `features/search/search-isolation.test.ts`: comment-stripped,
 * every absence guarded against passing on an empty walk or an import regex
 * that parsed nothing.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR } from "../../test/css";

const THREAD_DIR = join(SRC_DIR, "features", "thread");

/** The modules this unit's interface names. */
const MODULES = ["ThreadModal.tsx"] as const;

/** Every other feature folder, none of which the thread may import. */
const OTHER_FEATURES = [
  "games",
  "notifications",
  "players",
  "profile",
  "search",
  "stats",
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
function threadSources(): string[] {
  return sourceFiles(THREAD_DIR).filter((file) => !isTest(file));
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

/** Every `import … from "…"`, side-effect and dynamic import in a source. */
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
  for (const match of withoutComments(source).matchAll(
    /\bimport\s*\(?\s*["']([^"']+)["']/g,
  )) {
    found.push({ specifier: match[1], names: [] });
  }
  // Re-exports reach into a module just as an import does.
  for (const match of withoutComments(source).matchAll(
    /\bexport\s+[^;]*?\bfrom\s*["']([^"']+)["']/g,
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

/** Which feature folder a specifier reaches into from `features/thread/`, if any. */
function featureOf(specifier: string): string | null {
  const sibling = /^\.\.\/([^/.][^/]*)\//.exec(specifier);
  if (sibling !== null) return sibling[1];
  const viaFeatures = /(^|\/)features\/([^/]+)\//.exec(specifier);
  return viaFeatures === null ? null : viaFeatures[2];
}

function allImports(): { file: string; statement: ImportStatement }[] {
  return threadSources().flatMap((file) =>
    importStatements(read(file)).map((statement) => ({ file, statement })),
  );
}

describe("the thread unit's modules exist where its interface names them", () => {
  it.each(MODULES)("has %s", (module) => {
    expect(
      existsSync(join(THREAD_DIR, module)),
      `${module} must live in features/thread/`,
    ).toBe(true);
  });

  it("reads source it actually found, and parsed imports out of it", () => {
    const sources = threadSources();

    expect(
      sources.length,
      "features/thread has no modules to check",
    ).toBeGreaterThan(0);
    for (const file of sources) {
      expect(
        withoutComments(read(file)).trim().length,
        `${posix(file)} is empty`,
      ).toBeGreaterThan(0);
      if (file.endsWith(".tsx")) {
        expect(
          importStatements(read(file)).length,
          `no imports parsed out of ${posix(file)}`,
        ).toBeGreaterThan(0);
      }
    }
  });
});

describe("the thread is assembled from the feed and compose", () => {
  it("imports PostNode from ../feed/PostNode", () => {
    const importers = allImports().filter(
      ({ statement }) =>
        /^\.\.\/feed\/PostNode(\.tsx?)?$/.test(statement.specifier) &&
        statement.names.includes("PostNode"),
    );

    expect(importers.map(({ file }) => posix(file))).not.toEqual([]);
  });

  it("imports InlineComposer from ../compose/InlineComposer", () => {
    const importers = allImports().filter(
      ({ statement }) =>
        /^\.\.\/compose\/InlineComposer(\.tsx?)?$/.test(statement.specifier) &&
        statement.names.includes("InlineComposer"),
    );

    expect(importers.map(({ file }) => posix(file))).not.toEqual([]);
  });

  it("uses the shared Dialog from components/ui", () => {
    const importers = allImports().filter(
      ({ statement }) =>
        /(^|\/)components\/ui\/Dialog(\.tsx?)?$/.test(statement.specifier) &&
        statement.names.includes("Dialog"),
    );

    expect(importers.map(({ file }) => posix(file))).not.toEqual([]);
  });

  it("takes nothing from features/feed but PostNode and api", () => {
    const offenders = allImports()
      .filter(
        ({ statement }) =>
          featureOf(statement.specifier) === "feed" &&
          !["PostNode", "api"].includes(moduleName(statement.specifier)),
      )
      .map(
        ({ file, statement }) =>
          `${posix(file)} imports ${statement.specifier}`,
      );

    expect(offenders).toEqual([]);
  });

  it("takes nothing from features/compose but InlineComposer", () => {
    const offenders = allImports()
      .filter(
        ({ statement }) =>
          featureOf(statement.specifier) === "compose" &&
          moduleName(statement.specifier) !== "InlineComposer",
      )
      .map(
        ({ file, statement }) =>
          `${posix(file)} imports ${statement.specifier}`,
      );

    expect(offenders).toEqual([]);
  });

  it("imports no other feature", () => {
    const offenders = allImports()
      .filter(({ statement }) => {
        const feature = featureOf(statement.specifier);
        return (
          feature !== null &&
          (OTHER_FEATURES as readonly string[]).includes(feature)
        );
      })
      .map(
        ({ file, statement }) =>
          `${posix(file)} imports ${statement.specifier}`,
      );

    expect(offenders).toEqual([]);
  });

  it("knows which feature a specifier reaches into (guards the absences above)", () => {
    expect(featureOf("../feed/PostNode")).toBe("feed");
    expect(featureOf("../compose/ComposeTextBox")).toBe("compose");
    expect(featureOf("../../features/profile/api")).toBe("profile");
    expect(featureOf("../../components/ui/Dialog")).toBeNull();
    expect(featureOf("./ThreadModal.module.css")).toBeNull();
  });
});

describe("no raw HTML", () => {
  it("never sets inner HTML from a thread source", () => {
    const needle = ["dangerously", "Set", "Inner", "HTML"].join("");
    const offenders = threadSources()
      .filter((file) => read(file).includes(needle))
      .map(posix);

    expect(offenders).toEqual([]);
  });
});
