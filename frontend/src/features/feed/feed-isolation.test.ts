/**
 * FRONTEND-005 acceptance criteria 2, 3, 8 and 9, pinned structurally.
 *
 * Four of this unit's criteria are about what the code *is*, not about what it
 * renders, and a behavioural test cannot see any of them:
 *
 * - **Criterion 9 — no pinned-post decorator exists anywhere.** An absence is
 *   only assertable by looking. The brief says the criterion is written as an
 *   absence precisely so a test pins it, so this sweeps the whole of `src/`.
 *   Its name is never spelled out in this file, which is itself swept.
 * - **Criterion 2 — no component branches on which ranking strategy the API
 *   chose.** A branch that happens to produce the same output for a test's
 *   fixtures passes every behavioural assertion in `FeedPage.test.tsx`. The
 *   backend picks chronological or personalized and the UI never learns which
 *   ([[0x06-feed]] Ranking strategy), so the vocabulary of that decision has no
 *   place in this unit's code.
 * - **Criterion 3 — one component renders a post and a thread.** A second
 *   component module for threads is the thing the criterion forbids.
 * - **Criterion 8 — the feed reimplements no part of composing.** It reaches the
 *   composer by address (`/compose?reply_to=`), which is the one seam a feature
 *   folder can offer another without being imported by it
 *   ([[0x00-architecture]] Connection rule) — and `features/compose/**` is in
 *   this unit's `forbidden_paths` besides.
 *
 * Same shape, and the same reason, as `src/auth/sdk-isolation.test.ts`,
 * `src/test/env-usage.test.ts` and `src/features/compose/component-isolation.test.ts`:
 * a rule nobody has to remember beats a rule written in the wiki. Every sweep
 * here is guarded against passing vacuously, and the forbidden name is assembled
 * from fragments so that this file does not match itself.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Vitest's `import.meta.url` is not a `file:` URL, so the tree is located from
 * the working directory: `frontend` locally, `/app` in the test container.
 */
function findSrcDir(): string {
  for (const candidate of [join(process.cwd(), "src"), join(process.cwd(), "frontend", "src")]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`cannot locate frontend/src from ${process.cwd()}`);
}

const SRC_DIR = findSrcDir();
const FEED_DIR = join(SRC_DIR, "features", "feed");

/** The three modules this unit's decisions name. */
const MODULES = ["FeedPage.tsx", "PostNode.tsx", "LiveScoreTickerDecorator.tsx"] as const;

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"];
const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "coverage", ".vite"]);

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry)) found.push(...sourceFiles(full));
      continue;
    }
    if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) found.push(full);
  }
  return found;
}

function posix(file: string): string {
  return relative(SRC_DIR, file).split(sep).join("/");
}

function isTest(file: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/.test(file);
}

/** The feed unit's own modules, tests excluded — the code that ships. */
function feedSources(): string[] {
  if (!existsSync(FEED_DIR)) {
    throw new Error(`${posix(FEED_DIR)} does not exist — the feed unit has no modules yet`);
  }
  return sourceFiles(FEED_DIR).filter((file) => !isTest(file));
}

function read(file: string): string {
  return readFileSync(file, "utf8");
}

/**
 * The source with its comments removed.
 *
 * This codebase explains *why* in prose, and the reasons here are worth writing
 * down — "the backend chose the ranking, this component never asks which" is a
 * comment a good implementation would carry, and it would otherwise trip the
 * sweep below. Stripping text can only ever hide a match, never invent one, so
 * an over-eager strip costs a false negative and never a false accusation.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

/** Every module specifier a file imports from, in source order. */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
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

describe("the feed unit's modules exist where its decisions name them", () => {
  it.each(MODULES)("has %s", (module) => {
    expect(
      existsSync(join(FEED_DIR, module)),
      `${module} must live in features/feed/`,
    ).toBe(true);
  });
});

