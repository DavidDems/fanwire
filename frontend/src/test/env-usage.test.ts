/**
 * FRONTEND-001 acceptance criterion 5 — configuration is read in exactly one
 * place.
 *
 * This is the test that keeps criterion 3 true after six more units have
 * touched the tree. A second file reading the environment directly is not a
 * style problem: it is a value that skips validation, ships as `undefined`, and
 * fails in a browser instead of at build time.
 *
 * It reads the source tree from disk rather than importing anything, so it
 * keeps working as feature folders appear — there is no list of files here to
 * forget to update.
 *
 * Note the two halves. "Nobody reads the environment" is trivially true of an
 * empty tree and pins nothing, so `config.ts` must exist and must be the file
 * that does the reading.
 *
 * The needle is assembled from fragments so that this file does not match
 * itself, and so the message it prints stays readable.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Vitest's `import.meta.url` is not a `file:` URL (modules are served, not
 * read), so the tree is located from the working directory instead: `frontend`
 * locally, `/app` in the test container — both of which contain `src`.
 */
function findSrcDir(): string {
  for (const candidate of [join(process.cwd(), "src"), join(process.cwd(), "frontend", "src")]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`cannot locate frontend/src from ${process.cwd()}`);
}

const SRC_DIR = findSrcDir();
const CONFIG_FILE = join(SRC_DIR, "config.ts");

/** Matches a read of the Vite build-time environment, however it is spaced. */
const ENV_READ = new RegExp(["import", "meta", "env"].join("\\s*\\.\\s*"));

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

describe("the Vite build-time environment is read in one place", () => {
  it("is read by config.ts", () => {
    expect(existsSync(CONFIG_FILE), `${CONFIG_FILE} does not exist`).toBe(true);
    expect(
      ENV_READ.test(readFileSync(CONFIG_FILE, "utf8")),
      "config.ts is meant to be the one module that reads the Vite environment",
    ).toBe(true);
  });

  it("is read by no other file under src", () => {
    const offenders = sourceFiles(SRC_DIR)
      .filter((file) => file !== CONFIG_FILE)
      .filter((file) => ENV_READ.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC_DIR, file).split(sep).join("/"));

    expect(offenders, "these files must import config.ts instead").toEqual([]);
  });

  it("scans the whole tree, not a fixed list of files", () => {
    // Guards the test itself: a walk that silently returned nothing, or that
    // stopped at the top level, would make the assertion above meaningless.
    const files = sourceFiles(SRC_DIR).map((file) => relative(SRC_DIR, file));

    expect(files.length).toBeGreaterThan(1);
    expect(files.some((file) => file.includes(sep))).toBe(true);
  });
});
