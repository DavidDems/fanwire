import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import styles from "./FloatingButton.module.css";

interface Common {
  /** The only accessible name it has: the content is an icon. */
  "aria-label": string;
  /** The icon, aria-hidden. */
  children: ReactNode;
}

/** A link (`to`) or a button (`onClick`), never both. */
export type FloatingButtonProps = Common &
  ({ to: string; onClick?: never } | { onClick: () => void; to?: never });

/**
 * The floating action (`UI-010`): a 56 px round button fixed at the bottom
 * right, above the phone's bottom bar. With `to` it is a router `Link`, with
 * `onClick` a `<button type="button">`. `aria-label` is required, because the
 * content is an icon.
 */
export function FloatingButton(props: FloatingButtonProps) {
  const { "aria-label": label, children } = props;
  if (props.to !== undefined) {
    return (
      <Link to={props.to} aria-label={label} className={styles.floating}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      className={styles.floating}
      onClick={props.onClick}
    >
      {children}
    </button>
  );
}
