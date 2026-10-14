/**
 * FRONTEND-008, pinned structurally — what the code *is*, which a behavioural
 * test cannot fully see (brief, "Things to get right").
 *
 * - **A new feature folder.** `features/games/` holds the page
 *   (`GamePage.tsx`) and the one formatting module (`format.ts`), and the
 *   page's sources use that module.
 * - **Reached by address, never by import** ([[0x00-architecture]] Connection
 *   rule, `0x08-frontend.md`): no other feature folder imports anything from
 *   `features/games/`, and `features/games/` imports no other feature. The
 *   route table (`routes/`) is the one place that names the page, the way it
 *   names every other feature's page.
 * - **All HTTP through `api/`**, and the failure is the shared `InlineAlert`
 *   from `components/ui/` (a hand-rolled `<p role="alert">` renders the same
 *   role, which is why this is read from disk).
 * - **No raw HTML** in this folder or in `features/feed/` (post text is never
 *   parsed as HTML). The needle is assembled from fragments, so this file does
 *   not match itself.
 *
 * Every sweep is guarded against passing vacuously, the way
 * `features/search/search-isolation.test.ts` does it. Comments are stripped
 * first: stripping can only hide a match, never invent one.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR } from "../../test/css";

const FEATURES_DIR = join(SRC_DIR, "features");
const GAMES_DIR = join(FEATURES_DIR, "games");
const FEED_DIR = join(FEATURES_DIR, "feed");

const MODULES = ["GamePage.tsx", "format.ts"] as const;

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

function shipped(directory: string): string[] {
  return sourceFiles(directory).filter((file) => !isTest(file));
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

/** Every module specifier a file imports from (static, side-effect, dynamic). */
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

/** The last path segment of a specifier, extension dropped. */
function moduleName(specifier: string): string {
  const last = specifier.split("/").pop() ?? specifier;
  return last.replace(/\.[cm]?[jt]sx?$/, "");
}

/** Does `specifier`, imported from `file`, resolve into `features/games/`? */
function reachesGames(file: string, specifier: string): boolean {
  if (!specifier.startsWith("."))
    return /(^|\/)features\/games(\/|$)/.test(specifier);
  const resolved = join(file, "..", ...specifier.split("/"));
  const inside = relative(GAMES_DIR, resolved);
  return inside === "" || (!inside.startsWith("..") && !inside.includes(":"));
}

describe("the games feature's modules exist where the brief names them", () => {
  it.each(MODULES)("has %s", (module) => {
    expect(
      existsSync(join(GAMES_DIR, module)),
      `${module} must live in features/games/`,
    ).toBe(true);
  });

  it("reads source it actually found", () => {
    const sources = shipped(GAMES_DIR);

    expect(sources.length, "features/games has no modules").toBeGreaterThan(0);
    for (const file of sources) {
      expect(
        withoutComments(read(file)).trim().length,
        `${posix(file)} is empty`,
      ).toBeGreaterThan(0);
    }
  });

  it("formats its figures through ./format", () => {
    const users = shipped(GAMES_DIR).filter((file) =>
      importSpecifiers(read(file)).some((specifier) =>
        /^\.\/format(\.[jt]s)?$/.test(specifier),
      ),
    );

    expect(users.map(posix), "no games source imports ./format").not.toEqual(
      [],
    );
  });
});

describe("other features reach the game page by address only", () => {
  it("no other feature folder imports from features/games", () => {
    const others = sourceFiles(FEATURES_DIR)
      .filter((file) => !isTest(file))
      .filter((file) => relative(GAMES_DIR, file).startsWith(".."));
    const offenders: string[] = [];
    for (const file of others) {
      for (const specifier of importSpecifiers(read(file))) {
        if (reachesGames(file, specifier))
          offenders.push(`${posix(file)} imports ${specifier}`);
      }
    }

    expect(others.length, "no other feature sources found").toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it("features/games imports no other feature", () => {
    const sibling =
      /(^|\/)(features\/)?(feed|compose|profile|notifications|search)(\/|$)/;
    const offenders: string[] = [];
    for (const file of shipped(GAMES_DIR)) {
      for (const specifier of importSpecifiers(read(file))) {
        if (sibling.test(specifier))
          offenders.push(`${posix(file)} imports ${specifier}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("detects an import into features/games when there is one", () => {
    // Guards the sweep above against a resolver that matches nothing.
    const fromFeed = join(FEED_DIR, "PostNode.tsx");

    expect(reachesGames(fromFeed, "../games/GamePage")).toBe(true);
    expect(reachesGames(fromFeed, "../../features/games/format")).toBe(true);
    expect(reachesGames(fromFeed, "./api")).toBe(false);
    expect(reachesGames(fromFeed, "../search/api")).toBe(false);
  });

  it("is wired into the route table", () => {
    const routes = join(SRC_DIR, "routes", "routes.tsx");
    const imported = importSpecifiers(read(routes)).filter((specifier) =>
      reachesGames(routes, specifier),
    );

    expect(imported.map(moduleName)).toContain("GamePage");
  });
});

describe("HTTP and failures go through the shared layers", () => {
  it("fetches through api/", () => {
    const fetchers = shipped(GAMES_DIR).filter((file) =>
      importSpecifiers(read(file)).some((specifier) =>
        /(^|\/)api\//.test(specifier),
      ),
    );

    expect(fetchers.map(posix)).not.toEqual([]);
  });

  it("shows a failure with InlineAlert from components/ui", () => {
    const users = shipped(GAMES_DIR).filter((file) =>
      importSpecifiers(read(file)).some(
        (specifier) =>
          /(^|\/)components\/ui\//.test(specifier) &&
          moduleName(specifier) === "InlineAlert",
      ),
    );

    expect(users.map(posix)).not.toEqual([]);
  });

  it("parsed imports out of the sources it checked", () => {
    const sources = shipped(GAMES_DIR).filter((file) => file.endsWith(".tsx"));

    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      expect(
        importSpecifiers(read(file)).length,
        `no imports parsed out of ${posix(file)}`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("no raw HTML", () => {
  const needle = ["dangerously", "Set", "Inner", "HTML"].join("");

  it.each([
    ["features/games", GAMES_DIR],
    ["features/feed", FEED_DIR],
  ])("never sets inner HTML from %s", (_name, directory) => {
    const sources = shipped(directory);
    const offenders = sources
      .filter((file) => read(file).includes(needle))
      .map(posix);

    expect(sources.length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
