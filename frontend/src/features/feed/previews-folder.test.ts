/**
 * FRONTEND-014 criterion 8, pinned structurally: the three preview components
 * live in one folder, `features/feed/previews/`, are typed from the generated
 * preview types, and share no markup with the composer's attachment summary,
 * so none of them imports anything from `features/compose`.
 *
 * (That the feed imports neither `features/games` nor `features/players` is
 * `features/games/games-isolation.test.ts`'s and `feed-isolation.test.ts`'s,
 * and covers this folder too: both walk `features/feed/` recursively.)
 *
 * The composer's folder name is assembled from fragments, so this file is not
 * itself an occurrence for any scan of the tree.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function findSrcDir(): string {
  for (const candidate of [
    join(process.cwd(), "src"),
    join(process.cwd(), "frontend", "src"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`cannot locate frontend/src from ${process.cwd()}`);
}

const PREVIEWS_DIR = join(findSrcDir(), "features", "feed", "previews");

const COMPONENTS = [
  "GamePreview",
  "PlayerGamePreview",
  "PlayerCareerPreview",
] as const;

/** The three preview types, each a member of `PostView`'s union. */
const SCHEMA_TYPES: Record<(typeof COMPONENTS)[number], string> = {
  GamePreview: "GameFinalPreviewView",
  PlayerGamePreview: "PlayerGamePreviewView",
  PlayerCareerPreview: "PlayerCareerPreviewView",
};

const COMPOSE = ["com", "pose"].join("");

function read(name: string): string {
  return readFileSync(join(PREVIEWS_DIR, `${name}.tsx`), "utf8");
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const pattern of [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']/g,
  ]) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

describe("the three preview components live in one folder", () => {
  it.each(COMPONENTS)("has features/feed/previews/%s.tsx", (name) => {
    expect(existsSync(join(PREVIEWS_DIR, `${name}.tsx`))).toBe(true);
  });

  it.each(COMPONENTS)("%s names its generated preview type", (name) => {
    expect(read(name)).toContain(SCHEMA_TYPES[name]);
  });

  it("is a folder of source files, not an empty one", () => {
    const files = readdirSync(PREVIEWS_DIR).filter((entry) =>
      /\.tsx?$/.test(entry),
    );

    expect(files.length).toBeGreaterThanOrEqual(COMPONENTS.length);
  });
});

describe("the previews share nothing with the composer", () => {
  const COMPOSE_SPECIFIER = new RegExp(`(^|/)${COMPOSE}(/|$)`);

  it.each(COMPONENTS)("%s imports nothing from features/compose", (name) => {
    const specifiers = importSpecifiers(read(name));

    expect(specifiers.length, `no imports parsed from ${name}`).toBeGreaterThan(
      0,
    );
    expect(
      specifiers.filter((specifier) => COMPOSE_SPECIFIER.test(specifier)),
    ).toEqual([]);
  });

  it("no module in the folder imports from features/compose", () => {
    const offenders = readdirSync(PREVIEWS_DIR)
      .filter((entry) => /\.tsx?$/.test(entry) && !/\.test\./.test(entry))
      .filter((entry) =>
        importSpecifiers(readFileSync(join(PREVIEWS_DIR, entry), "utf8")).some(
          (specifier) => COMPOSE_SPECIFIER.test(specifier),
        ),
      );

    expect(offenders).toEqual([]);
  });
});
