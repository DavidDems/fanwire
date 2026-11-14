import styles from "./CourtScoreboard.module.css";

/** Original, decorative linework for quiet states; geometry only, no game marks. */
export function CourtScoreboard() {
  return (
    <svg
      aria-hidden="true"
      className={styles.art}
      viewBox="0 0 160 72"
      focusable="false"
    >
      <rect className={styles.board} x="57" y="4" width="46" height="18" rx="3" />
      <path className={styles.lines} d="M67 13h8m10 0h8M80 8v10" />
      <rect className={styles.court} x="13" y="29" width="134" height="37" rx="3" />
      <path className={styles.lines} d="M80 29v37M13 47.5h17a15 15 0 0 0 30 0 15 15 0 0 0-30 0M147 47.5h-17a15 15 0 0 1-30 0 15 15 0 0 1 30 0" />
      <circle className={styles.center} cx="80" cy="47.5" r="7" />
    </svg>
  );
}
