/**
 * FRONTEND-018, Baseline (b), and the router-agnostic criterion, pinned
 * structurally from disk.
 *
 * - **Lazy.** Nothing under `components/stats-nav/`, and not `api/stats.ts`
 *   or `api/records.ts` (FRONTEND-019), is reachable from the entry
 *   (`src/main.tsx`) by static imports alone, so
 *   the navigator and the stats reads load with the lazy Stats page and never
 *   in the main chunk. The walk is a copy of `routes/lazy-routes.test.ts`'s
 *   (FRONTEND-020 owns that file in this stage), guarded against passing
 *   vacuously: it must reach well past the entry, and the modules it must not
 *   reach must exist.
 * - **Router-agnostic.** No file under `components/stats-nav/` imports
 *   `react-router-dom`, or anything under `features/` but
 *   `features/games/format` (the one shared formatter), so the compose picker
 *   (FRONTEND-021) can drive the navigator from state.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR } from "../../test/css";

const ENTRY = "main.tsx";
const NAV_DIR = join(SRC_DIR, "components", "stats-nav");
const SOURCE_EXTENSIONS = [".tsx", ".ts"];

function read(file: string): string {
  return readFileSync(file, "utf8");
}

function posix(file: string): string {
  return relative(SRC_DIR, file).split(sep).join("/");
}

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

/** Static edges only: `import … from`, bare `import "…"`, `export … from`; not `import type`. */
function staticSpecifiers(source: string): string[] {
  const code = withoutComments(source);
  const found: string[] = [];
  const fromClause =
    /\b(import|export)\s+(?!\()(type\s+)?([^;'"]*?)\bfrom\s*["']([^"']+)["']/g;
  for (const match of code.matchAll(fromClause)) {
    if (match[2] === undefined) found.push(match[4]);
  }
  for (const match of code.matchAll(/\bimport\s*["']([^"']+)["']/g)) {
    found.push(match[1]);
  }
  return found;
}

/** Every specifier, static, type-only or dynamic: what a file depends on at all. */
function allSpecifiers(source: string): string[] {
  const code = withoutComments(source);
  const found: string[] = [];
  for (const pattern of [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']/g,
  ]) {
    for (const match of code.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

function resolveSource(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(from), specifier);
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => base + extension),
    ...SOURCE_EXTENSIONS.map((extension) => join(base, `index${extension}`)),
  ];
  return (
    candidates.find(
      (candidate) =>
        SOURCE_EXTENSIONS.some((extension) => candidate.endsWith(extension)) &&
        existsSync(candidate),
    ) ?? null
  );
}

function staticallyReachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of staticSpecifiers(read(file))) {
      const target = resolveSource(file, specifier);
      if (target !== null && !seen.has(target)) queue.push(target);
    }
  }
  return new Set([...seen].map(posix));
}

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (/\.[cm]?[jt]sx?$/.test(entry)) found.push(full);
  }
  return found;
}

function isTest(file: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/.test(file);
}

const reachable = staticallyReachable(join(SRC_DIR, ENTRY));

describe("the import walk reads a real graph", () => {
  it("parses static and type-only imports apart, and skips import()", () => {
    expect(
      staticSpecifiers(
        [
          'import { a } from "./a";',
          'import type { B } from "./b";',
          'import "./c.css";',
          'export { d } from "./d";',
          'const E = lazy(() => import("./e"));',
          '// import { f } from "./f";',
        ].join("\n"),
      ),
    ).toEqual(["./a", "./d", "./c.css"]);
  });

  it("reaches well past the entry (not vacuously green)", () => {
    expect(reachable.has(ENTRY)).toBe(true);
    expect(reachable.has("App.tsx")).toBe(true);
    expect(reachable.has("routes/routes.tsx")).toBe(true);
    expect(reachable.has("features/feed/FeedPage.tsx")).toBe(true);
    expect(reachable.has("api/client.ts")).toBe(true);
    expect(reachable.size).toBeGreaterThan(20);
  });

  it("has a navigator, api/stats.ts and api/records.ts on disk to look for", () => {
    expect(existsSync(join(NAV_DIR, "StatsNavigator.tsx"))).toBe(true);
    expect(existsSync(join(SRC_DIR, "api", "stats.ts"))).toBe(true);
    expect(existsSync(join(SRC_DIR, "api", "records.ts"))).toBe(true);
    expect(
      sourceFiles(NAV_DIR).filter((file) => !isTest(file)).length,
    ).toBeGreaterThan(0);
  });
});

describe("the navigator and the stats reads stay out of the main chunk", () => {
  it("does not reach api/stats.ts from the entry without an import()", () => {
    expect(
      reachable.has("api/stats.ts"),
      `api/stats.ts is statically reachable from src/${ENTRY}, so it is in the main chunk`,
    ).toBe(false);
  });

  // FRONTEND-019, Baseline (b): the records reads load with the Records tab.
  it("does not reach api/records.ts from the entry without an import()", () => {
    expect(existsSync(join(SRC_DIR, "api", "records.ts"))).toBe(true);
    expect(
      reachable.has("api/records.ts"),
      `api/records.ts is statically reachable from src/${ENTRY}, so it is in the main chunk`,
    ).toBe(false);
  });

  it("does not reach any module under components/stats-nav/ from the entry", () => {
    const shipped = sourceFiles(NAV_DIR)
      .filter((file) => !isTest(file))
      .map(posix);

    expect(shipped.length).toBeGreaterThan(0);
    expect(shipped.filter((module) => reachable.has(module))).toEqual([]);
  });
});

