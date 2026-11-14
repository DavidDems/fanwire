/**
 * FRONTEND-015 criteria 2, 3, 4 and 7, pinned from disk: what the reveal *is*,
 * which a behavioural test cannot see.
 *
 * - **One hook, one wrapper.** Readiness is `features/feed/useCardReady.ts`'s,
 *   and `PreparedPostNode` is the one component that uses it, rendering the
 *   shared `Skeleton` until the card is ready and then the feed's `PostNode`.
 *   The feed, search results and the thread modal render their posts through
 *   `PreparedPostNode`, never a bare `PostNode`, so no list re-implements the
 *   rule. (A profile renders no posts yet; when it does, it takes the same
 *   wrapper.)
 * - **One bound, one window**: `CARD_READY_TIMEOUT_MS` and
 *   `PREPARE_WINDOW_ROOT_MARGIN` are exported from the hook's module, and the
 *   4000 is written nowhere else.
 * - **The 4:3 frame** (criterion 4): some rule in the feed's module CSS has
 *   `aspect-ratio: 4 / 3` on a surface-token background (the letterbox), and
 *   the picture inside it is `object-fit: contain`, never `cover`, which would
 *   crop it. jsdom applies no styles, so this is the file.
 * - **No animation** (criterion 7): the reveal is a swap, not a fade. No module
 *   stylesheet the cards are drawn with declares an `animation` or a
 *   `transition`, and neither new module asks for one in code. The keyframes
 *   at-rule is already forbidden tree-wide by `styles/base.test.ts`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR, allBlocks, parseCss, type CssBlock } from "../../test/css";
import { declared, moduleCssFiles } from "../../test/module-css";

const FEED_DIR = join(SRC_DIR, "features", "feed");
const HOOK = join(FEED_DIR, "useCardReady.ts");
const WRAPPER = join(FEED_DIR, "PreparedPostNode.tsx");

/** Every list that renders post cards today. */
const LISTS = [
  "features/feed/FeedPage.tsx",
  "features/search/SearchPage.tsx",
  "features/thread/ThreadModal.tsx",
] as const;

