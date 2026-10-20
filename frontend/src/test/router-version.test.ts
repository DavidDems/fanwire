/**
 * FRONTEND-016 — the router is on the 7 line, at 7.18.4 or later.
 *
 * 6.30.6 carries GHSA-337j-9hxr-rhxg and GHSA-wrjc-x8rr-h8h6, fixed only on
 * the 7 line. This reads the *installed* package.json files rather than
 * `frontend/package.json`, because a range in package.json says nothing about
 * what the lockfile actually resolved.
 *
 * `react-router` is looked up the way `react-router-dom` itself would find it:
 * a copy nested under `react-router-dom/node_modules` first, then the
 * top-level one. So a stray 6.x copy that `react-router-dom` really imports
 * cannot hide behind a 7.x one at the top level.
 *
 * The last block keeps the v6 future flags out of `src/`: on v7 they are the
 * default behaviour and setting them is dead configuration. The flag names are
 * assembled from fragments so this file does not match itself.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/** `frontend` locally, `/app` in the test container. */
function findFrontendDir(): string {
  for (const candidate of [process.cwd(), join(process.cwd(), "frontend")]) {
    if (
      existsSync(join(candidate, "package.json")) &&
      existsSync(join(candidate, "src"))
    ) {
      return candidate;
    }
  }
  throw new Error(`cannot locate frontend/ from ${process.cwd()}`);
}

const FRONTEND_DIR = findFrontendDir();
const NODE_MODULES = join(FRONTEND_DIR, "node_modules");
const SRC_DIR = join(FRONTEND_DIR, "src");

const MINIMUM: readonly [number, number, number] = [7, 18, 4];

interface InstalledPackage {
  path: string;
  version: string;
}

function readPackage(path: string): InstalledPackage {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    typeof parsed.version !== "string"
  ) {
    throw new Error(`${path} has no string "version"`);
  }
  return { path, version: parsed.version };
}

function installedRouterDom(): InstalledPackage {
  const path = join(NODE_MODULES, "react-router-dom", "package.json");
  if (!existsSync(path))
    throw new Error(`react-router-dom is not installed: ${path}`);
  return readPackage(path);
}

function installedRouter(): InstalledPackage {
  for (const path of [
    join(
      NODE_MODULES,
      "react-router-dom",
      "node_modules",
      "react-router",
      "package.json",
    ),
    join(NODE_MODULES, "react-router", "package.json"),
  ]) {
    if (existsSync(path)) return readPackage(path);
  }
  throw new Error("react-router is not installed");
}

function parseVersion(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) throw new Error(`not a semver version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function atLeast(
  version: readonly [number, number, number],
  minimum: readonly [number, number, number],
): boolean {
  for (let i = 0; i < 3; i += 1) {
    if (version[i] !== minimum[i]) return version[i] > minimum[i];
  }
  return true;
}

describe.each([
  ["react-router-dom", installedRouterDom],
  ["react-router", installedRouter],
])("installed %s", (_name, load) => {
  it("is on major 7", () => {
    const { path, version } = load();
    expect(parseVersion(version)[0], `${path} is ${version}`).toBe(7);
  });

  it("is at 7.18.4 or later", () => {
    const { path, version } = load();
    expect(
      atLeast(parseVersion(version), MINIMUM),
      `${path} is ${version}`,
    ).toBe(true);
  });
});

describe("react-router-dom and react-router", () => {
  it("are installed at the same version", () => {
    expect(installedRouter().version).toBe(installedRouterDom().version);
  });
});

const FUTURE_FLAGS = [
  "startTransition",
  "relativeSplatPath",
  "fetcherPersist",
  "normalizeFormMethod",
  "partialHydration",
  "skipActionErrorRevalidation",
].map((name) => ["v7", name].join("_"));

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
    if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension)))
      found.push(full);
  }
  return found;
}

describe("src/", () => {
  it("sets no v6 future flag", () => {
    const files = sourceFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(0);
    const hits = files.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return FUTURE_FLAGS.filter((flag) => text.includes(flag)).map(
        (flag) => `${relative(FRONTEND_DIR, file)}: ${flag}`,
      );
    });
    expect(hits).toEqual([]);
  });
});
