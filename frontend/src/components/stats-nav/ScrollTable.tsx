import type { ReactNode } from "react";

import styles from "./StatsNav.module.css";

/**
 * A data table in its own scroll container: a `role="region"` named by the
 * caption and focusable (`tabIndex` 0) so a keyboard user can scroll it
 * sideways on a phone. `children` are the table's `thead` and `tbody`, with
 * `scope` on every header cell. `classes` is the stylesheet that draws it
 * (its `scroll`, `table` and `name` classes): the navigator's own by default,
 * the Stats page's for its leaders.
 */
export function ScrollTable({
  caption,
  children,
  classes = styles,
}: {
  caption: string;
  children: ReactNode;
  classes?: CSSModuleClasses;
}) {
  return (
    <div
      className={classes.scroll}
      role="region"
      aria-label={caption}
      tabIndex={0}
    >
      <table className={classes.table}>
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
  classes = styles,
}: {
  label: string;
  title?: string;
  /** The left-aligned name column. */
  name?: boolean;
  classes?: CSSModuleClasses;
}) {
  return (
    <th scope="col" className={name ? classes.name : undefined}>
      {title === undefined ? label : <abbr title={title}>{label}</abbr>}
    </th>
  );
}
