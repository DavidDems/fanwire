import type { RecordEntryOut, RecordGroup } from "../../api/records";
import { formatPercentage } from "../../features/games/format";

/** Text forms the records levels share (FRONTEND-019). */

type PlayerOut = NonNullable<RecordEntryOut["player"]>;

/** A records level's name: its group's, or "Records" before it is known. */
export function groupTitle(group: RecordGroup | null): string {
  return group === null
    ? "Records"
    : group === "team"
      ? "Team records"
      : "Player records";
}

/** A win percentage is a rate; every other record's value is a count. */
export function isRate(unit: string): boolean {
  return unit.includes("%");
}

/** `.890` for a rate, as the standings show one; `42,184` for a count. */
export function formatRecordValue(value: number, unit: string): string {
  return isRate(unit) ? formatPercentage(value) : value.toLocaleString("en-US");
}

/** First and last name, whichever the API has. */
export function playerName(player: PlayerOut): string {
  return (
    [player.first_name, player.last_name].filter(Boolean).join(" ") ||
    "Unnamed player"
  );
}
