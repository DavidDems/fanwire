/**
 * FRONTEND-017 criterion 6, the games half: the game page's "Post about this"
 * addresses are built by one helper, not written out per link.
 *
 * **Why the helper lives here, not in `features/stats/links.ts`.** The
 * criterion allows either one helper per feature or one shared helper there,
 * but the isolation tests already on `main` settle it: `features/games`
 * imports no other feature (`games-isolation.test.ts`), and `features/players`
 * imports nothing from another feature but `games/format`
 * (`stats-isolation.test.ts`). So each feature has its own:
 *
 * - **`features/games/postLinks.ts`** exports
 *   - `postAboutGameHref(gameId: number): string` →
 *     `/compose?link=game_final&ref=<gameId>`
 *   - `postAboutLineHref(lineId: number, gameId: number): string` →
 *     `/compose?link=player_game&ref=<lineId>&game=<gameId>`
 * - `features/players/postLinks.ts` (its own test beside it) builds the
 *   career address.
 *
 * The addresses are `FRONTEND-013`'s (`features/compose/prefilled-link.test.tsx`),
 * reached by address only: nothing here imports the composer. They are
 * compared as a path and a set of parameters; the order the spec writes them
 * in (`link`, `ref`, then `game`) is a fine one, but nothing reads it.
 *
 * "Not hand-written per link" is pinned on the shipped sources: the composer's
 * path appears in `postLinks.ts` and in no other file of this folder, and
 * some other file of this folder imports the helper.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR } from "../../test/css";
import {
  composeTarget,
  gameFinalAddress,
  playerGameAddress,
} from "../../test/post-about";
import { postAboutGameHref, postAboutLineHref } from "./postLinks";

describe("postAboutGameHref", () => {
  it.each([501, 1, 42300417])(
    "is the game-result address for game %i",
    (id) => {
      expect(composeTarget(postAboutGameHref(id))).toEqual(
        gameFinalAddress(id),
      );
    },
  );

  it("is a path on this site, not an absolute URL", () => {
    expect(postAboutGameHref(501).startsWith("/compose?")).toBe(true);
  });
});

describe("postAboutLineHref", () => {
  it("is the player's-game address: the line, then the game it is in", () => {
    expect(composeTarget(postAboutLineHref(80001, 501))).toEqual(
      playerGameAddress(80001, 501),
    );
  });

  it("does not confuse the line with the game", () => {
    expect(composeTarget(postAboutLineHref(501, 80001))).toEqual(
      playerGameAddress(501, 80001),
    );
    expect(postAboutLineHref(80001, 501)).not.toBe(
      postAboutLineHref(501, 80001),
    );
  });

  it("is a path on this site, not an absolute URL", () => {
    expect(postAboutLineHref(80001, 501).startsWith("/compose?")).toBe(true);
  });
});

// ------------------------------------------------------------ one helper

const GAMES_DIR = join(SRC_DIR, "features", "games");
const HELPER = "postLinks.ts";
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"];

function shipped(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) found.push(...shipped(full));
    else if (
      SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension)) &&
      !/\.test\.[cm]?[jt]sx?$/.test(entry)
    )
      found.push(full);
  }
  return found;
}

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

function posix(file: string): string {
  return relative(SRC_DIR, file).split(sep).join("/");
}

const COMPOSE_PATH = ["/", "compose"].join("");

describe("the addresses are built in postLinks.ts only", () => {
  it("found the folder's sources, the helper among them", () => {
    const files = shipped(GAMES_DIR);

    expect(files.length).toBeGreaterThan(1);
    expect(files.map(posix)).toContain(`features/games/${HELPER}`);
  });

  it("names the composer's path in no other file of features/games", () => {
    const offenders = shipped(GAMES_DIR)
      .filter((file) => !file.endsWith(`${sep}${HELPER}`))
      .filter((file) =>
        withoutComments(readFileSync(file, "utf8")).includes(COMPOSE_PATH),
      )
      .map(posix);

    expect(offenders).toEqual([]);
  });

  it("is used by the page", () => {
    const users = shipped(GAMES_DIR)
      .filter((file) => !file.endsWith(`${sep}${HELPER}`))
      .filter((file) =>
        /\bfrom\s*["']\.\/postLinks(\.[jt]s)?["']/.test(
          withoutComments(readFileSync(file, "utf8")),
        ),
      )
      .map(posix);

    expect(users).not.toEqual([]);
  });
});
