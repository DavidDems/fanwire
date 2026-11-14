/**
 * FRONTEND-044: the Schedule page is lazy-loaded like the other pages, and
 * the entry chunk grows only by the route and the nav item.
 *
 * The same structural reading as `lazy-routes.test.ts` (a file of its own, so
 * that one's list stays as it is): a module is in the main chunk when
 * `src/main.tsx` reaches it through static imports alone. So:
 *
 * - `features/schedule/SchedulePage.tsx` is on disk, unreachable from the
 *   entry without an `import()`, and some module under `routes/` imports it
 *   dynamically.
 * - The schedule client (`api/schedule.ts`) and the shared game card
 *   (`features/games/GameCard.tsx`) stay out of the entry too: Recent Games
 *   is already lazy (the home rail), and the page is.
 * - **One shared card.** Both `features/games/RecentGames.tsx` and the
 *   Schedule page reach `GameCard.tsx` by static imports: the card is one
 *   component both render. (What it renders is `SchedulePage.test.tsx`'s.)
 *
 * The exact bytes are the bundle-budget test's.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR } from "../test/css";

const SCHEDULE_PAGE = "features/schedule/SchedulePage.tsx";
const SCHEDULE_CLIENT = "api/schedule.ts";
const GAME_CARD = "features/games/GameCard.tsx";
const RECENT_GAMES = "features/games/RecentGames.tsx";
const ENTRY = "main.tsx";
const SOURCE_EXTENSIONS = [".tsx", ".ts"];

function read(file: string): string {
  return readFileSync(file, "utf8");
}

function absolute(path: string): string {
  return join(SRC_DIR, ...path.split("/"));
}

function posix(file: string): string {
  return relative(SRC_DIR, file).split(sep).join("/");
}

/** Comments out, so a commented-out import is not an edge; a URL's `//` survives. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

/** Static, non-type-only `import … from`, bare `import "…"` and `export … from`. */
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

function dynamicSpecifiers(source: string): string[] {
  return [
    ...withoutComments(source).matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g),
  ].map((match) => match[1]);
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

function routeModules(): string[] {
  const directory = join(SRC_DIR, "routes");
  return readdirSync(directory)
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => join(directory, name));
}

describe("the Schedule page is its own chunk", () => {
  it.each([SCHEDULE_PAGE, SCHEDULE_CLIENT, GAME_CARD])(
    "finds %s on disk",
    (path) => {
      expect(existsSync(absolute(path)), `${path} must exist`).toBe(true);
    },
  );

  it("the walk reaches well past the entry (not vacuously green)", () => {
    const reachable = staticallyReachable(absolute(ENTRY));
    expect(reachable.has("routes/routes.tsx")).toBe(true);
    expect(reachable.has("routes/AppLayout.tsx")).toBe(true);
    expect(reachable.size).toBeGreaterThan(20);
  });

  it.each([SCHEDULE_PAGE, SCHEDULE_CLIENT, GAME_CARD])(
    "does not reach %s from the entry without an import()",
    (path) => {
      expect(existsSync(absolute(path)), `${path} must exist`).toBe(true);
      const reachable = staticallyReachable(absolute(ENTRY));
      expect(
        reachable.has(path),
        `${path} is statically reachable from src/${ENTRY}, so it is in the main chunk`,
      ).toBe(false);
    },
  );

  it("loads SchedulePage with import() from routes/", () => {
    const importers = routeModules().filter((file) =>
      dynamicSpecifiers(read(file)).some(
        (specifier) =>
          resolveSource(file, specifier) === absolute(SCHEDULE_PAGE),
      ),
    );

    expect(
      importers.map(posix),
      `nothing in routes/ lazy-loads ${SCHEDULE_PAGE}`,
    ).not.toEqual([]);
  });
});

describe("one shared game card", () => {
  it.each([RECENT_GAMES, SCHEDULE_PAGE])(
    "%s renders features/games/GameCard.tsx (a static import)",
    (from) => {
      expect(existsSync(absolute(from)), `${from} must exist`).toBe(true);
      expect(
        staticallyReachable(absolute(from)).has(GAME_CARD),
        `${from} does not reach ${GAME_CARD}`,
      ).toBe(true);
    },
  );
});
