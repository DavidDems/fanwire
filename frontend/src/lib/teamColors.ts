/**
 * FRONTEND-031: the team icon palette and each team's pair, as data.
 *
 * The keys name tokens in `styles/tokens.css` (`--team-inner-<key>`,
 * `--team-outer-<key>`), which hold the values; no colour value lives here.
 * Both lists keep the brief's order: USERS-005's avatar picker reads them.
 */
export interface PaletteColor {
  /** Names the token: `--team-inner-<key>` or `--team-outer-<key>`. */
  key: string;
  name: string;
}

const INNER = [
  { key: "gold", name: "Gold" },
  { key: "orange", name: "Orange" },
  { key: "red", name: "Red" },
  { key: "green", name: "Green" },
  { key: "sky", name: "Sky Blue" },
  { key: "lavender", name: "Lavender" },
  { key: "silver", name: "Silver" },
  { key: "teal", name: "Teal" },
] as const satisfies readonly PaletteColor[];

const OUTER = [
  { key: "blue", name: "Blue" },
  { key: "crimson", name: "Crimson" },
  { key: "black", name: "Black" },
  { key: "purple", name: "Purple" },
  { key: "forest", name: "Forest Green" },
] as const satisfies readonly PaletteColor[];

/**
 * An inner or outer key, as a type, taken from the lists above. USERS-005's
 * avatar stores one of each; the backend's allowlists generate the same
 * unions into `api/schema.d.ts` (`features/profile/avatar-palette-schema.test.ts`
 * pins them equal).
 */
export type InnerColorKey = (typeof INNER)[number]["key"];
export type OuterColorKey = (typeof OUTER)[number]["key"];

/**
 * A list of colours whose element type still names its keys
 * (`(typeof INNER_COLORS)[number]["key"]` is `InnerColorKey`), while a key
 * read off an element is a plain string, so a caller may look up any string
 * in a set of them.
 */
export type Palette<K extends string> = readonly PaletteColor[] & {
  readonly [index: number]: PaletteColor & { readonly key: K };
};

export const INNER_COLORS: Palette<InnerColorKey> = INNER;
export const OUTER_COLORS: Palette<OuterColorKey> = OUTER;

/** A palette's entries, each with its key typed `K` (see `Palette`). */
export function paletteEntries<K extends string>(
  palette: Palette<K>,
): (PaletteColor & { readonly key: K })[] {
  return palette.map((_, index) => palette[index]);
}

/** A team's inner and outer keys, from the two lists above. */
export interface TeamColors {
  inner: string;
  outer: string;
}

const pair = (inner: string, outer: string): TeamColors => ({
  inner,
  outer,
});

/** One row per team, by its stored abbreviation. */
export const TEAM_COLORS: Readonly<Record<string, TeamColors>> = {
  ATL: pair("red", "black"),
  BKN: pair("silver", "black"),
  BOS: pair("green", "forest"),
  CHA: pair("teal", "purple"),
  CHI: pair("red", "black"),
  CLE: pair("gold", "crimson"),
  DAL: pair("sky", "blue"),
  DEN: pair("gold", "blue"),
  DET: pair("sky", "crimson"),
  GSW: pair("gold", "blue"),
  HOU: pair("silver", "crimson"),
  IND: pair("gold", "blue"),
  LAC: pair("red", "blue"),
  LAL: pair("gold", "purple"),
  MEM: pair("sky", "blue"),
  MIA: pair("red", "black"),
  MIL: pair("silver", "forest"),
  MIN: pair("green", "blue"),
  NOP: pair("gold", "blue"),
  NYK: pair("orange", "blue"),
  OKC: pair("sky", "blue"),
  ORL: pair("sky", "black"),
  PHI: pair("red", "blue"),
  PHX: pair("orange", "purple"),
  POR: pair("red", "black"),
  SAC: pair("lavender", "black"),
  SAS: pair("silver", "black"),
  TOR: pair("red", "black"),
  UTA: pair("gold", "black"),
  WAS: pair("red", "blue"),
};

/** A team's pair, or null for an unknown or missing abbreviation. */
export function teamColors(
  abbreviation: string | null | undefined,
): TeamColors | null {
  return abbreviation != null && Object.hasOwn(TEAM_COLORS, abbreviation)
    ? TEAM_COLORS[abbreviation]
    : null;
}
