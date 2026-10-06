/**
 * UI-001: the design tokens, and the contrast of every pair the UI uses.
 *
 * Static over `src/styles/tokens.css` (`verification.md` §2a): jsdom computes
 * no CSS, so the file is parsed with the small reader in `src/test/css.ts`,
 * `var()` references are resolved per theme, and WCAG 2.1 contrast is computed
 * **unrounded**. 4.499 fails; `#279ab1` on `#022b3a` (4.501) passes.
 *
 * The token tables and the pair list are copied from
 * `wiki/CodeContext/FrontendUI/tokens.md` (§2, §4, §5, §6, §8). The wiki is not
 * in the test container, so they are hard-coded here; if tokens.md changes,
 * this file changes with it.
 */
import { describe, expect, it } from "vitest";

import {
  DARK_SCHEME,
  contrastRatio,
  mediaBlocks,
  mediaRootCustomProperties,
  normaliseHex,
  normaliseValue,
  parseCss,
  readSrcFile,
  resolveToken,
  rootCustomProperties,
} from "../test/css";

interface Themes {
  light: Map<string, string>;
  dark: Map<string, string>;
}

let cached: Themes | null = null;

/** Parsed lazily, so a missing file fails each test with a readable message. */
function themes(): Themes {
  if (cached === null) {
    const blocks = parseCss(readSrcFile("styles/tokens.css"));
    cached = {
      light: rootCustomProperties(blocks),
      dark: mediaRootCustomProperties(blocks, DARK_SCHEME),
    };
  }
  return cached;
}

type Theme = "light" | "dark";
const THEMES: Theme[] = ["light", "dark"];

/** The colour a token has in a theme, after `var()` resolution, as `#rrggbb`. */
function colour(name: string, theme: Theme): string {
  const { light, dark } = themes();
  return normaliseHex(
    resolveToken(name, light, theme === "dark" ? dark : null),
  );
}

/** tokens.md §2. Brand primitives: fixed, never redeclared per theme. */
const BRAND_PRIMITIVES: Record<string, string> = {
  "--color-ink": "#022b3a",
  "--color-accent": "#1f7a8c",
  "--color-sky": "#bfdbf7",
  "--color-accent-on-dark": "#279ab1",
};

/** tokens.md §4. Semantic colour tokens: [light, dark]. */
const SEMANTIC_COLOURS: Record<string, [string, string]> = {
  "--color-bg": ["#f3f7f9", "#011d28"],
  "--color-surface": ["#ffffff", "#022b3a"],
  "--color-surface-muted": ["#e6eef2", "#173543"],
  "--color-text": ["#022b3a", "#bfdbf7"],
  "--color-text-muted": ["#465f6c", "#8fb0c4"],
  "--color-border": ["#d0dde4", "#1f4757"],
  "--color-border-strong": ["#5c7684", "#6d8fa1"],
  "--color-action": ["#1f7a8c", "#bfdbf7"],
  "--color-action-hover": ["#17606f", "#e1eefb"],
  "--color-on-action": ["#ffffff", "#022b3a"],
  "--color-link": ["#1f7a8c", "#279ab1"],
  "--color-focus": ["#1f7a8c", "#bfdbf7"],
  "--color-danger": ["#9b1c1c", "#ffa08a"],
  "--color-danger-subtle": ["#fdecea", "#2e0f17"],
  "--color-success": ["#1b6e4a", "#6fd39a"],
  "--color-success-subtle": ["#e7f4ec", "#0e2a13"],
  "--color-warning": ["#8a5300", "#efbd71"],
  "--color-warning-subtle": ["#fdf1dc", "#3d350f"],
  "--color-live": ["#c0176f", "#f58cc8"],
  "--color-on-live": ["#ffffff", "#011d28"],
};

/**
 * tokens.md §8, the light (`:root`) values. `--font-sans` is "see
 * typography.md", so only its presence is asserted (`FONT_SANS` below).
 */
const TYPE_SPACE_SHAPE: Record<string, string> = {
  "--font-mono":
    'ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace',
  "--font-size-xs": "0.75rem",
  "--font-size-sm": "0.875rem",
  "--font-size-md": "1rem",
  "--font-size-lg": "1.125rem",
  "--font-size-xl": "1.375rem",
  "--font-size-2xl": "1.75rem",
  "--line-height-tight": "1.2",
  "--line-height-body": "1.5",
  "--font-weight-regular": "400",
  "--font-weight-semibold": "600",
  "--font-weight-bold": "700",
  "--space-1": "0.25rem",
  "--space-2": "0.5rem",
  "--space-3": "0.75rem",
  "--space-4": "1rem",
  "--space-5": "1.5rem",
  "--space-6": "2rem",
  "--space-7": "3rem",
  "--space-8": "4rem",
  "--radius-sm": "4px",
  "--radius-md": "8px",
  "--radius-full": "9999px",
  "--shadow-1": "0 1px 2px rgb(2 43 58 / 0.08), 0 1px 3px rgb(2 43 58 / 0.06)",
  "--shadow-2": "0 4px 12px rgb(2 43 58 / 0.12)",
  "--focus-ring": "2px solid var(--color-focus)",
  "--target-min": "2.75rem",
  "--content-max": "40rem",
  "--duration-fast": "120ms",
  "--duration-base": "200ms",
  "--ease-out": "cubic-bezier(0.2, 0, 0, 1)",
  "--opacity-disabled": "0.55",
};
const FONT_SANS = "--font-sans";

