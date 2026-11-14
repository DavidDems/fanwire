import type { ReactNode } from "react";

import styles from "./StatsNav.module.css";

/**
 * A data table in its own scroll container: a `role="region"` named by the
 * caption and focusable (`tabIndex` 0) so a keyboard user can scroll it
 * sideways on a phone. `children` are the table's `thead` and `tbody`, with
 * `scope` on every header cell. Every stats table is drawn by this one with
 * the navigator's stylesheet (FRONTEND-019 retired the Stats page's copy), so
 * a caller's cells take that stylesheet's `name` and `figure` classes.
 */
export function ScrollTable({
  caption,
  children,
}: {
  caption: string;
  children: ReactNode;
}) {
  return (
    <div
      className={styles.scroll}
      role="region"
      aria-label={caption}
      tabIndex={0}
    >
      <table className={styles.table}>
        <caption>{caption}</caption>
        {children}
      </table>
    </div>
  );
}

/** A column header, with the abbreviation's full name when it has one. */
export function ColumnHeader({
  label,
  title,
  name = false,
}: {
  label: string;
  title?: string;
  /** The left-aligned name column. */
  name?: boolean;
}) {
  return (
    <th scope="col" className={name ? styles.name : undefined}>
      {title === undefined ? label : <abbr title={title}>{label}</abbr>}
    </th>
  );
}
