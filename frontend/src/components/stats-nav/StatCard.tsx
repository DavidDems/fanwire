import type { ReactNode } from "react";

import styles from "./StatsNav.module.css";

/**
 * The stats cards' one card (FRONTEND-042's Historical record card, shared
 * with Records > Seasonal's leader cards by FRONTEND-043): an item of the
 * `.cards` grid, its title (an `h3`) with the card's action at its right,
 * then its body.
 *
 * **`stretched`**: the action is the card's one control, and its `::after`
 * covers the whole card, so the card is its hit area and shows hover and
 * focus as a whole (a record card, whose entries are plain text). A card
 * whose body holds controls of its own (a leader card's player links) is
 * not stretched: every control keeps its own hit area.
 */
export function StatCard({
  title,
  action,
  stretched = false,
  children,
}: {
  title: ReactNode;
  action: ReactNode;
  stretched?: boolean;
  children: ReactNode;
}) {
  return (
    <li
      className={
        stretched ? `${styles.card} ${styles.cardStretched}` : styles.card
      }
    >
      <div className={styles.cardHead}>
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </li>
  );
}

/**
 * One of a card's top entries, an item of its `ol.top`: line 1 the icon (if
 * any), the name and the value, never wrapping (the name is cut with an
 * ellipsis, its whole text still in the page); line 2, when given, muted and
 * small. `lead` sets the name semibold, for an entry that holds the record or
 * leads the board (the value sets its own weight).
 */
export function CardEntry({
  icon,
  name,
  value,
  detail,
  lead,
}: {
  icon?: ReactNode;
  name: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  lead: boolean;
}) {
  const Name = lead ? "strong" : "span";
  return (
    <li>
      <p className={styles.entryLine}>
        {icon}
        <Name className={styles.entryName}>{name}</Name>{" "}
        <span className={styles.entryValue}>{value}</span>
      </p>
      {detail === undefined || detail === null ? null : (
        <p className={styles.muted}>{detail}</p>
      )}
    </li>
  );
}