/** tokens.md §8, the shadows' dark values. */
const DARK_SHADOWS: Record<string, string> = {
  "--shadow-1": "none",
  "--shadow-2": "0 0 0 1px var(--color-border-strong)",
};

interface Pair {
  foreground: string;
  background: string;
  minimum: 4.5 | 3;
}

function pair(foreground: string, background: string, minimum: 4.5 | 3): Pair {
  return {
    foreground: `--color-${foreground}`,
    background: `--color-${background}`,
    minimum,
  };
}

/** tokens.md §5. Every pair the components use, with its minimum. */
const MEASURED_PAIRS: Pair[] = [
  pair("text", "bg", 4.5),
  pair("text", "surface", 4.5),
  pair("text", "surface-muted", 4.5),
  pair("text-muted", "bg", 4.5),
  pair("text-muted", "surface", 4.5),
  pair("text-muted", "surface-muted", 4.5),
  pair("link", "bg", 4.5),
  pair("link", "surface", 4.5),
  pair("on-action", "action", 4.5),
  pair("on-action", "action-hover", 4.5),
  pair("action", "bg", 3),
  pair("action", "surface", 3),
  pair("focus", "bg", 3),
  pair("focus", "surface", 3),
  pair("focus", "surface-muted", 3),
  pair("border-strong", "bg", 3),
  pair("border-strong", "surface", 3),
  pair("danger", "surface", 4.5),
  pair("danger", "bg", 4.5),
  pair("danger", "surface-muted", 4.5),
  pair("danger", "danger-subtle", 4.5),
  pair("success", "surface", 4.5),
  pair("success", "success-subtle", 4.5),
  pair("warning", "surface", 4.5),
  pair("warning", "warning-subtle", 4.5),
  pair("on-live", "live", 4.5),
  pair("live", "surface", 3),
  pair("live", "bg", 3),
  pair("sky", "ink", 4.5),
];

/**
 * tokens.md §6. Foreground on background, by value, and what each ban covers.
 * Teal on Jet Black also fails 3:1, so it is banned for non-text as well
 * ("no teal text, icon, border or focus ring on a dark surface"). The others
 * fail text only: Teal on light surface-muted, for instance, is banned as a
 * link but is §5's measured focus-ring pair (4.235, needs 3.0).
 */
interface BannedPair {
  foreground: string;
  background: string;
  bans: "text" | "any";
  why: string;
}
const BANNED_PAIRS: BannedPair[] = [
  {
    foreground: "#1f7a8c",
    background: "#022b3a",
    bans: "any",
    why: "Teal on Jet Black (2.995)",
  },
  {
    foreground: "#1f7a8c",
    background: "#011d28",
    bans: "text",
    why: "Teal on the dark page (3.495)",
  },
  {
    foreground: "#279ab1",
    background: "#173543",
    bans: "text",
    why: "#279ab1 on dark surface-muted (3.899)",
  },
  {
    foreground: "#1f7a8c",
    background: "#e6eef2",
    bans: "text",
    why: "Teal link on light surface-muted (4.235)",
  },
  {
    foreground: "#279ab1",
    background: "#ffffff",
    bans: "text",
    why: "#279ab1 on white (3.311)",
  },
  {
    foreground: "#7f98a5",
    background: "#ffffff",
    bans: "text",
    why: "--neutral-400 as text on white (3.027)",
  },
];

/** Whether a §5 pair, used at its minimum, would be a banned use. */
function isBannedUse(
  foreground: string,
  background: string,
  minimum: 4.5 | 3,
): boolean {
  return BANNED_PAIRS.some(
    (banned) =>
      banned.foreground === foreground &&
      banned.background === background &&
      (banned.bans === "any" || minimum === 4.5),
  );
}

const TEAL = "#1f7a8c";

describe("the contrast arithmetic", () => {
  // Pins the formula independently of tokens.css, so a broken calculation
  // can't make the pair assertions below vacuous.
  it("puts #279ab1 on #022b3a just above 4.5, unrounded", () => {
    const ratio = contrastRatio("#279ab1", "#022b3a");
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeLessThan(4.502);
  });

  it("puts Teal on Jet Black under the 3:1 non-text minimum", () => {
    const ratio = contrastRatio(TEAL, "#022b3a");
    expect(ratio).toBeGreaterThan(2.99);
    expect(ratio).toBeLessThan(3);
  });

  it("gives 21:1 for black on white and is symmetric", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 10);
    expect(contrastRatio("#ffffff", "#022b3a")).toBe(
      contrastRatio("#022b3a", "#ffffff"),
    );
  });

  it.each(BANNED_PAIRS)(
    "measures banned $why as failing what it bans",
    (banned) => {
      const limit = banned.bans === "any" ? 3 : 4.5;
      expect(contrastRatio(banned.foreground, banned.background)).toBeLessThan(
        limit,
      );
    },
  );
});

