import styles from "./Games.module.css";

/** Original project-authored court and scoreboard geometry for game pages. */
export function MatchupArtwork({
  awayName,
  homeName,
  awayScore,
  homeScore,
  date,
}: {
  awayName: string;
  homeName: string;
  awayScore: number;
  homeScore: number;
  date: string;
}) {
  return (
    <figure className={styles.matchupArtwork} aria-hidden="true">
      <svg viewBox="0 0 720 176" focusable="false">
        <rect x="1" y="1" width="718" height="174" rx="12" />
        <path d="M24 22v132h672V22M360 22v132m0-84a24 24 0 1 0 0 48 24 24 0 1 0 0-48ZM24 56h32a34 34 0 0 1 0 64H24m672-64h-32a34 34 0 0 0 0 64h32" />
        <path d="M332 62c15 9 24 21 28 35m28-35c-15 9-24 21-28 35m-20-48c7 16 9 32 7 48m33-48c-7 16-9 32-7 48" />
      </svg>
      <figcaption className={styles.artLabels}>
        <span className={styles.artTeam}>
          {awayName} <strong>{awayScore}</strong>
        </span>
        <span className={styles.artTeam}>
          {homeName} <strong>{homeScore}</strong>
        </span>
        <time className={styles.artDate}>{date}</time>
      </figcaption>
    </figure>
  );
}
