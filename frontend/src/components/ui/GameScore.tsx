import { Badge } from "./Badge";
import styles from "./GameScore.module.css";

/** In play: a Live badge, and the code itself as the shown text. */
const LIVE_CODES = new Set(["Q1", "Q2", "Q3", "Q4", "OT", "BT", "HT"]);

/** Not in play: a neutral badge with a word for the code. */
const SETTLED_TEXT = new Map([
  ["FT", "Final"],
  ["AOT", "Final (OT)"],
  ["NS", "Scheduled"],
  ["POST", "Postponed"],
  ["CANC", "Cancelled"],
  ["SUSP", "Suspended"],
  ["AWD", "Awarded"],
  ["ABD", "Abandoned"],
]);

const EN_DASH = "–";

export interface GameScoreProps {
  /** `compact`: the feed ticker. `row`: a search result. */
  variant: "compact" | "row";
  homeScore: number;
  awayScore: number;
  /**
   * The vendor's short code, passed through. The vendor shape is unverified,
   * so a code not in the table is shown as given and never called Live
   * (`components.md` §4).
   */
  status: string;
}

export function GameScore({
  variant,
  homeScore,
  awayScore,
  status,
}: GameScoreProps) {
  const live = LIVE_CODES.has(status);

  return (
    <div className={`${styles.score} ${styles[variant]}`}>
      <p className={styles.state}>
        {live ? (
          <>
            <Badge variant="live">Live</Badge>
            <span>{status}</span>
          </>
        ) : (
          <Badge variant="neutral">{SETTLED_TEXT.get(status) ?? status}</Badge>
        )}
      </p>
      <p className={styles.figures}>
        <span className={styles.label}>Home</span>
        <span className={styles.figure}>{homeScore}</span>
        <span>{EN_DASH}</span>
        <span className={styles.figure}>{awayScore}</span>
        <span className={styles.label}>Away</span>
      </p>
    </div>
  );
}