describe("tokens.css declares every token on :root (tokens.md §2, §4, §8)", () => {
  it.each(Object.entries(BRAND_PRIMITIVES))(
    "declares brand primitive %s as %s",
    (name, value) => {
      expect(themes().light.has(name), `${name} is not declared on :root`).toBe(
        true,
      );
      expect(colour(name, "light")).toBe(value);
    },
  );

  it.each(Object.entries(SEMANTIC_COLOURS))(
    "declares %s on :root as %j (light)",
    (name, [light]) => {
      expect(themes().light.has(name), `${name} is not declared on :root`).toBe(
        true,
      );
      expect(colour(name, "light")).toBe(light);
    },
  );

  it.each(Object.entries(TYPE_SPACE_SHAPE))(
    "declares %s on :root as %s",
    (name, value) => {
      const declared = themes().light.get(name);
      expect(declared, `${name} is not declared on :root`).toBeDefined();
      expect(normaliseValue(declared ?? "")).toBe(normaliseValue(value));
    },
  );

  it("declares --font-sans on :root with a non-empty font stack", () => {
    const declared = themes().light.get(FONT_SANS);
    expect(declared, `${FONT_SANS} is not declared on :root`).toBeDefined();
    expect((declared ?? "").trim()).not.toBe("");
  });
});

describe("tokens.css redeclares every semantic colour under prefers-color-scheme: dark (tokens.md §4)", () => {
  it("has a dark media block", () => {
    const blocks = parseCss(readSrcFile("styles/tokens.css"));
    expect(mediaBlocks(blocks, DARK_SCHEME).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(SEMANTIC_COLOURS))(
    "redeclares %s in dark as %j",
    (name, [, dark]) => {
      expect(themes().dark.has(name), `${name} has no dark value`).toBe(true);
      expect(colour(name, "dark")).toBe(dark);
    },
  );

  it.each(Object.entries(DARK_SHADOWS))(
    "redeclares %s in dark as %s",
    (name, value) => {
      const declared = themes().dark.get(name);
      expect(declared, `${name} has no dark value`).toBeDefined();
      expect(normaliseValue(declared ?? "")).toBe(normaliseValue(value));
    },
  );

  it.each(Object.entries(BRAND_PRIMITIVES))(
    "keeps brand primitive %s fixed in dark (%s)",
    (name, value) => {
      expect(colour(name, "dark")).toBe(value);
    },
  );
});

describe("every measured pair meets its minimum, unrounded, in both themes (tokens.md §5)", () => {
  const cases = THEMES.flatMap((theme) =>
    MEASURED_PAIRS.map(
      ({ foreground, background, minimum }) =>
        [theme, foreground, background, minimum] as const,
    ),
  );

  it.each(cases)(
    "%s: %s on %s meets %s:1",
    (theme, foreground, background, minimum) => {
      const ratio = contrastRatio(
        colour(foreground, theme),
        colour(background, theme),
      );
      expect(
        ratio,
        `${theme} ${foreground} ${colour(foreground, theme)} on ${background} ${colour(background, theme)} is ${ratio}`,
      ).toBeGreaterThanOrEqual(minimum);
    },
  );
});

describe("no banned pair is declared (tokens.md §6, accessibility.md A2/A4)", () => {
  it.each(THEMES)("%s: no measured pair resolves to a banned pair", (theme) => {
    const offenders = MEASURED_PAIRS.filter(
      ({ foreground, background, minimum }) =>
        isBannedUse(
          colour(foreground, theme),
          colour(background, theme),
          minimum,
        ),
    ).map(
      ({ foreground, background }) =>
        `${foreground} ${colour(foreground, theme)} on ${background} ${colour(background, theme)}`,
    );
    expect(offenders).toEqual([]);
  });

  it("never pairs a link with surface-muted", () => {
    // The structural half of the ban: §5 has no such pair, so the list this
    // test checks must not grow one.
    expect(
      MEASURED_PAIRS.filter(
        ({ foreground, background }) =>
          foreground === "--color-link" &&
          background === "--color-surface-muted",
      ),
    ).toEqual([]);
  });

  it("gives no dark-theme token the value Teal #1f7a8c", () => {
    const { light, dark } = themes();
    const names = new Set([...dark.keys(), ...Object.keys(SEMANTIC_COLOURS)]);
    const teal = [...names].filter((name) => {
      const resolved = resolveToken(name, light, dark);
      return (
        /^#[0-9a-f]{3,6}$/i.test(resolved) && normaliseHex(resolved) === TEAL
      );
    });
    expect(teal, "teal is light-theme only (accessibility.md A4)").toEqual([]);
  });
});
