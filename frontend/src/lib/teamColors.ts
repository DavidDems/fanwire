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

export const INNER_COLORS: readonly PaletteColor[] = [
  { key: "gold", name: "Gold" },
  { key: "orange", name: "Orange" },
  { key: "red", name: "Red" },
  { key: "green", name: "Green" },
  { key: "sky", name: "Sky Blue" },
  { key: "lavender", name: "Lavender" },
  { key: "silver", name: "Silver" },
  { key: "teal", name: "Teal" },
];

export const OUTER_COLORS: readonly PaletteColor[] = [
  { key: "blue", name: "Blue" },
  { key: "crimson", name: "Crimson" },
  { key: "black", name: "Black" },
  { key: "purple", name: "Purple" },
  { key: "forest", name: "Forest Green" },
];

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