function read(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function posix(file: string): string {
  return relative(SRC_DIR, file).split(sep).join("/");
}

/** Comments out; a URL's `//` inside a string survives. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

/** `{ names } from "specifier"` for every named import in `source`. */
function namedImports(
  source: string,
): { specifier: string; names: string[] }[] {
  return [
    ...withoutComments(source).matchAll(
      /\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g,
    ),
  ].map((match) => ({
    specifier: match[2],
    names: match[1]
      .split(",")
      .map(
        (name) =>
          name
            .replace(/^\s*type\s+/, "")
            .trim()
            .split(/\s+as\s+/)[0],
      )
      .filter((name) => name !== ""),
  }));
}

function imports(source: string, specifier: RegExp, name: string): boolean {
  return namedImports(source).some(
    (statement) =>
      specifier.test(statement.specifier) && statement.names.includes(name),
  );
}

describe("one hook computes readiness, one wrapper applies it", () => {
  it("has features/feed/useCardReady.ts exporting the hook and both constants", () => {
    expect(existsSync(HOOK), "features/feed/useCardReady.ts must exist").toBe(
      true,
    );
    const source = withoutComments(read(HOOK));

    expect(source).toMatch(/\bexport\s+function\s+useCardReady\b/);
    expect(source).toMatch(/\bexport\s+const\s+CARD_READY_TIMEOUT_MS\b/);
    expect(source).toMatch(/\bexport\s+const\s+PREPARE_WINDOW_ROOT_MARGIN\b/);
  });

  it("has PreparedPostNode built from the hook, the shared Skeleton and PostNode", () => {
    expect(
      existsSync(WRAPPER),
      "features/feed/PreparedPostNode.tsx must exist",
    ).toBe(true);
    const source = read(WRAPPER);

    expect(imports(source, /^\.\/useCardReady(\.ts)?$/, "useCardReady")).toBe(
      true,
    );
    expect(
      imports(source, /components\/ui\/Skeleton(\.tsx)?$/, "Skeleton"),
    ).toBe(true);
    expect(imports(source, /^\.\/PostNode(\.tsx)?$/, "PostNode")).toBe(true);
    expect(withoutComments(source)).toMatch(
      /\bexport\s+function\s+PreparedPostNode\b/,
    );
  });

  it.each(LISTS)("%s renders its posts through PreparedPostNode", (list) => {
    const source = read(join(SRC_DIR, ...list.split("/")));
    expect(source.length, `${list} is missing`).toBeGreaterThan(0);

    expect(
      imports(source, /(^|\/)PreparedPostNode(\.tsx)?$/, "PreparedPostNode"),
      `${list} must import PreparedPostNode`,
    ).toBe(true);
    expect(withoutComments(source)).toMatch(/<PreparedPostNode\b/);
    expect(
      withoutComments(source),
      `${list} renders a bare PostNode, which skips the readiness rule`,
    ).not.toMatch(/<PostNode\b/);
  });

  it("writes the 4000 ms bound in the hook's module and nowhere else", () => {
    const offenders = ["features/feed", "features/search", "features/thread"]
      .flatMap((folder) => sourceFilesIn(join(SRC_DIR, ...folder.split("/"))))
      .filter((file) => file !== HOOK)
      .filter((file) =>
        /(?<![\w.])4_?000(?![\w.])/.test(withoutComments(read(file))),
      )
      .map(posix);

    expect(offenders).toEqual([]);
    expect(withoutComments(read(HOOK))).toMatch(/(?<![\w.])4_?000(?![\w.])/);
  });
});

/** The shipped `.ts`/`.tsx` modules in `directory` (tests excluded), one level deep and below. */
function sourceFilesIn(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFilesIn(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Every style rule in a stylesheet, at any depth. */
function rules(file: string): CssBlock[] {
  return allBlocks(parseCss(read(file))).filter(
    (block) => !block.prelude.startsWith("@"),
  );
}

const FOUR_BY_THREE = /^4\s*\/\s*3$/;
const SURFACE_TOKEN = /var\(\s*--color-surface[\w-]*\s*\)/;

describe("every post image sits in a fixed 4:3 frame (criterion 4)", () => {
  const feedCss = moduleCssFiles(FEED_DIR);

  it("has feed module CSS to read (not vacuously green)", () => {
    expect(feedCss.length).toBeGreaterThan(0);
  });

  it("frames the picture at aspect-ratio 4 / 3, letterboxed in a surface token", () => {
    const frames = feedCss.flatMap((file) =>
      rules(file)
        .filter((rule) =>
          FOUR_BY_THREE.test(declared(rule, "aspect-ratio") ?? ""),
        )
        .map((rule) => ({ file, rule })),
    );
    expect(
      frames.map(({ rule }) => rule.prelude),
      "no rule has aspect-ratio: 4 / 3",
    ).not.toEqual([]);

    const letterboxed = frames.filter(({ rule }) =>
      SURFACE_TOKEN.test(
        declared(rule, "background-color") ??
          declared(rule, "background") ??
          "",
      ),
    );
    expect(
      letterboxed.map(({ rule }) => rule.prelude),
      "the 4:3 frame's background is a --color-surface… token",
    ).not.toEqual([]);

    // The picture inside the frame is contained, in the same stylesheet.
    const contained = letterboxed.filter(({ file }) =>
      rules(file).some((rule) => declared(rule, "object-fit") === "contain"),
    );
    expect(
      contained.map(({ file }) => posix(file)),
      "object-fit: contain beside the frame",
    ).not.toEqual([]);
  });

  it("never crops a post picture with object-fit: cover", () => {
    const offenders = feedCss.flatMap((file) =>
      rules(file)
        .filter((rule) => declared(rule, "object-fit") === "cover")
        .map((rule) => `${posix(file)}: ${rule.prelude}`),
    );

    expect(offenders).toEqual([]);
  });
});

describe("the reveal has no animation (criterion 7)", () => {
  const stylesheets = [
    ...moduleCssFiles(FEED_DIR),
    ...moduleCssFiles(join(SRC_DIR, "features", "search")),
    ...moduleCssFiles(join(SRC_DIR, "features", "thread")),
    join(SRC_DIR, "components", "ui", "Skeleton.module.css"),
  ];

  it("reads the stylesheets the cards are drawn with", () => {
    expect(stylesheets.length).toBeGreaterThan(3);
    for (const file of stylesheets) {
      expect(existsSync(file), `${posix(file)} is missing`).toBe(true);
    }
  });

  it("declares no animation or transition in any of them", () => {
    const offenders = stylesheets.flatMap((file) =>
      allBlocks(parseCss(read(file))).flatMap((block) =>
        block.declarations
          .filter(({ property }) =>
            /^(animation|transition)(-|$)/.test(property),
          )
          .map(
            ({ property }) =>
              `${posix(file)}: ${block.prelude} { ${property} }`,
          ),
      ),
    );

    expect(offenders).toEqual([]);
  });

  it("asks for no animation in code either", () => {
    for (const file of [HOOK, WRAPPER]) {
      expect(existsSync(file), `${posix(file)} must exist`).toBe(true);
      expect(withoutComments(read(file))).not.toMatch(
        /\.animate\s*\(|\banimation\b|\btransition\b|\bopacity\b/i,
      );
    }
  });
});
