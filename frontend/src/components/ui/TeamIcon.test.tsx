/**
 * FRONTEND-031: `TeamIcon`, a team's abbreviation in black on its inner
 * colour inside a ring of its outer colour, drawn in CSS with no image.
 *
 * The interface this file pins (`components/ui/TeamIcon.tsx`):
 *
 * ```ts
 * interface TeamIconProps {
 *   // The stored abbreviation (BOS, LAL). Unknown, null or missing renders
 *   // the neutral form and never throws.
 *   abbreviation: string | null | undefined;
 *   size: "sm" | "lg"; // 32 px and 64 px
 *   // Only where the icon stands alone: it is then `role="img"` named by
 *   // this (the team's name). Without it the icon is `aria-hidden="true"`,
 *   // because the team's name or abbreviation is adjacent text.
 *   label?: string;
 * }
 * export function TeamIcon(props: TeamIconProps): JSX.Element;
 * ```
 *
 * jsdom computes no CSS (`verification.md` §1), so the styling is read from
 * `TeamIcon.module.css` and `styles/tokens.css` on disk and applied to the
 * rendered element by its classes: each rule's selector, with its module
 * classes swapped for the names the component used, is matched with
 * `Element.matches`, in source order, and `var()` is resolved against the
 * rules' own custom properties and the tokens, per theme. So the class
 * names, and whether a colour comes straight from a token or through a
 * custom property of the module's own, are the implementation's choice.
 *
 * Contrast is WCAG 2.1, unrounded (`test/css.ts`). The fit of three letters
 * at sm is a deterministic proxy, not a rendering: the letters' advance
 * widths from the Helvetica/Arial AFM metrics (bold at weight 600 or more),
 * at the declared font size and letter spacing, must fit the chord of the
 * circle inside the ring at the letters' cap height. The browser rows
 * (contact sheet, 200% text) are what confirm it on screen.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TEAM_COLORS } from "../../lib/teamColors";
import {
  DARK_SCHEME,
  SRC_DIR,
  contrastRatio,
  isAtRule,
  mediaRootCustomProperties,
  normaliseHex,
  parseCss,
  relativeLuminance,
  rootCustomProperties,
  selectors,
  type CssBlock,
  type Declaration,
} from "../../test/css";
import { TeamIcon } from "./TeamIcon";
import styles from "./TeamIcon.module.css";

// ---------------------------------------------------------------- the data

/** The brief's palette, by key (also `styles/tokens.test.ts`'s). */
const INNER_HEX: Record<string, string> = {
  gold: "#ffd23f",
  orange: "#f58a1f",
  red: "#fa7b82",
  green: "#7cc24b",
  sky: "#4fa8f7",
  lavender: "#a98de6",
  silver: "#d3d8dc",
  teal: "#26d0c0",
};
const OUTER_HEX: Record<string, string> = {
  blue: "#0a4a9a",
  crimson: "#9b0f26",
  black: "#0a0a0a",
  purple: "#6a1b8f",
  forest: "#0b5d2e",
};

/** The brief's thirty teams, pinned pair by pair in `lib/teamColors.test.ts`. */
const TEAMS = [
  "ATL",
  "BKN",
  "BOS",
  "CHA",
  "CHI",
  "CLE",
  "DAL",
  "DEN",
  "DET",
  "GSW",
  "HOU",
  "IND",
  "LAC",
  "LAL",
  "MEM",
  "MIA",
  "MIL",
  "MIN",
  "NOP",
  "NYK",
  "OKC",
  "ORL",
  "PHI",
  "PHX",
  "POR",
  "SAC",
  "SAS",
  "TOR",
  "UTA",
  "WAS",
];

const SIZES = [
  ["sm", 32],
  ["lg", 64],
] as const;

type Theme = "light" | "dark";
const THEMES: Theme[] = ["light", "dark"];

// ------------------------------------------------------- the CSS, applied

let rulesCache: CssBlock[] | null = null;
const tokensCache = new Map<Theme, Map<string, string>>();

function moduleRules(): CssBlock[] {
  if (rulesCache !== null) return rulesCache;
  const css = readFileSync(
    join(SRC_DIR, "components", "ui", "TeamIcon.module.css"),
    "utf8",
  );
  // Top-level style rules: what applies outside forced colours and print.
  rulesCache = parseCss(css).filter((block) => !isAtRule(block));
  return rulesCache;
}

