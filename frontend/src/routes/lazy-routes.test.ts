/**
 * FRONTEND-015 criteria 8 and 9, pinned structurally: the bundle is split by
 * route.
 *
 * Vite puts a module in the main chunk when the entry reaches it through a
 * static import, and in a chunk of its own when the only way to it is a
 * dynamic `import()`. So "the stats, games, players, compose, notifications,
 * profile and auth pages are lazy" is a property of the static import graph
 * from `src/main.tsx`, and that graph is what is walked here: none of those
 * pages may be reachable from the entry without crossing an `import()`, and
 * the feed, the thread modal and the shell must be. Reading `routes.tsx` alone
 * would pass while `details.tsx` (the game and player modal details) still
 * pulled `GamePage` into the main chunk.
 *
 * Whether the build then prints no chunk-size warning is `npm run build`'s,
 * and the network-panel row is the browser checklist's; neither is visible
 * to jsdom. The behaviour that has to survive the split (a direct load is
 * still the full page, the modal keeps its one dialog) is pinned through the
 * real route table by `routes.test.tsx`, `detail-flow.test.tsx` and
 * `modal-flow.test.tsx`, which already wait for every page with `findBy…`.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR } from "../test/css";

/** The pages that must each load as their own chunk, by path under `src/`. */
const LAZY_PAGES = [
  "features/stats/StatsPage.tsx",
  "features/stats/SeasonsTab.tsx",
  // FRONTEND-019: the Records tab, a lazy child route of its own.
  "features/stats/RecordsTab.tsx",
  "features/stats/PlayersTab.tsx",
  "features/games/GamePage.tsx",
  "features/players/PlayerPage.tsx",
  "features/compose/ComposePage.tsx",
  "features/notifications/NotificationsPage.tsx",
  "features/profile/ProfilePage.tsx",
  "auth/SignInPage.tsx",
  "auth/SignUpPage.tsx",
  "auth/ConfirmPage.tsx",
  "auth/ForgotPasswordPage.tsx",
  "auth/ProfileSetupPage.tsx",
] as const;

/** What stays in the main chunk: the first paint and the modal's own detail. */
const EAGER = [
  "routes/AppLayout.tsx",
  "routes/BackgroundRoutes.tsx",
  "features/feed/FeedPage.tsx",
  "features/thread/ThreadModal.tsx",
  "features/thread/DetailModal.tsx",
] as const;

const ENTRY = "main.tsx";
const SOURCE_EXTENSIONS = [".tsx", ".ts"];

function read(file: string): string {
  return readFileSync(file, "utf8");
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

/**
 * The specifiers a module imports *statically*: `import … from`, a bare
 * `import "…"`, and `export … from`. A type-only import is erased by the
 * compiler and is no edge in the bundle; a dynamic `import("…")` is the split
 * point itself, so neither is returned.
 */
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

/** The specifiers a module imports dynamically, with `import("…")`. */
function dynamicSpecifiers(source: string): string[] {
  return [
    ...withoutComments(source).matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g),
  ].map((match) => match[1]);
}

/** A relative specifier as the source file it names, or `null` (a package, CSS, an asset). */
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

/** Every source module the entry reaches through static imports alone. */
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

const reachable = staticallyReachable(join(SRC_DIR, ENTRY));

/** Every non-test source module directly under `routes/`. */
function routeModules(): string[] {
  const directory = join(SRC_DIR, "routes");
  return readdirSync(directory)
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => join(directory, name));
}

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
    expect(reachable.size).toBeGreaterThan(20);
  });

  it.each(LAZY_PAGES)("finds %s on disk", (page) => {
    expect(existsSync(join(SRC_DIR, ...page.split("/")))).toBe(true);
  });
});

describe("the feed, the thread modal and the shell stay in the main chunk", () => {
  it.each(EAGER)("reaches %s from the entry by static imports", (module) => {
    expect(reachable.has(module), `${module} must be eager`).toBe(true);
  });
});

