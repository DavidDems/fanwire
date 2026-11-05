import type { RecordEntryOut, RecordValueKind } from "../../api/records";
import { formatPercentage } from "../../features/games/format";
import { VisuallyHidden } from "../ui/VisuallyHidden";
import { formatRecordValue, formatShootingShare } from "./recordLabels";
import styles from "./StatsNav.module.css";

type Figures = Pick<
  RecordEntryOut,
  "value" | "wins" | "losses" | "made" | "attempted" | "pct"
>;

const EN_DASH = "–";

/**
 * A record's value as a fan quotes it, by its `value_kind` (EVENTS-011):
 *
 * - **win_loss**: `73–9`, then the win percentage, `(.890)`, muted. The list
 *   ranks the exact percentage, so it stays in view. A screen reader hears
 *   one phrase, "73 wins, 9 losses, .890", never the dash and parenthesis.
 * - **made_total**: `12`, then the percentage, `(57.1%)`, muted; the count
 *   alone when nothing was attempted (a null `pct`).
 * - **shot_pct** (FRONTEND-030): the percentage, `45.4%`, then the made and
 *   attempted counts, `(402/886)`, muted; the percentage alone without them.
 * - anything else: the value alone, formatted by its kind.
 *
 * `strong` sets the figure in bold, as a card does; `unit`, when given,
 * follows the figure (a card's `168 points`). A win_loss or shot_pct value
 * takes no unit: `73–9` and `45.4%` say what they are.
 */
export function RecordValue({
  entry,
  kind,
  unit,
  strong = false,
}: {
  entry: Figures;
  kind: RecordValueKind;
  unit?: string;
  strong?: boolean;
}) {
  const bold = (text: string) => (strong ? <strong>{text}</strong> : text);
  const { wins, losses, made, attempted, pct } = entry;

  if (kind === "win_loss" && wins !== null && losses !== null && pct !== null) {
    const share = formatPercentage(pct);
    return (
      <>
        <span aria-hidden="true">
          {bold(`${wins}${EN_DASH}${losses}`)}{" "}
          <span className={styles.share}>({share})</span>
        </span>
        <VisuallyHidden>
          {`${wins} ${wins === 1 ? "win" : "wins"}, ${losses} ${losses === 1 ? "loss" : "losses"}, ${share}`}
        </VisuallyHidden>
      </>
    );
  }

  const figure =
    kind === "made_total" && made !== null
      ? made.toLocaleString("en-US")
      : formatRecordValue(entry.value, kind);
  return (
    <>
      {bold(figure)}
      {unit === undefined ? null : ` ${unit}`}
      {kind === "made_total" && pct !== null ? (
        <>
          {" "}
          <span className={styles.share}>({formatShootingShare(pct)})</span>
        </>
      ) : kind === "shot_pct" && made !== null && attempted !== null ? (
        <>
          {" "}
          <span className={styles.share}>
            ({made.toLocaleString("en-US")}/{attempted.toLocaleString("en-US")})
          </span>
        </>
      ) : null}
    </>
  );
}
