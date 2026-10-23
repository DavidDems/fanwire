import styles from "./Previews.module.css";

/** One figure: its abbreviation, the abbreviation's full name, the value. */
export type Figure = readonly [label: string, title: string, value: string];

/**
 * A preview's figures as a description list: each abbreviation over its value.
 * A space separates every pair from the next, so the text reads as words
 * ("PTS 31 REB 13") to anything that reads it flat, not as "PTS31REB13".
 */
export function Figures({ figures }: { figures: readonly Figure[] }) {
  return (
    <dl className={styles.figures}>
      {figures.map(([label, title, value]) => (
        <div key={label}>
          <dt>
            <abbr title={title}>{label}</abbr>
          </dt>{" "}
          <dd>{value}</dd>{" "}
        </div>
      ))}
    </dl>
  );
}
