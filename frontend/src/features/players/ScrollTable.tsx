import type { ReactNode } from "react";

import styles from "./Players.module.css";

/**
 * A copy of `features/stats/ScrollTable.tsx`: the two features reach each
 * other by address only, never by import, so each keeps its own.
 *
 * A data table in its own scroll container: a `role="region"` named by the
 * caption, focusable (`tabIndex` 0) so a keyboard user can scroll it sideways
 * on a phone, holding exactly this one table. The page itself never scrolls
 * horizontally; the region does (`overflow-x: auto`). `children` are the
 * table's `thead`, `tbody` and `tfoot`, with `scope` on every header cell.
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
        <caption className={styles.caption}>{caption}</caption>
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
