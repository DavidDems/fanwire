/**
 * FRONTEND-054: one 429 line, shared by every posting path.
 *
 * The composer, the reply box and a card's Repost each showed their own
 * sentence for a 429 (FRONTEND-026). They now show one, `RATE_LIMITED_MESSAGE`,
 * from `src/lib/messages.ts`. This pins the exact wording (the apostrophe is
 * U+2019), that the three call sites import it, and that neither compose nor
 * feed keeps a second 429 sentence of its own.
 *
 * What each surface shows on screen is pinned by
 * `features/compose/rate-limit.test.tsx` and
 * `features/feed/repost-rate-limit.test.tsx`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR } from "../test/css";
import { RATE_LIMITED_MESSAGE } from "./messages";

const CALL_SITES = [
  "features/compose/ComposePage.tsx",
  "features/compose/InlineComposer.tsx",
  "features/feed/PostAction.tsx",
];

const SWEPT_FOLDERS = ["features/compose", "features/feed"];

/** A 429 sentence, old or new, written anywhere but `lib/messages.ts`. */
const RATE_LIMIT_WORDING =
  /too quickly|wait a little|going a bit fast|slow down/i;

function read(relativePath: string): string {
  return readFileSync(join(SRC_DIR, ...relativePath.split("/")), "utf8");
}

function posix(file: string): string {
  return relative(SRC_DIR, file).split(sep).join("/");
}

/** Every non-test `.ts`/`.tsx` file under `directory`, relative to `src/`. */
function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      found.push(posix(full));
    }
  }
  return found;
}

/**
 * The source with its comments removed: `feed/api.ts`'s `RepostRateLimited`
 * doc comment says "posting too quickly", and that is prose, not UI text.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

const swept = SWEPT_FOLDERS.flatMap((folder) =>
  sourceFiles(join(SRC_DIR, ...folder.split("/"))),
);

describe("RATE_LIMITED_MESSAGE", () => {
  it("is the one short, calm line, with a typographic apostrophe", () => {
    expect(RATE_LIMITED_MESSAGE).toBe(
      "You’re going a bit fast. Wait a moment and try again.",
    );
  });

  it.each(CALL_SITES)("%s imports it from lib/messages", (file) => {
    expect(read(file)).toMatch(
      /import\s*\{[^}]*\bRATE_LIMITED_MESSAGE\b[^}]*\}\s*from\s*["']\.\.\/\.\.\/lib\/messages["']/,
    );
  });

  it("is the only 429 sentence in compose and feed", () => {
    const offenders = swept.filter((file) =>
      RATE_LIMIT_WORDING.test(withoutComments(read(file))),
    );
    expect(offenders).toEqual([]);
  });

  it("the sweep read the three call sites, so it cannot pass on an empty walk", () => {
    expect(swept).toEqual(expect.arrayContaining(CALL_SITES));
  });
});