function tokens(theme: Theme): Map<string, string> {
  const cached = tokensCache.get(theme);
  if (cached !== undefined) return cached;
  const blocks = parseCss(
    readFileSync(join(SRC_DIR, "styles", "tokens.css"), "utf8"),
  );
  const light = rootCustomProperties(blocks);
  const map =
    theme === "light"
      ? light
      : new Map([...light, ...mediaRootCustomProperties(blocks, DARK_SCHEME)]);
  tokensCache.set(theme, map);
  return map;
}

const CLASS = /\.(-?[_a-zA-Z][\w-]*)/g;

/** `selector` with each module class swapped for the name the component used. */
function compiled(selector: string): string | null {
  let unknown = false;
  const out = selector.replace(CLASS, (_, local: string) => {
    const hashed = (styles as Record<string, string | undefined>)[local];
    if (typeof hashed !== "string" || hashed === "") unknown = true;
    return `.${hashed}`;
  });
  return unknown ? null : out;
}

function matches(element: Element, selector: string): boolean {
  const real = compiled(selector);
  if (real === null) return false;
  try {
    return element.matches(real);
  } catch {
    return false; // a pseudo-element or a selector jsdom cannot evaluate
  }
}

/** The declarations of every module rule `element` matches, in source order. */
function declarationsOf(element: Element): Declaration[] {
  return moduleRules()
    .filter((rule) =>
      selectors(rule).some((selector) => matches(element, selector)),
    )
    .flatMap((rule) => rule.declarations);
}

/** The custom properties `element` sees: the tokens, then its ancestors' own. */
function customProperties(
  element: Element,
  root: Element,
  theme: Theme,
): Map<string, string> {
  const chain: Element[] = [];
  for (
    let node: Element | null = element;
    node !== null;
    node = node === root ? null : node.parentElement
  )
    chain.unshift(node);
  const vars = new Map(tokens(theme));
  for (const node of chain)
    for (const { property, value } of declarationsOf(node))
      if (property.startsWith("--")) vars.set(property, value);
  return vars;
}

const VAR = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/;

/** `value` with every `var()` replaced, recursively. */
function resolve(value: string, vars: Map<string, string>): string {
  let out = value;
  for (let guard = 0; VAR.test(out); guard += 1) {
    if (guard > 50) throw new Error(`var() cycle in ${value}`);
    out = out.replace(VAR, (_, name: string, fallback?: string) => {
      const found = vars.get(name) ?? fallback;
      if (found === undefined) throw new Error(`${name} is not declared`);
      return found;
    });
  }
  return out.toLowerCase();
}

