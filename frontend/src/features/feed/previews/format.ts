import { format, parseISO } from "date-fns";

/**
 * The figures of the three data-link previews (`FRONTEND-014`), written the way
 * the game and player pages write theirs. The feed reaches those pages by
 * address only and never imports them, so the few formats a card needs are
 * kept here rather than borrowed.
 *
 * **A gap is shown, never filled**: a figure the source does not have is an em
 * dash, not a zero.
 */

export const EM_DASH = "—";

/** A game's date as the rest of the app writes it: `15 Jan 2024`. */
export function formatDate(value: string): string {
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? value : format(parsed, "d MMM yyyy");
}

/** `m:ss` from `seconds_played`. */
export function formatMinutes(secondsPlayed: number): string {
  const minutes = Math.floor(secondsPlayed / 60);
  const seconds = secondsPlayed % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** A per-game average to one decimal: `27.1`, or an em dash. */
export function formatAverage(value: number | null): string {
  return value === null ? EM_DASH : value.toFixed(1);
}

/** A shooting percentage as basketball writes it: `.506`, or an em dash. */
export function formatPercentage(value: number | null): string {
  if (value === null) return EM_DASH;
  const fixed = value.toFixed(3);
  return fixed.startsWith("0.") ? fixed.slice(1) : fixed;
}

/** Made and attempted, as `11-19`. */
export function formatMadeAttempted(made: number, attempted: number): string {
  return `${made}-${attempted}`;
}

/** A player's name from its parts, or `Player <id>` when it has none. */
export function playerName(
  firstName: string | null,
  lastName: string | null,
  playerId: number,
): string {
  const name = [firstName, lastName]
    .filter((part): part is string => part !== null && part !== "")
    .join(" ");
  return name === "" ? `Player ${playerId}` : name;
}

/** A game's playoff label and sub-label, joined: "East Finals, Game 4". */
export function gameLabel(
  label: string | null,
  subLabel: string | null = null,
): string {
  return [label, subLabel]
    .filter((part): part is string => part !== null && part !== "")
    .join(", ");
}
