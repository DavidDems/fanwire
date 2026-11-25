import type { ReactNode } from "react";

/**
 * A data table in its own scroll container: a `role="region"` named by the
 * caption, focusable (`tabIndex` 0) so a keyboard user can scroll it sideways
 * on a phone, holding exactly this one table. The page itself never scrolls
 * horizontally; the region does (`overflow-x: auto`, in the caller's
 * stylesheet). `children` are the table's `thead`, `tbody` and `tfoot`, with
 * `scope` on every header cell.
 *
 * This owns the markup and roles only and imports no stylesheet: each caller
 * passes its own classes (the stats navigator's `StatsNav.module.css`, or
 * `Players.module.css` on the player page).
 */
export function ScrollTable({
  caption,
  children,
  scrollClassName,
  tableClassName,
  captionClassName,
}: {
  caption: string;
  children: ReactNode;
  /** The scroll region's class, the one that sets `overflow-x: auto`. */
  scrollClassName: string;
  tableClassName: string;
  captionClassName?: string;
}) {
  return (
    <div
      className={scrollClassName}
      role="region"
      aria-label={caption}
      tabIndex={0}
    >
      <table className={tableClassName}>
        <caption className={captionClassName}>{caption}</caption>
        {children}
      </table>
    </div>
  );
}

/**
 * A column header, with the abbreviation's full name when it has one.
 * `className` is the caller's (its stylesheet's left-aligned `name` column).
 */
export function ColumnHeader({
  label,
  title,
  className,
}: {
  label: string;
  title?: string;
  className?: string;
}) {
  return (
    <th scope="col" className={className}>
      {title === undefined ? label : <abbr title={title}>{label}</abbr>}
    </th>
  );
}
