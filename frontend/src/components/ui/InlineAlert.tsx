import type { ReactNode } from "react";

import { CircleAlertIcon } from "./icons";
import styles from "./message.module.css";

/** A request failure, beside the control it is about: `<p role="alert">`. */
export function InlineAlert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className={`${styles.message} ${styles.danger}`}>
      <CircleAlertIcon className={styles.icon} />
      <span>{children}</span>
    </p>
  );
}
