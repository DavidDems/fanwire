import type { ReactNode } from "react";

import styles from "./EmptyState.module.css";

export interface EmptyStateProps {
  /** The message, e.g. "There is nothing here yet." */
  children: ReactNode;
  /** An optional control or link under the message. */
  action?: ReactNode;
}

export function EmptyState({ children, action }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <p className={styles.message}>{children}</p>
      {action}
    </div>
  );
}