describe("the navigator is router-agnostic", () => {
  function offenders(
    test: (specifier: string, file: string) => boolean,
  ): string[] {
    const found: string[] = [];
    for (const file of sourceFiles(NAV_DIR)) {
      for (const specifier of allSpecifiers(read(file))) {
        if (test(specifier, file))
          found.push(`${posix(file)} imports ${specifier}`);
      }
    }
    return found;
  }

  function featurePath(specifier: string, file: string): string | null {
    if (!specifier.startsWith(".")) {
      const match = /(^|\/)(features\/.+)$/.exec(specifier);
      return match === null ? null : match[2];
    }
    const inside = relative(SRC_DIR, resolve(dirname(file), specifier))
      .split(sep)
      .join("/");
    return inside.startsWith("features/") ? inside : null;
  }

  it("has files to scan (not vacuously green)", () => {
    expect(
      sourceFiles(NAV_DIR).filter((file) => !isTest(file)).length,
    ).toBeGreaterThan(0);
  });

  it("no file under components/stats-nav/ imports react-router-dom", () => {
    expect(
      offenders(
        (specifier) =>
          specifier === "react-router" || specifier.startsWith("react-router"),
      ),
    ).toEqual([]);
  });

  it("imports nothing under features/ but features/games/format", () => {
    expect(
      offenders((specifier, file) => {
        const target = featurePath(specifier, file);
        return (
          target !== null &&
          target.replace(/\.[cm]?[jt]sx?$/, "") !== "features/games/format"
        );
      }),
    ).toEqual([]);
  });

  it("resolves a features/ import when there is one", () => {
    const from = join(NAV_DIR, "StatsNavigator.tsx");
    expect(featurePath("../../features/games/format", from)).toBe(
      "features/games/format",
    );
    expect(featurePath("../../features/stats/links", from)).toBe(
      "features/stats/links",
    );
    expect(featurePath("../ui/Button", from)).toBeNull();
  });
});

describe("FRONTEND-021 chunk boundaries", () => {
  const compose = "features/compose/ComposePage.tsx";
  const picker = "features/compose/StatsPicker.tsx";
  const records = ["RecordsLevel.tsx", "RecordLevel.tsx", "recordLabels.ts"];
  it("opening compose reaches the stats read module but no navigator or picker code", () => {
    const graph = staticallyReachable(join(SRC_DIR, compose));
    expect(graph.has("api/stats.ts")).toBe(true);
    expect(
      [...graph].filter((name) => name.startsWith("components/stats-nav/")),
    ).toEqual([]);
    expect(graph.has(picker)).toBe(false);
    const files = sourceFiles(join(SRC_DIR, "features", "compose")).filter(
      (file) => !isTest(file),
    );
    expect(
      files.some((file) =>
        /import\s*\(\s*["'][^"']*StatsPicker["']/.test(read(file)),
      ),
    ).toBe(true);
  });
  it("picker reaches navigator and shared player results but no records views or reads", () => {
    expect(existsSync(join(SRC_DIR, picker))).toBe(true);
    const graph = staticallyReachable(join(SRC_DIR, picker));
    expect(graph.has("components/stats-nav/StatsNavigator.tsx")).toBe(true);
    expect(graph.has("components/stats-nav/PlayerResults.tsx")).toBe(true);
    expect(graph.has("api/records.ts")).toBe(false);
    expect(
      [...graph].filter((name) =>
        records.some((file) => name.endsWith("/" + file)),
      ),
    ).toEqual([]);
    expect(
      [...graph].some((name) => name.startsWith("features/compose/")),
    ).toBe(true);
  });
  it("the records tab owns the records views through LevelViews injection", () => {
    const graph = staticallyReachable(
      join(SRC_DIR, "features/stats/RecordsTab.tsx"),
    );
    for (const file of records)
      expect([...graph].some((name) => name.endsWith("/" + file))).toBe(true);
    const source = read(join(NAV_DIR, "StatsNavigator.tsx"));
    expect(source).toMatch(/\bLevelViews\b/);
    expect(source).not.toMatch(
      /import[^;]*from\s*["'][^"']*(?:RecordLevel|RecordsLevel|recordLabels)["']/,
    );
  });
  it("attachment address checks use shared reads instead of defining fetchers", () => {
    const source = withoutComments(
      read(join(SRC_DIR, "features/compose/attachmentReads.ts")),
    );
    expect(source).not.toMatch(/apiClient|\bfetch\s*\(/);
    expect(source).toContain("fetchGameDetail");
    expect(source).toContain("fetchPlayerDetail");
    for (const file of ["stats.ts", "records.ts"]) {
      const api = withoutComments(read(join(SRC_DIR, "api", file)));
      expect(api).toMatch(/from\s*["']\.\/ok["']/);
      expect(api).not.toMatch(/function\s+ok\b/);
    }
  });
});