describe("every other page loads as its own chunk (React.lazy)", () => {
  it.each(LAZY_PAGES)(
    "does not reach %s from the entry without an import()",
    (page) => {
      expect(
        reachable.has(page),
        `${page} is statically reachable from src/${ENTRY}, so it is in the main chunk`,
      ).toBe(false);
    },
  );

  it.each(LAZY_PAGES)("loads %s with import() from routes/", (page) => {
    // FRONTEND-020: any module under routes/ (the compose overlay may live in
    // its own, ComposeModal.tsx), not only routes.tsx and details.tsx.
    const importers = routeModules().filter((file) =>
      dynamicSpecifiers(read(file)).some(
        (specifier) =>
          resolveSource(file, specifier) === join(SRC_DIR, ...page.split("/")),
      ),
    );

    expect(
      importers.map(posix),
      `nothing in routes/ lazy-loads ${page}`,
    ).not.toEqual([]);
  });

  it("builds the lazy pages with React.lazy in routes.tsx", () => {
    const source = withoutComments(read(join(SRC_DIR, "routes", "routes.tsx")));

    expect(source).toMatch(
      /import\s*\{[^}]*\blazy\b[^}]*\}\s*from\s*["']react["']/,
    );
    expect(source).toMatch(/\blazy\s*\(/);
  });
});

describe("one Suspense for the pages, one inside the modal", () => {
  it("wraps the page in BackgroundRoutes in a Suspense whose fallback is StatusLine", () => {
    const source = withoutComments(
      read(join(SRC_DIR, "routes", "BackgroundRoutes.tsx")),
    );

    expect(source).toMatch(/<Suspense\b/);
    expect(source).toMatch(/fallback\s*=\s*\{\s*<StatusLine\b/);
    expect(
      staticSpecifiers(source).some((specifier) =>
        /components\/ui\/StatusLine$/.test(specifier),
      ),
    ).toBe(true);
  });

  it("puts a Suspense inside DetailModal, so a lazy detail never unmounts the dialog", () => {
    const source = withoutComments(
      read(join(SRC_DIR, "features", "thread", "DetailModal.tsx")),
    );

    expect(source).toMatch(/<Suspense\b/);
  });
});

describe("the compose dialog waits for its own chunk (FRONTEND-020)", () => {
  const COMPOSE_PAGE = join(SRC_DIR, "features", "compose", "ComposePage.tsx");

  /** The routes/ modules that lazy-load the composer. */
  function composeImporters(): string[] {
    return routeModules().filter((file) =>
      dynamicSpecifiers(read(file)).some(
        (specifier) => resolveSource(file, specifier) === COMPOSE_PAGE,
      ),
    );
  }

  it("lazy-loads the composer from routes/ and renders it inside a Dialog titled Compose", () => {
    const importers = composeImporters();
    expect(importers.map(posix), "nothing lazy-loads ComposePage").not.toEqual(
      [],
    );

    const dialogs = routeModules().filter((file) =>
      /<Dialog\b[^>]*\btitle\s*=\s*(["'])Compose\1/.test(
        withoutComments(read(file)),
      ),
    );
    expect(
      dialogs.map(posix),
      'one routes/ module renders <Dialog title="Compose">',
    ).toHaveLength(1);
  });

  it("handles a failed composer import inside its Dialog without React.lazy caching the failure", () => {
    const [file] = routeModules().filter((candidate) =>
      /<Dialog\b[^>]*\btitle\s*=\s*(["'])Compose\1/.test(
        withoutComments(read(candidate)),
      ),
    );
    expect(file, "no routes/ module renders the compose Dialog").toBeDefined();
    const source = withoutComments(read(file));
    const dialog = source.slice(source.search(/<Dialog\b/));
    const body = dialog.slice(0, dialog.indexOf("</Dialog>"));

    expect(source).not.toMatch(/\blazy\s*\(/);
    expect(source).toContain(
      "We could not open this just now. Please try again.",
    );
    expect(body).toMatch(/Try again|<[^>]*[Rr]etry/);
    expect(source).toMatch(/\.catch\s*\(|catch\s*\(/);
  });
});
