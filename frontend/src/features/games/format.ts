import { format, parseISO } from "date-fns";

/**
 * Every figure the game page shows goes through here, in nba.com's formats:
 * `27:04`, `.462`, `+12`, `8-13`. One module, so the box score, its totals and
 * the line score cannot drift into three spellings of the same number.
 */

const EN_DASH = "–";
const MINUS_SIGN = "−";

/** `m:ss` from `seconds_played`: minutes unpadded and uncapped. */
export function formatMinutes(secondsPlayed: number): string {
  const minutes = Math.floor(secondsPlayed / 60);
  const seconds = secondsPlayed % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The API's fraction (0 to 1) to three places, with no leading zero: `.462`,
 * `1.000`. `null` means nothing was attempted, which is an en dash, not `.000`.
 */
export function formatPercentage(value: number | null): string {
  if (value === null) return EN_DASH;
  const fixed = value.toFixed(3);
  return fixed.startsWith("0.") ? fixed.slice(1) : fixed;
}

/**
 * A per-game average to one place, as the API rounds it: `27.1`, `9.0`.
 * `null` means no game was played, which is an en dash, as a null percentage
 * is. Used by the stats and player pages (`FRONTEND-009`).
 */
export function formatAverage(value: number | null): string {
  return value === null ? EN_DASH : value.toFixed(1);
}

/** A height in inches as feet and inches: 81 → `6'9"`. */
export function formatHeight(inches: number): string {
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

/** Signed: `+12`, `−3` (a true minus sign), and `0` with no sign. */
export function formatPlusMinus(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `${MINUS_SIGN}${Math.abs(value)}`;
  return "0";
}

/** Made and attempted, as `8-13`. */
export function formatMadeAttempted(made: number, attempted: number): string {
  return `${made}-${attempted}`;
}

const PERIODS = ["Q1", "Q2", "Q3", "Q4", "OT", "2OT", "3OT+"] as const;

/**
 * The line-score column headers for `count` figures. The seventh figure is
 * third overtime and later in one ([[0x02-events]] Game), so it is `3OT+`: it
 * is never split into further periods, and a short line is never padded.
 */
export function periodHeaders(count: number): string[] {
  return PERIODS.slice(0, Math.min(count, PERIODS.length));
}

/**
 * The game's calendar date, as stored. The timestamp is naive US-Eastern with
 * no `Z`, and `parseISO` reads such a string as local wall-clock time, so the
 * date shown is the stored one in every viewer's zone: a 22:30 ET game never
 * moves to the next day.
 */
export function formatGameDate(value: string): string {
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? value : format(parsed, "d MMM yyyy");
}