function hexesIn(value: string): string[] {
  return [...value.matchAll(/#(?:[0-9a-f]{6}|[0-9a-f]{3})(?![\w-])/gi)].map(
    ([hex]) => normaliseHex(hex),
  );
}

interface Resolved {
  element: Element;
  property: string;
  value: string;
}

/** Every non-custom declaration on the icon and its descendants, resolved. */
function resolvedIn(root: Element, theme: Theme): Resolved[] {
  return [root, ...root.querySelectorAll("*")].flatMap((element) => {
    const vars = customProperties(element, root, theme);
    return declarationsOf(element)
      .filter(({ property }) => !property.startsWith("--"))
      .map(({ property, value }) => ({
        element,
        property,
        value: resolve(value, vars),
      }));
  });
}

/** The last declared value of an inherited property, from `element` up to `root`. */
function inherited(
  element: Element,
  root: Element,
  property: RegExp,
  theme: Theme,
): string | undefined {
  for (
    let node: Element | null = element;
    node !== null;
    node = node === root ? null : node.parentElement
  ) {
    const found = declarationsOf(node).filter((d) => property.test(d.property));
    if (found.length > 0)
      return resolve(
        found[found.length - 1].value,
        customProperties(node, root, theme),
      );
  }
  return undefined;
}

const FILL = /^background(-color)?$/;
const EDGE =
  /^(border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|box-shadow|outline(-color)?)$/;

function fills(root: Element, theme: Theme): string[] {
  return resolvedIn(root, theme)
    .filter(({ property }) => FILL.test(property))
    .flatMap(({ value }) => hexesIn(value));
}

function edges(root: Element, theme: Theme): Resolved[] {
  return resolvedIn(root, theme).filter(({ property }) => EDGE.test(property));
}

/** The deepest element whose own text is the abbreviation. */
function textHolder(root: Element, text: string): Element {
  const all = [root, ...root.querySelectorAll("*")];
  const holders = all.filter((el) => (el.textContent ?? "").trim() === text);
  const holder = holders[holders.length - 1];
  if (holder === undefined) throw new Error(`no element holds "${text}"`);
  return holder;
}

function textColour(root: Element, text: string, theme: Theme): string {
  const value = inherited(textHolder(root, text), root, /^color$/, theme);
  if (value === undefined) throw new Error("the icon declares no text colour");
  const [hex] = hexesIn(value);
  if (hex === undefined) throw new Error(`text colour ${value} is not a hex`);
  return hex;
}

/** A length in px: `px`, `rem` (16 px), or `em` of `base`. */
function px(length: string, base = 16): number {
  const match = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(length.trim());
  if (match === null) throw new Error(`cannot read the length "${length}"`);
  const n = Number(match[1]);
  if (match[2] === "rem") return n * 16;
  if (match[2] === "em") return n * base;
  return n;
}

/** Every length in a resolved value, in px (its colours removed first). */
function lengthsIn(value: string): number[] {
  const bare = value.replace(/#[0-9a-f]+/gi, " ");
  return [...bare.matchAll(/(?<![\w.-])(-?\d*\.?\d+)(px|rem|em)?(?![\w%])/g)]
    .map(([whole]) => px(whole))
    .filter((n) => Number.isFinite(n));
}

function iconOf(container: HTMLElement): Element {
  const icon = container.firstElementChild;
  if (icon === null) throw new Error("TeamIcon rendered nothing");
  return icon;
}

function renderIcon(
  abbreviation: string | null | undefined,
  size: "sm" | "lg" = "sm",
  label?: string,
): Element {
  const { container } = render(
    <TeamIcon abbreviation={abbreviation} size={size} label={label} />,
  );
  return iconOf(container);
}

// ------------------------------------------------- the advance widths proxy

/** Helvetica / Arial AFM advance widths, capitals, per 1000 em. */
const REGULAR: Record<string, number> = {
  A: 667,
  B: 667,
  C: 722,
  D: 722,
  E: 667,
  F: 611,
  G: 778,
  H: 722,
  I: 278,
  J: 500,
  K: 667,
  L: 556,
  M: 833,
  N: 722,
  O: 778,
  P: 667,
  Q: 778,
  R: 722,
  S: 667,
  T: 611,
  U: 722,
  V: 667,
  W: 944,
  X: 667,
  Y: 667,
  Z: 611,
};
const BOLD: Record<string, number> = {
  A: 722,
  B: 722,
  C: 722,
  D: 722,
  E: 667,
  F: 611,
  G: 778,
  H: 722,
  I: 278,
  J: 556,
  K: 722,
  L: 611,
  M: 833,
  N: 722,
  O: 778,
  P: 667,
  Q: 778,
  R: 722,
  S: 667,
  T: 611,
  U: 722,
  V: 667,
  W: 944,
  X: 667,
  Y: 667,
  Z: 611,
};
/** Helvetica's cap height, per 1000 em. */
const CAP_HEIGHT = 718;

// =================================================================== tests

describe("TeamIcon renders text, not an image", () => {
  it.each(SIZES)("shows the abbreviation as text at %s", (size) => {
    const icon = renderIcon("BOS", size);
    expect(icon).toHaveTextContent("BOS");
  });

  it("renders no img, svg, picture, object or iframe, and nothing with a src", () => {
    const { container } = render(
      <>
        {TEAMS.map((team) => (
          <TeamIcon key={team} abbreviation={team} size="lg" />
        ))}
        <TeamIcon abbreviation={null} size="sm" />
      </>,
    );
    expect(
      container.querySelectorAll("img, svg, picture, object, iframe, image"),
    ).toHaveLength(0);
    expect(container.querySelectorAll("[src], [srcset], [href]")).toHaveLength(
      0,
    );
    expect(container.innerHTML).not.toMatch(/url\(|https?:/i);
  });
});

describe("TeamIcon's name (A14)", () => {
  it("is aria-hidden where the team is adjacent text (no label)", () => {
    const icon = renderIcon("BOS");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("standing alone, is an image named by the team's name", () => {
    renderIcon("BOS", "lg", "Boston Celtics");
    const image = screen.getByRole("img", { name: "Boston Celtics" });
    expect(image).not.toHaveAttribute("aria-hidden");
    expect(image.closest("[aria-hidden='true']")).toBeNull();
  });
});

describe.each(THEMES)("TeamIcon's colours, %s", (theme) => {
  const cases = TEAMS.flatMap((team) =>
    SIZES.map(([size]) => [team, size] as const),
  );

  it.each(cases)("%s at %s: the inner colour fills it", (team, size) => {
    const { inner } = TEAM_COLORS[team];
    const found = fills(renderIcon(team, size), theme);
    expect(found).toContain(INNER_HEX[inner]);
    const others = Object.values(INNER_HEX).filter(
      (hex) => hex !== INNER_HEX[inner],
    );
    expect(found.filter((hex) => others.includes(hex))).toEqual([]);
  });

  it.each(cases)("%s at %s: the outer colour is its ring", (team, size) => {
    const { outer } = TEAM_COLORS[team];
    const ring = edges(renderIcon(team, size), theme).filter(({ value }) =>
      hexesIn(value).includes(OUTER_HEX[outer]),
    );
    expect(
      ring.length,
      `no border, outline or shadow in ${outer}`,
    ).toBeGreaterThan(0);
  });

  it.each(cases)(
    "%s at %s: black text on the fill meets 4.5:1, unrounded",
    (team, size) => {
      const icon = renderIcon(team, size);
      const text = textColour(icon, team, theme);
      const fill = INNER_HEX[TEAM_COLORS[team].inner];
      // Black: as dark as the palette's own black or darker.
      expect(relativeLuminance(text)).toBeLessThanOrEqual(
        relativeLuminance("#0a0a0a"),
      );
      expect(contrastRatio(text, fill)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(TEAMS)(
    "%s: a 1 px --color-border hairline sits outside the ring",
    (team) => {
      const border = normaliseHex(
        resolve("var(--color-border)", tokens(theme)),
      );
      const { outer } = TEAM_COLORS[team];
      const all = edges(renderIcon(team, "sm"), theme);
      expect(hairline(all, border, OUTER_HEX[outer])).toBe(true);
    },
  );
});

/**
 * A hairline in `border` outside the ring in `outer`: a 1 px border or
 * outline in it, or a box-shadow layer in it whose spread is the ring's
 * plus 1 px.
 */
function hairline(all: Resolved[], border: string, outer: string): boolean {
  const onePx = all.some(
    ({ property, value }) =>
      property !== "box-shadow" &&
      hexesIn(value).includes(border) &&
      lengthsIn(value).some((n) => n === 1),
  );
  if (onePx) return true;
  const layers = all
    .filter(({ property }) => property === "box-shadow")
    .flatMap(({ value }) => splitTopLevel(value));
  const spread = (layer: string) => {
    const lengths = lengthsIn(layer);
    return lengths.length >= 4 ? lengths[3] : 0;
  };
  const ringSpreads = layers
    .filter((layer) => hexesIn(layer).includes(outer))
    .map(spread);
  const borderLayers = layers.filter((layer) =>
    hexesIn(layer).includes(border),
  );
  const ringWidth = Math.max(
    0,
    ...all
      .filter(
        ({ property, value }) =>
          property.startsWith("border") && hexesIn(value).includes(outer),
      )
      .flatMap(({ value }) => lengthsIn(value)),
  );
  return borderLayers.some((layer) => {
    const s = spread(layer);
    return (
      ringSpreads.some((r) => Math.abs(s - r - 1) < 0.01) ||
      // A ring drawn as a border, the hairline a 1 px shadow outside it.
      (ringWidth > 0 && Math.abs(s - 1) < 0.01)
    );
  });
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of value) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += character;
  }
  parts.push(current.trim());
  return parts;
}

describe("TeamIcon's sizes", () => {
  it.each(SIZES)("%s is %i px across", (size, across) => {
    const declared = resolvedIn(renderIcon("BOS", size), "light");
    const of = (property: RegExp) =>
      declared
        .filter((d) => property.test(d.property))
        .flatMap((d) => {
          try {
            return [px(d.value)];
          } catch {
            return [];
          }
        });
    expect(of(/^(width|inline-size)$/)).toContain(across);
    expect(of(/^(height|block-size)$/)).toContain(across);
  });

  it("draws a circle", () => {
    const declared = resolvedIn(renderIcon("BOS"), "light");
    expect(
      declared.some(
        ({ property, value }) =>
          property === "border-radius" &&
          (/50%/.test(value) || lengthsIn(value).some((n) => n >= 16)),
      ),
    ).toBe(true);
  });
});

describe("three letters fit inside the ring at sm (the advance-width proxy)", () => {
  it("the proxy puts W-heavy GSW wider than BOS", () => {
    const width = (text: string) =>
      [...text].reduce((sum, letter) => sum + BOLD[letter], 0);
    expect(width("GSW")).toBeGreaterThan(width("BOS"));
    expect(TEAMS).toEqual(expect.arrayContaining(["GSW", "WAS", "MEM"]));
  });

  it.each(TEAMS)("%s fits at sm", (team) => {
    const icon = renderIcon(team, "sm");
    const holder = textHolder(icon, team);
    const fontSize = px(
      inherited(holder, icon, /^font-size$/, "light") ?? "1rem",
    );
    const weight = Number(
      inherited(holder, icon, /^font-weight$/, "light") ?? "400",
    );
    const spacingValue = inherited(holder, icon, /^letter-spacing$/, "light");
    const spacing =
      spacingValue === undefined || spacingValue === "normal"
        ? 0
        : px(spacingValue, fontSize);
    const metrics = weight >= 600 ? BOLD : REGULAR;
    const letters = [...team];
    const textWidth =
      (letters.reduce((sum, letter) => sum + metrics[letter], 0) / 1000) *
        fontSize +
      spacing * (letters.length - 1);

    // The ring's thickness: the largest length in a declaration drawn in
    // the team's outer colour (a border's width, a shadow's spread).
    const outer = OUTER_HEX[TEAM_COLORS[team].outer];
    const ring = Math.max(
      0,
      ...edges(icon, "light")
        .filter(({ value }) => hexesIn(value).includes(outer))
        .flatMap(({ value }) => lengthsIn(value)),
    );
    const radius = 16 - ring;
    const halfCap = ((CAP_HEIGHT / 1000) * fontSize) / 2;
    const chord = 2 * Math.sqrt(radius * radius - halfCap * halfCap);

    expect(
      textWidth,
      `${team}: ${textWidth.toFixed(2)} px of text at ${fontSize} px, weight ${weight}, in a ${chord.toFixed(2)} px chord (ring ${ring} px)`,
    ).toBeLessThanOrEqual(chord);
  });
});

describe("an unknown or missing team is the neutral form", () => {
  const UNKNOWN: [string, string | null | undefined][] = [
    ["an unknown abbreviation", "XYZ"],
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
  ];

  it.each(UNKNOWN)("%s renders without throwing", (_name, abbreviation) => {
    expect(() => renderIcon(abbreviation)).not.toThrow();
  });

  describe.each(THEMES)("%s", (theme) => {
    const vars = () => tokens(theme);
    const token = (name: string) =>
      normaliseHex(resolve(`var(${name})`, vars()));

    it.each(UNKNOWN)(
      "%s: --color-surface-muted fill, --color-border ring, no team colour",
      (_name, abbreviation) => {
        const icon = renderIcon(abbreviation);
        const found = fills(icon, theme);
        expect(found).toContain(token("--color-surface-muted"));
        expect(
          edges(icon, theme).some(({ value }) =>
            hexesIn(value).includes(token("--color-border")),
          ),
        ).toBe(true);
        const team = [...Object.values(INNER_HEX), ...Object.values(OUTER_HEX)];
        const used = resolvedIn(icon, theme).flatMap(({ value }) =>
          hexesIn(value),
        );
        expect(used.filter((hex) => team.includes(hex))).toEqual([]);
      },
    );

    it("XYZ's text is --color-text", () => {
      const icon = renderIcon("XYZ");
      expect(textColour(icon, "XYZ", theme)).toBe(token("--color-text"));
    });
  });
});
