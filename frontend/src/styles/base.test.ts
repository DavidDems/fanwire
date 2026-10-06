/**
 * UI-001: the global base stylesheet, reduced motion, and no keyframes.
 *
 * Static over `src/styles/base.css` and `src/styles/tokens.css`
 * (`verification.md` §2a): jsdom applies no CSS, so these read the files.
 * Accessibility ids are from `wiki/CodeContext/FrontendUI/accessibility.md`.
 *
 * Two things may live in either stylesheet, because the documents name
 * different homes for them: `color-scheme: light dark` (tokens.md §1 puts it
 * on `:root`, the task's criterion puts it in base.css) and the
 * `prefers-reduced-motion` block (verification.md §2a says base.css, tokens.md
 * §8 doesn't say). Either file passes.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  REDUCED_MOTION,
  SRC_DIR,
  allBlocks,
  isAtRule,
  mediaBlocks,
  mediaRootCustomProperties,
  normaliseValue,
  parseCss,
  readSrcFile,
  resolveValue,
  rootCustomProperties,
  selectors,
  type CssBlock,
} from "../test/css";

const BASE = "styles/base.css";
const TOKENS = "styles/tokens.css";

function base(): CssBlock[] {
  return parseCss(readSrcFile(BASE));
}

/** Style rules at any depth (inside `@media`, `@layer` or nested). */
function styleRules(blocks: CssBlock[]): CssBlock[] {
  return allBlocks(blocks).filter((block) => !isAtRule(block));
}

function declared(block: CssBlock, property: string): string | undefined {
  // The last declaration wins, as in the cascade.
  return [...block.declarations]
    .reverse()
    .find((declaration) => declaration.property === property)?.value;
}

/** A stylesheet that may hold a rule either document places, read if present. */
function eitherStylesheet(): { file: string; blocks: CssBlock[] }[] {
  return [BASE, TOKENS].map((file) => ({
    file,
    blocks: parseCss(readSrcFile(file)),
  }));
}

describe("focus is always visible (A3)", () => {
  /** `:focus-visible` for every element: bare, universal, or `:is()`/`:where()` of anything. */
  const UNIVERSAL_FOCUS_VISIBLE =
    /^(\*|:is\([^)]*\)|:where\([^)]*\))?:focus-visible$/;

  function focusRules(): CssBlock[] {
    return styleRules(base()).filter((rule) =>
      selectors(rule).some((selector) =>
        UNIVERSAL_FOCUS_VISIBLE.test(selector),
      ),
    );
  }

  /** The rule's outline as `width style color`, from the shorthand or the longhands. */
  function outlineOf(rule: CssBlock): string {
    const tokens = rootCustomProperties(parseCss(readSrcFile(TOKENS)));
    const shorthand = declared(rule, "outline");
    if (shorthand !== undefined)
      return normaliseValue(resolveValue(shorthand, tokens, null));
    return normaliseValue(
      ["outline-width", "outline-style", "outline-color"]
        .map((property) => declared(rule, property) ?? "")
        .join(" "),
    );
  }

  it("base.css has a :focus-visible rule for every element", () => {
    expect(
      focusRules().length,
      "no `:focus-visible { … }` rule in base.css",
    ).toBeGreaterThan(0);
  });

  it("draws a 2px solid var(--color-focus) outline offset 2px", () => {
    const matching = focusRules().filter(
      (rule) =>
        outlineOf(rule) === normaliseValue("2px solid var(--color-focus)") &&
        normaliseValue(declared(rule, "outline-offset") ?? "") === "2px",
    );
    expect(
      matching.map((rule) => rule.prelude),
      "`:focus-visible` needs `outline: 2px solid var(--color-focus)` (or var(--focus-ring)) and `outline-offset: 2px`",
    ).not.toEqual([]);
  });

  it("removes an outline only in a rule that is itself about :focus-visible", () => {
    const REMOVES_OUTLINE = (property: string, value: string): boolean => {
      const words = normaliseValue(value)
        .replace(/\s*!important$/, "")
        .split(" ");
      if (property === "outline")
        return words.every((word) => ["none", "0", "0px"].includes(word));
      if (property === "outline-style") return words[0] === "none";
      if (property === "outline-width")
        return words[0] === "0" || words[0] === "0px";
      return false;
    };

    const offenders = styleRules(base())
      .filter((rule) =>
        rule.declarations.some(({ property, value }) =>
          REMOVES_OUTLINE(property, value),
        ),
      )
      .filter(
        (rule) =>
          !selectors(rule).some((selector) =>
            selector.includes(":focus-visible"),
          ),
      )
      .map((rule) => rule.prelude);

    expect(
      offenders,
      "outline: none / 0 without a :focus-visible replacement",
    ).toEqual([]);
  });
});