describe("no pinned-post decorator is built", () => {
  // Assembled from fragments so this file is not itself an occurrence. No
  // backend field marks a post as pinned ([[0x03-posts]] has no such column), so
  // the decorator would decorate a condition that cannot occur — YAGNI, and the
  // reason the criterion is an absence.
  const FORBIDDEN = ["Pinned", "Post", "Decorator"].join("");

  it("names it in no module under src", () => {
    const offenders = sourceFiles(SRC_DIR)
      .filter((file) => read(file).includes(FORBIDDEN))
      .map(posix)
      .sort();

    expect(
      offenders,
      "the one decorator this unit builds is LiveScoreTickerDecorator; a pinned-post decorator has no condition to decorate",
    ).toEqual([]);
  });

  it("has no module file named for it", () => {
    const offenders = sourceFiles(SRC_DIR)
      .filter((file) => basename(file).startsWith("Pinned"))
      .map(posix);

    expect(offenders).toEqual([]);
  });

  it("scans the whole tree, not a fixed list of files", () => {
    // Guards both assertions above: a walk that returned nothing would make an
    // absence vacuously true, which is the one way this test could lie.
    const files = sourceFiles(SRC_DIR).map((file) => relative(SRC_DIR, file));

    expect(files.length).toBeGreaterThan(1);
    expect(files.some((file) => file.includes(sep))).toBe(true);
  });
});

describe("a thread is the same node as a post", () => {
  it("has no component module named for threads", () => {
    // A `.tsx` module under this folder is a component module; a thread rendered
    // by its own component is exactly what criterion 3 forbids. The thread
    // *query* may live wherever it likes — this is about the node in the tree.
    const offenders = feedSources()
      .filter((file) => file.endsWith(".tsx"))
      .filter((file) => /thread/i.test(basename(file)))
      .map(posix);

    expect(
      offenders,
      "PostNode renders a post and a thread at any depth; there is no second component",
    ).toEqual([]);
  });

  it("builds the page out of PostNode", () => {
    const imported = importSpecifiers(read(join(FEED_DIR, "FeedPage.tsx"))).map(moduleName);

    expect(imported, "the feed's items are PostNodes").toContain("PostNode");
  });
});

describe("the live-score ticker is applied as a decorator", () => {
  it("has PostNode wrap through LiveScoreTickerDecorator", () => {
    // The behavioural half — a ticker for a post with scores, none for a post
    // without — is equally satisfied by an inline badge. The pattern is assigned
    // by [[wiki/CodeContext/Standards/gof-patterns|GoF patterns]], so the module
    // doing the wrapping is part of the criterion.
    const imported = importSpecifiers(read(join(FEED_DIR, "PostNode.tsx"))).map(moduleName);

    expect(imported).toContain("LiveScoreTickerDecorator");
  });
});

describe("the feed never learns which ranking strategy the API chose", () => {
  /**
   * The vocabulary of a decision this unit does not make. `GET /feed` is the
   * same request for a guest and for a signed-in user, and the backend picks
   * between `GuestRecentStrategy` and `FollowsAndPreferredTeamStrategy`
   * ([[0x06-feed]]) — a feed component that can name either has duplicated a
   * decision it will drift from.
   */
  const RANKING = /personali[sz]ed|chronological|\branking\b|\bstrategy\b|engagement-weighted/i;

  it("names none of it in code", () => {
    const offenders = feedSources()
      .filter((file) => RANKING.test(withoutComments(read(file))))
      .map(posix);

    expect(
      offenders,
      "the API picks the strategy and the UI renders whatever came back",
    ).toEqual([]);
  });

  it("reads source it actually found", () => {
    // Guards the assertion above, which a missing or empty walk would make
    // vacuously true.
    const sources = feedSources();

    expect(sources.length, "features/feed has no modules to check").toBeGreaterThan(0);
    for (const file of sources) {
      expect(withoutComments(read(file)).trim().length, `${posix(file)} is empty`).toBeGreaterThan(
        0,
      );
    }
  });
});

describe("the feed composes nothing", () => {
  /** A sibling feature folder, reached by any spelling. */
  const SIBLING = /(^|\/)(features\/)?(compose|profile|notifications|search)(\/|$)/;

  it("reaches the composer by address, not by import", () => {
    const offenders: string[] = [];

    for (const file of feedSources()) {
      for (const specifier of importSpecifiers(read(file))) {
        if (SIBLING.test(specifier)) offenders.push(`${posix(file)} imports ${specifier}`);
      }
    }

    expect(
      offenders,
      "/compose?reply_to= is the seam; a feature folder never imports another's internals",
    ).toEqual([]);
  });

  it("checks specifiers it actually parsed, not an empty list", () => {
    // Two ways the assertion above could pass while proving nothing: no modules
    // to walk, or a regex that parsed no imports out of the ones there are.
    const sources = feedSources();

    expect(sources.length, "features/feed has no modules to check").toBeGreaterThan(0);
    for (const file of sources) {
      const imported = importSpecifiers(read(file));

      expect(imported.length, `no imports were parsed out of ${posix(file)}`).toBeGreaterThan(0);
    }
  });
});
