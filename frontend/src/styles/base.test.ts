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

/**
 * UI-010: the soft-filled form controls, pinned from base.css.
 *
 * The controls are `input:not([type="checkbox"], [type="radio"],
 * [type="file"])`, `select` and `textarea`. At rest: no border, the field
 * fill, a 12 px radius, --space-4 either side, 3rem tall for the single-line
 * ones, and a 1 px bottom rule in --color-border-strong (WCAG 1.4.11: the fill
 * alone is under 3:1, see tokens.test.ts) drawn either as an inset box-shadow
 * or as a border-bottom. On focus the fill lightens and the ring appears, and
 * a focus rule touches no border, padding, size or margin property, which is
 * how "focusing moves nothing" (an identical border box) is pinned from the
 * CSS. Invalid is a --color-danger ring, never a border change.
 */
describe("soft-filled form controls (UI-010)", () => {
  type Kind = "input" | "select" | "textarea";
  const KINDS: Kind[] = ["input", "select", "textarea"];
  const SINGLE_LINE: Kind[] = ["input", "select"];

  const BORDER_STRONG = /var\(\s*--color-border-strong\s*\)/;
  const FIELD = /var\(\s*--color-field\s*\)/;
  const FIELD_FOCUS = /var\(\s*--color-field-focus\s*\)/;
  const FOCUS_COLOUR = /var\(\s*--(focus-ring|color-focus)\s*\)/;
  const DANGER = /var\(\s*--color-danger\s*\)/;
  const INVALID = /\[aria-invalid=(["']?)true\1\]/;

  function tokens(): Map<string, string> {
    return rootCustomProperties(parseCss(readSrcFile(TOKENS)));
  }

  /** The control a selector targets, or null; a checkbox, radio or file input is not one. */
  function kindOf(selector: string): Kind | null {
    if (/^input(?![\w-])/.test(selector) && !/^input\[type/.test(selector))
      return "input";
    if (/^select(?![\w-])/.test(selector)) return "select";
    if (/^textarea(?![\w-])/.test(selector)) return "textarea";
    return null;
  }

  /** What is left of a control selector once the element and its `:not(…)` are taken off. */
  function stateOf(selector: string): string {
    return selector
      .replace(/^(input|select|textarea)/, "")
      .replace(/^:not\((?:[^()]|\([^()]*\))*\)/, "");
  }

  /** A state-only selector that reaches every control: `[aria-invalid="true"]`, `:disabled`, `:focus…`. */
  function isBareState(selector: string): boolean {
    return /^\*?(\[aria-invalid|:disabled|:focus)/.test(selector);
  }

  /** Rules at any depth that style a control, or every control in some state. */
  function controlRules(): CssBlock[] {
    return styleRules(base()).filter((rule) =>
      selectors(rule).some(
        (selector) => kindOf(selector) !== null || isBareState(selector),
      ),
    );
  }

  /** Top-level rules that style `kind` at rest, in document order. */
  function restRules(kind: Kind): CssBlock[] {
    return base().filter(
      (rule) =>
        !isAtRule(rule) &&
        selectors(rule).some(
          (selector) => kindOf(selector) === kind && stateOf(selector) === "",
        ),
    );
  }

  /** The rest declarations for `kind`, in cascade order (later rules after earlier ones). */
  function restDeclarations(kind: Kind): { property: string; value: string }[] {
    return restRules(kind).flatMap((rule) => rule.declarations);
  }

  function restValue(kind: Kind, property: string): string | undefined {
    return [...restDeclarations(kind)]
      .reverse()
      .find((declaration) => declaration.property === property)?.value;
  }

  /** Splits a value on top-level spaces, so `calc(a + b)` stays one part. */
  function parts(value: string): string[] {
    const found: string[] = [];
    let depth = 0;
    let current = "";
    for (const character of value.trim()) {
      if (character === "(") depth += 1;
      if (character === ")") depth -= 1;
      if (/\s/.test(character) && depth === 0) {
        if (current !== "") found.push(current);
        current = "";
        continue;
      }
      current += character;
    }
    if (current !== "") found.push(current);
    return found;
  }

  /** The inline start and end padding at rest, applying shorthands and longhands in order. */
  function inlinePadding(kind: Kind): { start?: string; end?: string } {
    let start: string | undefined;
    let end: string | undefined;
    for (const { property, value } of restDeclarations(kind)) {
      const values = parts(value);
      if (property === "padding") {
        end = values[1] ?? values[0];
        start = values[3] ?? values[1] ?? values[0];
      } else if (property === "padding-inline") {
        start = values[0];
        end = values[1] ?? values[0];
      } else if (
        property === "padding-left" ||
        property === "padding-inline-start"
      ) {
        start = value;
      } else if (
        property === "padding-right" ||
        property === "padding-inline-end"
      ) {
        end = value;
      }
    }
    return {
      start: start === undefined ? undefined : normaliseValue(start),
      end: end === undefined ? undefined : normaliseValue(end),
    };
  }

  type Side = "top" | "right" | "bottom" | "left";
  const SIDES: Side[] = ["top", "right", "bottom", "left"];

  /** Each side's border at rest, applying shorthands and longhands in order. */
  function borders(kind: Kind): Record<Side, string> {
    const sides: Record<Side, string> = {
      top: "",
      right: "",
      bottom: "",
      left: "",
    };
    const set = (which: Side[], value: string) => {
      for (const side of which) sides[side] = normaliseValue(value);
    };
    for (const { property, value } of restDeclarations(kind)) {
      if (property === "border") set(SIDES, value);
      else if (property === "border-width" || property === "border-style") {
        if (parts(value).every((part) => /^(0|0px|none)$/i.test(part)))
          set(SIDES, "0");
      } else if (property === "border-block") set(["top", "bottom"], value);
      else if (property === "border-inline") set(["left", "right"], value);
      else if (property === "border-block-start") set(["top"], value);
      else if (property === "border-block-end") set(["bottom"], value);
      else if (property === "border-inline-start") set(["left"], value);
      else if (property === "border-inline-end") set(["right"], value);
      else {
        const side = /^border-(top|right|bottom|left)$/.exec(property);
        if (side !== null) set([side[1] as Side], value);
      }
    }
    return sides;
  }

  const NO_BORDER = /(^|\s)(0|0px|none)(\s|$)/;
  const BOTTOM_RULE = normaliseValue("1px solid var(--color-border-strong)");

  function bottomRuleIsABorder(kind: Kind): boolean {
    return borders(kind).bottom === BOTTOM_RULE;
  }

  describe.each(KINDS)("%s at rest", (kind) => {
    it("is styled by a top-level rule in base.css", () => {
      expect(
        restRules(kind).length,
        `no rest rule for ${kind}`,
      ).toBeGreaterThan(0);
    });

    it("has no visible border on the top, left or right", () => {
      const sides = borders(kind);
      for (const side of ["top", "right", "left"] as Side[]) {
        expect(
          NO_BORDER.test(sides[side]),
          `${kind} border-${side} at rest is "${sides[side] || "(not removed)"}"`,
        ).toBe(true);
      }
    });

    it("has a 1px bottom rule in --color-border-strong, as an inset box-shadow or a border-bottom", () => {
      const sides = borders(kind);
      const shadow = restValue(kind, "box-shadow") ?? "";
      const asShadow = /\binset\b/.test(shadow) && BORDER_STRONG.test(shadow);
      const asBorder = sides.bottom === BOTTOM_RULE;
      expect(
        asShadow || asBorder,
        `${kind}: box-shadow "${shadow}", border-bottom "${sides.bottom}"`,
      ).toBe(true);
      if (!asBorder) {
        expect(
          NO_BORDER.test(sides.bottom),
          `${kind} border-bottom "${sides.bottom || "(not removed)"}" beside the shadow rule`,
        ).toBe(true);
      }
    });

    it("is filled with var(--color-field)", () => {
      const fill =
        restValue(kind, "background-color") ??
        restValue(kind, "background") ??
        "";
      expect(fill).toMatch(FIELD);
    });

    it("has a border-radius of var(--radius-lg)", () => {
      expect(normaliseValue(restValue(kind, "border-radius") ?? "")).toBe(
        "var(--radius-lg)",
      );
    });

    it("has var(--space-4) of padding at the inline start", () => {
      expect(inlinePadding(kind).start).toBe("var(--space-4)");
    });
  });

  it.each(["input", "textarea"] as Kind[])(
    "%s has var(--space-4) of padding at the inline end",
    (kind) => {
      expect(inlinePadding(kind).end).toBe("var(--space-4)");
    },
  );

  it.each(SINGLE_LINE)("%s is at least 3rem tall", (kind) => {
    const minHeight = restValue(kind, "min-height");
    expect(minHeight, `${kind} has no min-height`).toBeDefined();
    expect(normaliseValue(resolveValue(minHeight ?? "", tokens(), null))).toBe(
      "3rem",
    );
  });

  describe("the select's chevron", () => {
    it("drops the native arrow (appearance: none)", () => {
      expect(normaliseValue(restValue("select", "appearance") ?? "")).toBe(
        "none",
      );
    });

    it("is drawn in CSS with linear-gradients, no url()", () => {
      const image =
        restValue("select", "background-image") ??
        restValue("select", "background") ??
        "";
      expect(image).toMatch(/linear-gradient\(/);
      expect(image).not.toMatch(/url\(/i);
    });

    it("keeps the text clear of it: the end padding is more than var(--space-4)", () => {
      const end = inlinePadding("select").end;
      expect(end, "select has no inline-end padding").toBeDefined();
      const value = end ?? "";
      const space = /^var\(--space-(\d)\)$/.exec(value);
      const rem = /^(\d*\.?\d+)rem$/.exec(value);
      const larger =
        (space !== null && Number(space[1]) > 4) ||
        (rem !== null && Number(rem[1]) > 1) ||
        (/^calc\(/.test(value) && value.includes("+"));
      expect(
        larger,
        `select's inline-end padding "${value}" must be more than var(--space-4): a larger space token, more than 1rem, or a calc(… + …)`,
      ).toBe(true);
    });
  });

  describe("focus", () => {
    /** Every control rule with a :focus or :focus-visible selector. */
    function focusRules(): CssBlock[] {
      return controlRules().filter((rule) =>
        selectors(rule).some((selector) => selector.includes(":focus")),
      );
    }

    function focusRulesFor(kind: Kind): CssBlock[] {
      return styleRules(base()).filter((rule) =>
        selectors(rule).some(
          (selector) =>
            kindOf(selector) === kind && selector.includes(":focus"),
        ),
      );
    }

    const MOVES =
      /^(border|padding|margin|width|height|min-height|max-height|min-width|max-width|inline-size|block-size|min-inline-size|min-block-size)(-|$)/;

    it.each(KINDS)("%s's focus fill is var(--color-field-focus)", (kind) => {
      const fills = focusRulesFor(kind).flatMap((rule) =>
        [
          declared(rule, "background-color"),
          declared(rule, "background"),
        ].filter((value): value is string => value !== undefined),
      );
      expect(
        fills.some((value) => FIELD_FOCUS.test(value)),
        `${kind}:focus fills: ${JSON.stringify(fills)}`,
      ).toBe(true);
    });

    it.each(KINDS)(
      "%s's focus ring is --focus-ring / --color-focus, as an outline or a box-shadow",
      (kind) => {
        const rules = focusRulesFor(kind);
        const ring = rules.some((rule) =>
          ["outline", "outline-color", "box-shadow"].some((property) =>
            FOCUS_COLOUR.test(declared(rule, property) ?? ""),
          ),
        );
        // Or the control leaves the outline alone and the universal
        // :focus-visible outline (pinned above) draws the ring.
        const leavesOutline = rules.every((rule) =>
          rule.declarations.every(
            ({ property }) => !property.startsWith("outline"),
          ),
        );
        expect(ring || leavesOutline).toBe(true);
      },
    );

    it("changes no border, padding, size or margin property (focusing moves nothing)", () => {
      const offenders = focusRules().flatMap((rule) =>
        rule.declarations
          .filter(({ property }) => MOVES.test(property))
          .map(
            ({ property, value }) =>
              `${rule.prelude} { ${property}: ${value} }`,
          ),
      );
      expect(offenders).toEqual([]);
    });
  });

  describe("invalid", () => {
    function invalidRules(): CssBlock[] {
      return controlRules().filter((rule) =>
        selectors(rule).some((selector) => INVALID.test(selector)),
      );
    }

    it('draws a --color-danger ring at rest on [aria-invalid="true"], as a box-shadow or an outline', () => {
      const atRest = invalidRules().filter((rule) =>
        selectors(rule).some(
          (selector) => INVALID.test(selector) && !selector.includes(":focus"),
        ),
      );
      const ring = atRest.some((rule) =>
        ["box-shadow", "outline", "outline-color"].some((property) =>
          DANGER.test(declared(rule, property) ?? ""),
        ),
      );
      expect(ring, 'no danger ring on [aria-invalid="true"] at rest').toBe(
        true,
      );
    });

    it("changes no border width or style, padding, size or margin", () => {
      const CHANGES_BOX =
        /^(border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-(width|style))?|padding(-.*)?|margin(-.*)?|width|height|min-height)$/;
      const offenders = invalidRules().flatMap((rule) =>
        rule.declarations
          .filter(({ property }) => CHANGES_BOX.test(property))
          .map(
            ({ property, value }) =>
              `${rule.prelude} { ${property}: ${value} }`,
          ),
      );
      expect(offenders).toEqual([]);
    });

    it("does not recolour a border-bottom rule away from --color-border-strong", () => {
      const recolours = KINDS.some(bottomRuleIsABorder)
        ? invalidRules().flatMap((rule) =>
            rule.declarations
              .filter(({ property }) =>
                /^border(-bottom|-block-end)?-color$/.test(property),
              )
              .map(
                ({ property, value }) =>
                  `${rule.prelude} { ${property}: ${value} }`,
              ),
          )
        : [];
      expect(recolours).toEqual([]);
    });
  });

  it("keeps the bottom rule in every state: a control rule that sets box-shadow includes --color-border-strong", () => {
    const offenders = controlRules()
      .filter((rule) => declared(rule, "box-shadow") !== undefined)
      .filter((rule) => !BORDER_STRONG.test(declared(rule, "box-shadow") ?? ""))
      .map(
        (rule) =>
          `${rule.prelude} { box-shadow: ${declared(rule, "box-shadow")} }`,
      );
    expect(offenders).toEqual([]);
  });

  it("disables with --opacity-disabled and cursor: not-allowed", () => {
    const disabled = styleRules(base()).filter((rule) =>
      selectors(rule).some((selector) => selector.includes(":disabled")),
    );
    expect(
      disabled.some(
        (rule) =>
          normaliseValue(declared(rule, "opacity") ?? "") ===
            "var(--opacity-disabled)" &&
          normaliseValue(declared(rule, "cursor") ?? "") === "not-allowed",
      ),
    ).toBe(true);
  });

  it("transitions a control only on var(--duration-fast), which reduced motion zeroes", () => {
    const offenders = controlRules().flatMap((rule) =>
      rule.declarations
        .filter(({ property }) => /^transition(-duration)?$/.test(property))
        .filter(
          ({ value }) =>
            /(?<![\w-])\d*\.?\d+m?s\b/.test(
              value.replace(/var\([^)]*\)/g, ""),
            ) || /--duration-(?!fast\b)/.test(value),
        )
        .map(
          ({ property, value }) => `${rule.prelude} { ${property}: ${value} }`,
        ),
    );
    expect(offenders).toEqual([]);
  });
});

/**
 * UI-010 Baseline (b): styling makes no network request. No stylesheet under
 * src has a `url(` (an image, a font, a data URI) or an `@import`: every icon
 * and the select's chevron are inline.
 */
describe("no url( or @import in any CSS file under src (UI-010 Baseline b)", () => {
  const SKIP_DIRECTORIES = new Set([
    "node_modules",
    "dist",
    "coverage",
    ".vite",
  ]);
  const FETCHES = /url\(|@import\b/i;

  function cssFiles(directory: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
      const full = join(directory, entry);
      if (statSync(full).isDirectory())
        return SKIP_DIRECTORIES.has(entry) ? [] : cssFiles(full);
      return entry.endsWith(".css") ? [full] : [];
    });
  }

  it.each([
    ['.a { background-image: url("x.svg"); }'],
    [".a { mask: url(data:image/svg+xml,abc); }"],
    ['@import "other.css";'],
    ["@IMPORT url(x.css);"],
  ])("the scan flags %s", (css) => {
    expect(FETCHES.test(css)).toBe(true);
  });

  it("the scan passes a gradient chevron", () => {
    expect(
      FETCHES.test(
        ".a { background-image: linear-gradient(45deg, transparent 50%, currentColor 50%); }",
      ),
    ).toBe(false);
  });

  it("scans the real stylesheets (not vacuously green)", () => {
    const files = cssFiles(SRC_DIR).map((file) =>
      relative(SRC_DIR, file).split(sep).join("/"),
    );
    expect(files).toContain(BASE);
    expect(files).toContain(TOKENS);
    expect(files).toContain("components/FormField.module.css");
  });

  it("finds none", () => {
    const offenders = cssFiles(SRC_DIR)
      .filter((file) => FETCHES.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC_DIR, file).split(sep).join("/"));
    expect(offenders).toEqual([]);
  });
});
