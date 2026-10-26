/**
 * FRONTEND-009, pinned structurally — what the code *is*, which a behavioural
 * test cannot fully see (brief, "Two feature folders", "Tabs are routes",
 * "Number formats").
 *
 * - **Two feature folders.** `features/stats/` holds `StatsPage.tsx` (the
 *   heading, the tab list and the tab outlet), `SeasonsTab.tsx` and
 *   `PlayersTab.tsx`; `features/players/` holds `PlayerPage.tsx`. The route
 *   table names all four.
 * - **Reached by address, never by import.** Neither folder imports another
 *   feature (not even each other), with one exception: the game page's
 *   formatting module, `features/games/format`, which both use, so a figure
 *   reads the same on every page.
 * - **The shared layers.** The tab list is the shared `Tabs` from
 *   `components/ui/`; HTTP goes through `api/`; a failure is the shared
 *   `InlineAlert`.
 * - **No raw HTML.**
 * - **FRONTEND-018's layout.** The stats reads live in `api/stats.ts`
 *   (`features/stats/api.ts` is gone), and the navigator in
 *   `components/stats-nav/`, which `features/stats/` uses: `SeasonsTab`
 *   renders `StatsNavigator` and `PlayersTab` renders `PlayerResults`. The
 *   stats feature is `features/stats/` and `components/stats-nav/` together
 *   for the "formats through games/format" and "shows a failure with
 *   InlineAlert" sweeps, since the views moved into the navigator. Nothing
 *   under `components/` imports `features/`, except `features/games/format`.
 *
 * Every sweep is guarded against passing vacuously. Comments are stripped
 * first: stripping can only hide a match, never invent one.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR } from "../../test/css";

const FEATURES_DIR = join(SRC_DIR, "features");
const STATS_DIR = join(FEATURES_DIR, "stats");
const PLAYERS_DIR = join(FEATURES_DIR, "players");
const COMPONENTS_DIR = join(SRC_DIR, "components");
const STATS_NAV_DIR = join(COMPONENTS_DIR, "stats-nav");

const MODULES: [string, string][] = [
  ["stats", "StatsPage.tsx"],
  ["stats", "SeasonsTab.tsx"],
  // FRONTEND-019: the Records tab.
  ["stats", "RecordsTab.tsx"],
  ["stats", "PlayersTab.tsx"],
  ["players", "PlayerPage.tsx"],
];

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

function moduleName(specifier: string): string {
  const last = specifier.split("/").pop() ?? specifier;
  return last.replace(/\.[cm]?[jt]sx?$/, "");
}

/** The feature folder a specifier imported from `file` lands in, or `null`. */
function featureOf(file: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) {
    const match = /(^|\/)features\/([^/]+)/.exec(specifier);
    return match === null ? null : match[2];
  }
  const resolved = join(file, "..", ...specifier.split("/"));
  const inside = relative(FEATURES_DIR, resolved);
  if (inside.startsWith("..") || inside.includes(":")) return null;
  return inside.split(sep)[0] ?? null;
}

const FOLDERS: [string, string][] = [
  ["stats", STATS_DIR],
  ["players", PLAYERS_DIR],
];

/** A feature's shipped files, with the navigator counted as the stats feature's. */
function featureFiles(directory: string): string[] {
  return directory === STATS_DIR
    ? [...shipped(STATS_DIR), ...shipped(STATS_NAV_DIR)]
    : shipped(directory);
}

describe("the modules exist where the brief names them", () => {
  it.each(MODULES)("features/%s has %s", (folder, module) => {
    expect(
      existsSync(join(FEATURES_DIR, folder, module)),
      `${module} must live in features/${folder}/`,
    ).toBe(true);
  });

  it.each(FOLDERS)("features/%s holds non-empty source", (_name, directory) => {
    const sources = shipped(directory);

    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      expect(
        withoutComments(read(file)).trim().length,
        posix(file),
      ).toBeGreaterThan(0);
      if (file.endsWith(".tsx"))
        expect(
          importSpecifiers(read(file)).length,
          posix(file),
        ).toBeGreaterThan(0);
    }
  });

  it("is wired into the route table", () => {
    const routes = join(SRC_DIR, "routes", "routes.tsx");
    const named = importSpecifiers(read(routes)).map(moduleName);

    for (const [, module] of MODULES) {
      expect(named, `routes.tsx does not import ${module}`).toContain(
        module.replace(/\.tsx$/, ""),
      );
    }
  });
});

describe("reached by address, never by import", () => {
  it.each(FOLDERS)(
    "features/%s imports no other feature but games/format",
    (name, directory) => {
      const offenders: string[] = [];
      for (const file of shipped(directory)) {
        for (const specifier of importSpecifiers(read(file))) {
          const feature = featureOf(file, specifier);
          if (feature === null || feature === name) continue;
          const allowed =
            feature === "games" && moduleName(specifier) === "format";
          if (!allowed) offenders.push(`${posix(file)} imports ${specifier}`);
        }
      }

      expect(offenders).toEqual([]);
    },
  );

  it.each(FOLDERS)(
    "features/%s formats its figures through games/format",
    (_name, directory) => {
      const users = featureFiles(directory).filter((file) =>
        importSpecifiers(read(file)).some(
          (specifier) =>
            featureOf(file, specifier) === "games" &&
            moduleName(specifier) === "format",
        ),
      );

      expect(users.map(posix)).not.toEqual([]);
    },
  );

  it("resolves a cross-feature import when there is one", () => {
    // Guards the sweeps above against a resolver that matches nothing.
    const fromStats = join(STATS_DIR, "SeasonsTab.tsx");

    expect(featureOf(fromStats, "../games/format")).toBe("games");
    expect(featureOf(fromStats, "../players/PlayerPage")).toBe("players");
    expect(featureOf(fromStats, "./api")).toBe("stats");
    expect(featureOf(fromStats, "../../components/ui/Tabs")).toBeNull();
  });
});

