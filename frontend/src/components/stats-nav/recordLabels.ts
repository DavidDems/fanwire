import type {
  RecordEntryOut,
  RecordGroup,
  RecordValueKind,
} from "../../api/records";
import { formatAverage, formatPercentage } from "../../features/games/format";

/** Text forms the records levels share (FRONTEND-019, EVENTS-011). */

type PlayerOut = NonNullable<RecordEntryOut["player"]>;

/** A records level's name: its group's, or "Records" before it is known. */
export function groupTitle(group: RecordGroup | null): string {
  return group === null
    ? "Records"
    : group === "team"
      ? "Team records"
      : "Player records";
}

/** A shooting fraction (0 to 1) as a percentage, one place: `57.1%`. */
export function formatShootingShare(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * A record's `value` alone, by its `value_kind`: `.890` for a win percentage,
 * as the standings show one; `57.1%` for a shooting percentage; `27.4` for an
 * average; `42,184` for a count or a made total.
 */
export function formatRecordValue(
  value: number,
  kind: RecordValueKind,
): string {
  switch (kind) {
    case "win_loss":
      return formatPercentage(value);
    case "shot_pct":
      return formatShootingShare(value);
    case "average":
      return formatAverage(value);
    case "count":
    case "made_total":
    default:
      return value.toLocaleString("en-US");
  }
}

/** First and last name, whichever the API has. */
export function playerName(player: PlayerOut): string {
  return (
    [player.first_name, player.last_name].filter(Boolean).join(" ") ||
    "Unnamed player"
  );
}
