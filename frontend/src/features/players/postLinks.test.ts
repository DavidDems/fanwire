/**
 * FRONTEND-017 criterion 6, the players half: the player page's "Post about
 * this" addresses are built by one helper, not written out per link.
 *
 * Per feature rather than shared in `features/stats/links.ts`, because
 * `features/players` may import nothing from another feature but
 * `games/format` (`features/stats/stats-isolation.test.ts`); see
 * `features/games/postLinks.test.ts` for the games half.
 *
 * - **`features/players/postLinks.ts`** exports
 *   `postAboutCareerHref(playerId: number, scope: "regular" | "playoffs"): string`
 *   → `/compose?link=player_career&ref=<playerId>&scope=<scope>`.
 *
 * The address is `FRONTEND-013`'s, compared as a path and a set of
 * parameters. "Not hand-written per link" is pinned on the shipped sources:
 * the composer's path appears in `postLinks.ts` and in no other file of this
 * folder, and some other file of this folder imports the helper.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR } from "../../test/css";
import { composeTarget, playerCareerAddress } from "../../test/post-about";
import { postAboutCareerHref } from "./postLinks";

describe("postAboutCareerHref", () => {
  it.each([
    [2544, "regular"],
    [2544, "playoffs"],
    [1630567, "regular"],
  ] as const)("is player %i's %s career address", (id, scope) => {
    expect(composeTarget(postAboutCareerHref(id, scope))).toEqual(
      playerCareerAddress(id, scope),
    );
  });

  it("gives each scope its own address", () => {
    expect(postAboutCareerHref(2544, "regular")).not.toBe(
      postAboutCareerHref(2544, "playoffs"),
    );
  });

  it("is a path on this site, not an absolute URL", () => {
    expect(postAboutCareerHref(2544, "regular").startsWith("/compose?")).toBe(
      true,
    );
  });
});

// ------------------------------------------------------------ one helper

const PLAYERS_DIR = join(SRC_DIR, "features", "players");
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
    const files = shipped(PLAYERS_DIR);

    expect(files.length).toBeGreaterThan(1);
    expect(files.map(posix)).toContain(`features/players/${HELPER}`);
  });

  it("names the composer's path in no other file of features/players", () => {
    const offenders = shipped(PLAYERS_DIR)
      .filter((file) => !file.endsWith(`${sep}${HELPER}`))
      .filter((file) =>
        withoutComments(readFileSync(file, "utf8")).includes(COMPOSE_PATH),
      )
      .map(posix);

    expect(offenders).toEqual([]);
  });

  it("is used by the page", () => {
    const users = shipped(PLAYERS_DIR)
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