describe("the shared layers", () => {
  function importsFromUi(directory: string, component: string): string[] {
    return featureFiles(directory)
      .filter((file) =>
        importSpecifiers(read(file)).some(
          (specifier) =>
            /(^|\/)components\/ui\//.test(specifier) &&
            moduleName(specifier) === component,
        ),
      )
      .map(posix);
  }

  it("the Stats page's tab list is components/ui/Tabs", () => {
    expect(importsFromUi(STATS_DIR, "Tabs")).not.toEqual([]);
  });

  it.each(FOLDERS)(
    "features/%s shows a failure with InlineAlert",
    (_name, directory) => {
      expect(importsFromUi(directory, "InlineAlert")).not.toEqual([]);
    },
  );

  it("features/players fetches through api/", () => {
    const fetchers = shipped(PLAYERS_DIR).filter((file) =>
      importSpecifiers(read(file)).some((specifier) =>
        /(^|\/)api\/client$/.test(specifier),
      ),
    );

    expect(fetchers.map(posix)).not.toEqual([]);
  });

  it("the stats feature reads through api/stats.ts, and features/stats/api.ts is gone", () => {
    expect(existsSync(join(SRC_DIR, "api", "stats.ts"))).toBe(true);
    expect(existsSync(join(STATS_DIR, "api.ts"))).toBe(false);
    const readers = featureFiles(STATS_DIR).filter((file) =>
      importSpecifiers(read(file)).some((specifier) =>
        /(^|\/)api\/stats$/.test(specifier),
      ),
    );

    expect(readers.map(posix)).not.toEqual([]);
  });

  it("api/stats.ts fetches through api/client", () => {
    const file = join(SRC_DIR, "api", "stats.ts");
    expect(existsSync(file)).toBe(true);
    expect(importSpecifiers(read(file))).toContain("./client");
  });
});

describe("the navigator's place (FRONTEND-018)", () => {
  function importers(directory: string, pattern: RegExp): string[] {
    return shipped(directory)
      .filter((file) =>
        importSpecifiers(read(file)).some((specifier) =>
          pattern.test(specifier),
        ),
      )
      .map(posix);
  }

  it("SeasonsTab renders StatsNavigator from components/stats-nav/", () => {
    expect(
      importers(STATS_DIR, /(^|\/)components\/stats-nav\/StatsNavigator$/),
    ).toContain("features/stats/SeasonsTab.tsx");
  });

  // FRONTEND-019: the record levels are the navigator's, and RecordsTab is
  // their route adapter.
  it("RecordsTab renders StatsNavigator from components/stats-nav/", () => {
    expect(
      importers(STATS_DIR, /(^|\/)components\/stats-nav\/StatsNavigator$/),
    ).toContain("features/stats/RecordsTab.tsx");
  });

  it("the records reads live in api/records.ts, which fetches through api/client", () => {
    const file = join(SRC_DIR, "api", "records.ts");
    expect(existsSync(file)).toBe(true);
    expect(importSpecifiers(read(file))).toContain("./client");
    expect(
      [...shipped(STATS_DIR), ...shipped(STATS_NAV_DIR)]
        .filter((source) =>
          importSpecifiers(read(source)).some((specifier) =>
            /(^|\/)api\/records$/.test(specifier),
          ),
        )
        .map(posix),
    ).not.toEqual([]);
  });

  it("PlayersTab renders the navigator's PlayerResults view", () => {
    expect(
      importers(STATS_DIR, /(^|\/)components\/stats-nav\/PlayerResults$/),
    ).toContain("features/stats/PlayersTab.tsx");
  });

  it("nothing under components/ imports features/, but features/games/format", () => {
    const sources = shipped(COMPONENTS_DIR);
    expect(sources.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of sources) {
      for (const specifier of importSpecifiers(read(file))) {
        const resolved = specifier.startsWith(".")
          ? relative(SRC_DIR, join(file, "..", ...specifier.split("/")))
              .split(sep)
              .join("/")
          : specifier;
        const match = /(^|\/)features\/(.+)$/.exec(resolved);
        if (match === null) continue;
        const target = match[2].replace(/\.[cm]?[jt]sx?$/, "");
        if (target !== "games/format")
          offenders.push(`${posix(file)} imports ${specifier}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("no raw HTML", () => {
  const needle = ["dangerously", "Set", "Inner", "HTML"].join("");

  it.each(FOLDERS)("features/%s never sets inner HTML", (_name, directory) => {
    // featureFiles: the stats views now live in components/stats-nav/ too.
    const sources = featureFiles(directory);

    expect(sources.length).toBeGreaterThan(0);
    expect(
      sources.filter((file) => read(file).includes(needle)).map(posix),
    ).toEqual([]);
  });
});
