/**
 * FRONTEND-009 criterion 10, pinned from disk: the Search page searches
 * accounts and posts only. The sports-data filter has moved to the Stats page,
 * so:
 *
 * - `features/search/GameFilter.tsx` no longer exists;
 * - **no file under `src/`**, source or test, imports `GameFilter` (its test
 *   file and the search half of FRONTEND-008's game links go with it);
 * - the `GET /search/games` and `GET /search/games/filters` client code that
 *   only the filter used is gone from `features/search/`. The backend routes
 *   stay ([[0x07-search]]): only the UI moves.
 *
 * The behavioural half (no "Games" region on `/search`) is in
 * `SearchPage.test.tsx` and `routes/home-search.test.tsx`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR } from "../../test/css";

const SEARCH_DIR = join(SRC_DIR, "features", "search");
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

function posix(file: string): string {
  return relative(SRC_DIR, file).split(sep).join("/");
}

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

function importSpecifiers(source: string): string[] {
  const stripped = withoutComments(source);
  const specifiers: string[] = [];
  for (const pattern of [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']/g,
  ]) {
    for (const match of stripped.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

const FILTER = ["Game", "Filter"].join("");

describe("the sports-data filter has left the Search page", () => {
  it(`features/search/${FILTER}.tsx is gone`, () => {
    expect(existsSync(join(SEARCH_DIR, `${FILTER}.tsx`))).toBe(false);
  });

  it(`no file under src/ imports ${FILTER}`, () => {
    const files = sourceFiles(SRC_DIR);
    const offenders = files.filter((file) =>
      importSpecifiers(readFileSync(file, "utf8")).some(
        (specifier) =>
          (specifier.split("/").pop() ?? "").replace(/\.[cm]?[jt]sx?$/, "") ===
          FILTER,
      ),
    );

    expect(files.length, "no sources found under src/").toBeGreaterThan(50);
    expect(offenders.map(posix)).toEqual([]);
  });

  it("the search client no longer reads GET /search/games or its filters", () => {
    const offenders = sourceFiles(SEARCH_DIR)
      .filter((file) => !/\.test\.[cm]?[jt]sx?$/.test(file))
      .filter((file) =>
        /["'`]\/search\/games/.test(withoutComments(readFileSync(file, "utf8"))),
      )
      .map(posix);

    expect(offenders).toEqual([]);
  });

  it("finds an import of the filter when there is one", () => {
    // Guards the sweep above against a parser that matches nothing.
    expect(
      importSpecifiers(`import { ${FILTER} } from "./${FILTER}";`).map(
        (s) => s.split("/").pop(),
      ),
    ).toEqual([FILTER]);
  });
});
