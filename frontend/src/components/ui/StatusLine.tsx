import type { ReactNode } from "react";

import { CircleCheckIcon } from "./icons";
import styles from "./message.module.css";

export interface StatusLineProps {
  /** `neutral` for loading lines; `success` for "Your profile has been saved." */
  variant?: "neutral" | "success";
  children: ReactNode;
}

/** A loading or progress line: `<p role="status">`. */
export function StatusLine({ variant = "neutral", children }: StatusLineProps) {
  return (
    <p role="status" className={`${styles.message} ${styles[variant]}`}>
      {variant === "success" && <CircleCheckIcon className={styles.icon} />}
      <span>{children}</span>
    </p>
  );
}