describe("both themes reach native controls (A18)", () => {
  it("declares color-scheme: light dark on :root or html", () => {
    const found = eitherStylesheet().flatMap(({ file, blocks }) =>
      blocks
        .filter((block) =>
          selectors(block).some(
            (selector) => selector === ":root" || selector === "html",
          ),
        )
        .filter(
          (block) =>
            normaliseValue(declared(block, "color-scheme") ?? "") ===
            "light dark",
        )
        .map(() => file),
    );
    expect(
      found,
      "`color-scheme: light dark` in base.css (or tokens.css :root)",
    ).not.toEqual([]);
  });
});

describe("form control states (A7, A16)", () => {
  it('styles [aria-invalid="true"] controls with var(--color-danger)', () => {
    const INVALID = /\[aria-invalid=(["']?)true\1\]/;
    const DANGER = /var\(\s*--color-danger\s*[,)]/;
    const matching = styleRules(base()).filter(
      (rule) =>
        selectors(rule).some((selector) => INVALID.test(selector)) &&
        rule.declarations.some(({ value }) => DANGER.test(value)),
    );
    expect(
      matching.length,
      '[aria-invalid="true"] rule using var(--color-danger)',
    ).toBeGreaterThan(0);
  });

  it("styles :disabled controls with opacity: var(--opacity-disabled)", () => {
    const matching = styleRules(base()).filter(
      (rule) =>
        selectors(rule).some((selector) => selector.includes(":disabled")) &&
        normaliseValue(declared(rule, "opacity") ?? "") ===
          "var(--opacity-disabled)",
    );
    expect(
      matching.length,
      ":disabled rule with opacity: var(--opacity-disabled)",
    ).toBeGreaterThan(0);
  });

  it("never hides a disabled control's label", () => {
    const hiding = styleRules(base())
      .filter((rule) =>
        selectors(rule).some((selector) => selector.includes(":disabled")),
      )
      .filter(
        (rule) =>
          normaliseValue(declared(rule, "visibility") ?? "") === "hidden",
      )
      .map((rule) => rule.prelude);
    expect(hiding).toEqual([]);
  });
});

describe(".visually-hidden", () => {
  const CLASS = /\.visually-hidden(?![\w-])/;

  function rules(): CssBlock[] {
    return styleRules(base()).filter((rule) =>
      selectors(rule).some((selector) => CLASS.test(selector)),
    );
  }

  it("is defined in base.css", () => {
    const defined = rules().filter((rule) => rule.declarations.length > 0);
    expect(
      defined.length,
      "no .visually-hidden rule with declarations",
    ).toBeGreaterThan(0);
  });

  it("stays in the accessibility tree (no display: none or visibility: hidden)", () => {
    const hiding = rules().filter(
      (rule) =>
        normaliseValue(declared(rule, "display") ?? "") === "none" ||
        normaliseValue(declared(rule, "visibility") ?? "") === "hidden",
    );
    expect(rules().length).toBeGreaterThan(0);
    expect(hiding.map((rule) => rule.prelude)).toEqual([]);
  });
});

describe("reduced motion (A8)", () => {
  function reducedMotion(): Map<string, string> {
    const merged = new Map<string, string>();
    for (const { blocks } of eitherStylesheet()) {
      for (const [name, value] of mediaRootCustomProperties(
        blocks,
        REDUCED_MOTION,
      )) {
        merged.set(name, value);
      }
    }
    return merged;
  }

  it("has a prefers-reduced-motion: reduce block", () => {
    const blocks = eitherStylesheet().flatMap(({ blocks }) =>
      mediaBlocks(blocks, REDUCED_MOTION),
    );
    expect(blocks.length).toBeGreaterThan(0);
  });

  it.each(["--duration-fast", "--duration-base"])(
    "sets %s to 0ms on :root",
    (name) => {
      expect(normaliseValue(reducedMotion().get(name) ?? "(not set)")).toBe(
        "0ms",
      );
    },
  );
});

describe("no keyframes at-rule anywhere under src (A8)", () => {
  // Assembled from fragments so this file does not match its own scan.
  const AT_RULE = new RegExp(
    ["@(-webkit-|-moz-)?", "key", "frames\\b"].join(""),
    "i",
  );
  const SKIP_DIRECTORIES = new Set([
    "node_modules",
    "dist",
    "coverage",
    ".vite",
  ]);

  function everyFile(directory: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
      const full = join(directory, entry);
      if (statSync(full).isDirectory())
        return SKIP_DIRECTORIES.has(entry) ? [] : everyFile(full);
      return [full];
    });
  }

  it("scans a real tree that includes the stylesheets", () => {
    // Guards the scan below: an empty walk, or one that misses CSS, would make
    // it vacuously true.
    const files = everyFile(SRC_DIR).map((file) =>
      relative(SRC_DIR, file).split(sep).join("/"),
    );
    expect(files.length).toBeGreaterThan(1);
    expect(files).toContain(BASE);
    expect(files).toContain(TOKENS);
  });

  it("finds no keyframes rule in any file", () => {
    const offenders = everyFile(SRC_DIR)
      .filter(
        (file) => existsSync(file) && AT_RULE.test(readFileSync(file, "utf8")),
      )
      .map((file) => relative(SRC_DIR, file).split(sep).join("/"));
    expect(offenders).toEqual([]);
  });
});
