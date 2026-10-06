import type { ReactNode } from "react";

import styles from "./Badge.module.css";

export interface BadgeProps {
  /** `live` adds a dot; the word is always the signal, never the colour alone. */
  variant: "neutral" | "live" | "outline";
  children: ReactNode;
}

export function Badge({ variant, children }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[variant]}`}>
      {variant === "live" && <span aria-hidden="true" className={styles.dot} />}
      {children}
    </span>
  );
}
