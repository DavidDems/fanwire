/**
 * FRONTEND-002 acceptance criteria 1 and 2, pinned structurally.
 *
 * "Every page and hook depends on the interface rather than on the
 * implementation" is not something a behavioural test can see: a page that
 * imports `CognitoUser` directly still renders. So this reads the source tree
 * from disk and asserts that the Cognito SDK is reachable from exactly one
 * file. Same shape as `src/test/env-usage.test.ts`, and for the same reason —
 * a rule nobody has to remember beats a rule written in the wiki.
 *
 * The second half is criterion 2's "no production code branches on environment
 * to choose an implementation". There is one implementation; configuration
 * differs, code does not. The Vite build-time environment is deliberately *not*
 * checked here: `env-usage.test.ts` already owns that one for the whole tree.
 *
 * Needles are assembled from fragments, and neither the SDK's package name nor
 * the environment read is spelled out anywhere in this file, so it does not
 * match itself and does not trip the scan in `env-usage.test.ts`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

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
const AUTH_DIR = join(SRC_DIR, "auth");

/** The one file allowed to know Cognito exists, relative to `src/`. */
const IMPLEMENTATION = "auth/CognitoAuthService.ts";

const SDK = ["amazon", "cognito", "identity", "js"].join("-");

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

describe("the Cognito SDK is reachable from exactly one module", () => {
  it("has that module where the interface's one implementation lives", () => {
    expect(
      existsSync(join(SRC_DIR, IMPLEMENTATION)),
      `${IMPLEMENTATION} is the one implementation of AuthService and must exist`,
    ).toBe(true);
  });

  it("is imported by no other file under src", () => {
    const importers = sourceFiles(SRC_DIR)
      .filter((file) => readFileSync(file, "utf8").includes(SDK))
      .map(posix)
      .sort();

    expect(
      importers,
      `only ${IMPLEMENTATION} may import the Cognito SDK — everything else depends on the AuthService interface`,
    ).toEqual([IMPLEMENTATION]);
  });

  it("scans the whole tree, not a fixed list of files", () => {
    // Guards the assertion above: a walk that returned nothing would make
    // "imported by no other file" vacuously true.
    const files = sourceFiles(SRC_DIR).map((file) => relative(SRC_DIR, file));

    expect(files.length).toBeGreaterThan(1);
    expect(files.some((file) => file.includes(sep))).toBe(true);
  });
});

describe("no test stands in a mock of the SDK for the interface double", () => {
  // A test that mocks the Cognito SDK pins the mock: it keeps
  // passing after the real call signature changes. Same for a mocked
  // `apiClient` — `msw` mocks the network, and the generated client is exercised
  // for real (`wiki/CodeContext/Modules/0x08-frontend.md`, test harness facts).
  const MODULE_MOCK = new RegExp(
    ["vi", "mock"].join("\\s*\\.\\s*") + "\\s*\\(\\s*[\"'`]([^\"'`]+)",
  );
  const FORBIDDEN_TO_MOCK = [SDK, "api/client", "openapi-fetch"];

  it("mocks neither the Cognito SDK nor the typed HTTP client", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC_DIR)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(new RegExp(MODULE_MOCK, "g"))) {
        const specifier = match[1];
        if (FORBIDDEN_TO_MOCK.some((forbidden) => specifier.includes(forbidden))) {
          offenders.push(`${posix(file)} mocks ${specifier}`);
        }
      }
    }

    expect(offenders, "inject an AuthService double, and mock HTTP with msw").toEqual([]);
  });
});

describe("the auth layer does not branch on environment", () => {
  /** Anything that would let one build behave differently from another. */
  const ENVIRONMENT_BRANCH = new RegExp(
    [
      "\\bNODE_ENV\\b",
      ["process", "env"].join("\\s*\\.\\s*"),
      "\\bMODE\\b",
      "\\bDEV\\b",
      "\\bPROD\\b",
    ].join("|"),
  );

  it("has an auth directory to check", () => {
    expect(existsSync(AUTH_DIR), `${AUTH_DIR} does not exist`).toBe(true);
  });

  it("chooses its implementation the same way in every environment", () => {
    const offenders = sourceFiles(AUTH_DIR)
      .filter((file) => !isTest(file))
      .filter((file) => ENVIRONMENT_BRANCH.test(readFileSync(file, "utf8")))
      .map(posix);

    expect(
      offenders,
      "there is one AuthService implementation; configuration differs, code does not",
    ).toEqual([]);
  });
});
